import { and, eq, gt, lte } from "drizzle-orm";
import type { ActiveSession, SessionRepository } from "@/application/auth/ports";
import type { Database } from "@/db/client";
import { sessions } from "@/db/schema";
import { asUserId, type UserId } from "@/domain/shared/ids";
import { hashSessionId } from "@/infrastructure/crypto/session-id";

/** Stores SHA-256(session id) only, so a DB leak doesn't leak live sessions (LLD §12). */
export class PgSessionRepository implements SessionRepository {
  constructor(private readonly db: Database) {}

  async create(
    sessionId: string,
    userId: UserId,
    expiresAt: Date,
    createdAt?: Date,
  ): Promise<void> {
    await this.db.insert(sessions).values({
      idHash: hashSessionId(sessionId),
      userId,
      expiresAt,
      ...(createdAt && { createdAt }),
    });
  }

  async findUserId(sessionId: string, now: Date): Promise<UserId | null> {
    return (await this.find(sessionId, now))?.userId ?? null;
  }

  async find(sessionId: string, now: Date): Promise<ActiveSession | null> {
    const rows = await this.db
      .select({
        userId: sessions.userId,
        expiresAt: sessions.expiresAt,
        createdAt: sessions.createdAt,
      })
      .from(sessions)
      .where(and(eq(sessions.idHash, hashSessionId(sessionId)), gt(sessions.expiresAt, now)));
    const row = rows[0];
    return row ? { ...row, userId: asUserId(row.userId) } : null;
  }

  async extend(sessionId: string, expiresAt: Date): Promise<void> {
    await this.db
      .update(sessions)
      .set({ expiresAt })
      .where(eq(sessions.idHash, hashSessionId(sessionId)));
  }

  async delete(sessionId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.idHash, hashSessionId(sessionId)));
  }

  async deleteExpired(now: Date): Promise<number> {
    const rows = await this.db
      .delete(sessions)
      .where(lte(sessions.expiresAt, now))
      .returning({ idHash: sessions.idHash });
    return rows.length;
  }
}
