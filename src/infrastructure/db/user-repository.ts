import { eq } from "drizzle-orm";
import type { AuthUser, UserRepository, UserRole } from "@/application/auth/ports";
import type { Database } from "@/db/client";
import { users } from "@/db/schema";
import { asUserId, type UserId } from "@/domain/shared/ids";

type UserRow = typeof users.$inferSelect;

const toAuthUser = (row: UserRow): AuthUser => ({
  id: asUserId(row.id),
  spotifyUserId: row.spotifyUserId,
  displayName: row.displayName,
  market: row.market,
  role: row.role,
});

export class PgUserRepository implements UserRepository {
  constructor(private readonly db: Database) {}

  async upsertBySpotifyId(input: {
    spotifyUserId: string;
    displayName: string | null;
    role: UserRole;
  }): Promise<AuthUser> {
    const rows = await this.db
      .insert(users)
      .values(input)
      .onConflictDoUpdate({
        target: users.spotifyUserId,
        set: { displayName: input.displayName, role: input.role },
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("users upsert returned no row");
    return toAuthUser(row);
  }

  async findById(id: UserId): Promise<AuthUser | null> {
    const rows = await this.db.select().from(users).where(eq(users.id, id));
    return rows[0] ? toAuthUser(rows[0]) : null;
  }

  async delete(id: UserId): Promise<void> {
    await this.db.delete(users).where(eq(users.id, id));
  }
}
