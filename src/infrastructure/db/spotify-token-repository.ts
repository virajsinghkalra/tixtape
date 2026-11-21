import { eq, sql } from "drizzle-orm";
import type {
  SpotifyTokenRepository,
  SpotifyTokenSet,
  StoredSpotifyToken,
} from "@/application/auth/ports";
import type { Database } from "@/db/client";
import { spotifyTokens } from "@/db/schema";
import { asUserId, type UserId } from "@/domain/shared/ids";
import type { TokenCipher } from "@/infrastructure/crypto/token-cipher";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | Transaction;

/** Each field gets its own AAD so ciphertexts can't be moved between users or columns. */
const aad = (userId: UserId, field: "access" | "refresh") => `spotify_tokens:${userId}:${field}`;

export class PgSpotifyTokenRepository implements SpotifyTokenRepository {
  constructor(
    private readonly db: Executor,
    private readonly cipher: TokenCipher,
  ) {}

  async find(userId: UserId): Promise<StoredSpotifyToken | null> {
    const rows = await this.db.select().from(spotifyTokens).where(eq(spotifyTokens.userId, userId));
    const row = rows[0];
    if (!row) return null;
    const keyVersion = row.keyVersion;
    return {
      userId: asUserId(row.userId),
      accessToken: this.cipher.decrypt(
        { ciphertext: row.accessTokenEnc, keyVersion },
        aad(userId, "access"),
      ),
      refreshToken: this.cipher.decrypt(
        { ciphertext: row.refreshTokenEnc, keyVersion },
        aad(userId, "refresh"),
      ),
      scope: row.scope,
      expiresAt: row.expiresAt,
      needsReauth: row.needsReauth,
    };
  }

  async save(userId: UserId, tokens: SpotifyTokenSet): Promise<void> {
    const access = this.cipher.encrypt(tokens.accessToken, aad(userId, "access"));
    const refresh = this.cipher.encrypt(tokens.refreshToken, aad(userId, "refresh"));
    const values = {
      accessTokenEnc: access.ciphertext,
      refreshTokenEnc: refresh.ciphertext,
      keyVersion: access.keyVersion,
      scope: tokens.scope,
      expiresAt: tokens.expiresAt,
      needsReauth: false,
      updatedAt: sql`now()`,
    };
    await this.db
      .insert(spotifyTokens)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: spotifyTokens.userId, set: values });
  }

  async markNeedsReauth(userId: UserId): Promise<void> {
    await this.db
      .update(spotifyTokens)
      .set({ needsReauth: true, updatedAt: sql`now()` })
      .where(eq(spotifyTokens.userId, userId));
  }

  async withUserLock<T>(
    userId: UserId,
    fn: (tokens: SpotifyTokenRepository) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const key = `spotify_tokens:${userId}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
      return fn(new PgSpotifyTokenRepository(tx, this.cipher));
    });
  }
}
