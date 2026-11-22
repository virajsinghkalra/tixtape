/**
 * D-090: Postgres store for product analytics and opt-in identity. Devices upsert on their ID;
 * events are an append-only log; a person's email is unique (normalised). Personal fields
 * (nickname, name, email) are only ever written here and read by the admin read model.
 */
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { AnalyticsStore, ContactOutcome, VisitContext } from "@/application/ports/analytics";
import type { Database } from "@/db/client";
import { analyticsEvents, devices, people } from "@/db/schema";
import type { AnalyticsEvent } from "@/domain/analytics/beacon";
import type { Contact } from "@/domain/analytics/identity";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class PgAnalyticsStore implements AnalyticsStore {
  constructor(private readonly db: Database) {}

  async record(visit: VisitContext, events: readonly AnalyticsEvent[]): Promise<void> {
    await this.touchDevice(this.db, visit.deviceId, visit.source.source, visit.at);
    if (events.length === 0) return;
    await this.db.insert(analyticsEvents).values(
      events.map((e) => ({
        deviceId: visit.deviceId,
        name: e.n,
        props: e.p,
        city: visit.city,
        source: visit.source.source,
        utmMedium: visit.source.medium,
        utmCampaign: visit.source.campaign,
        at: visit.at,
      })),
    );
  }

  /** Creates the device on first sight; afterwards only moves `last_seen` forward. */
  private async touchDevice(db: Database | Tx, id: string, source: string, at: Date) {
    await db
      .insert(devices)
      .values({ id, firstSeen: at, lastSeen: at, firstSource: source })
      .onConflictDoUpdate({
        target: devices.id,
        set: { lastSeen: sql`greatest(${devices.lastSeen}, excluded.last_seen)` },
      });
  }

  private async personOf(tx: Tx, deviceId: string): Promise<string | null> {
    const rows = await tx
      .select({ personId: devices.personId })
      .from(devices)
      .where(eq(devices.id, deviceId))
      .for("update");
    return rows[0]?.personId ?? null;
  }

  async setNickname(deviceId: string, nickname: string, at: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.touchDevice(tx, deviceId, "direct", at);
      const personId = await this.personOf(tx, deviceId);
      if (personId) {
        await tx.update(people).set({ nickname, updatedAt: at }).where(eq(people.id, personId));
        return;
      }
      const [created] = await tx
        .insert(people)
        .values({ nickname, createdAt: at, updatedAt: at })
        .returning({ id: people.id });
      await tx.update(devices).set({ personId: created!.id }).where(eq(devices.id, deviceId));
    });
  }

  async saveContact(deviceId: string, contact: Contact, at: Date): Promise<ContactOutcome> {
    return this.db.transaction(async (tx) => {
      await this.touchDevice(tx, deviceId, "direct", at);
      const personId = await this.personOf(tx, deviceId);
      const [owner] = await tx
        .select({ id: people.id })
        .from(people)
        .where(eq(people.email, contact.email))
        .for("update");
      // Someone else's email (or a second device of theirs): without verification we can't
      // tell, so nothing is linked or changed. Nobody can attach to or delete another record.
      if (owner && owner.id !== personId) return "kept";
      const fields = {
        email: contact.email,
        consentAt: at,
        consentVersion: contact.consentVersion,
        consentSource: contact.source,
        updatedAt: at,
      };
      if (personId) {
        await tx
          .update(people)
          .set({
            ...fields,
            ...(contact.personName ? { name: contact.personName } : {}),
          })
          .where(eq(people.id, personId));
        return "saved";
      }
      const [created] = await tx
        .insert(people)
        .values({ ...fields, name: contact.personName, createdAt: at })
        .returning({ id: people.id });
      await tx.update(devices).set({ personId: created!.id }).where(eq(devices.id, deviceId));
      return "saved";
    });
  }

  async identityStatus(deviceId: string): Promise<{ hasNickname: boolean; hasEmail: boolean }> {
    const rows = await this.db
      .select({ nickname: people.nickname, email: people.email })
      .from(devices)
      .innerJoin(people, eq(people.id, devices.personId))
      .where(eq(devices.id, deviceId))
      .limit(1);
    const p = rows[0];
    return { hasNickname: Boolean(p?.nickname), hasEmail: Boolean(p?.email) };
  }

  async deleteDeviceData(deviceId: string): Promise<{ person: boolean; events: number }> {
    return this.db.transaction(async (tx) => {
      const personId = await this.personOf(tx, deviceId);
      const ids = personId
        ? (
            await tx.select({ id: devices.id }).from(devices).where(eq(devices.personId, personId))
          ).map((d) => d.id)
        : [deviceId];
      const anonymised = await tx
        .update(analyticsEvents)
        .set({ deviceId: null })
        .where(inArray(analyticsEvents.deviceId, ids))
        .returning({ id: analyticsEvents.id });
      await tx.delete(devices).where(inArray(devices.id, ids));
      if (personId) await tx.delete(people).where(eq(people.id, personId));
      return { person: personId !== null, events: anonymised.length };
    });
  }

  async prune(before: Date): Promise<{ events: number; devices: number }> {
    const [events] = await this.db.execute<{ n: number }>(sql`
      with gone as (delete from ${analyticsEvents} where ${lt(analyticsEvents.at, before)} returning 1)
      select count(*)::int as n from gone`);
    // Anonymous devices with nothing left to describe them go too; people stay until they ask.
    const [gone] = await this.db.execute<{ n: number }>(sql`
      with gone as (
        delete from ${devices}
        where ${and(lt(devices.lastSeen, before), isNull(devices.personId))}
        returning 1
      )
      select count(*)::int as n from gone`);
    return { events: events?.n ?? 0, devices: gone?.n ?? 0 };
  }
}
