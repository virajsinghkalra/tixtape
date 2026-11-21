/**
 * QA-only setup, after the shared E2E setup (D-049):
 * - closes the app's own Spotify gate in concert_e2e, so nothing in this run can reach Spotify;
 * - marks Lollapalooza's lineup as Spotify-matched with fake ids, so its event page offers
 *   "Make playlist" (the estimate is server-rendered). NH7 and Diljit stay unmatched for the
 *   "coming soon" / 422 paths. No publisher exists, so a real start answers 503.
 */
import postgres from "postgres";

const E2E_URL = process.env.E2E_DATABASE_URL ?? "postgres://app:app@127.0.0.1:54329/concert_e2e";

export default async function qaGlobalSetup(): Promise<void> {
  const sql = postgres(E2E_URL, { max: 1, onnotice: () => {} });
  await sql`insert into spotify_gate (id, paused_until) values (1, now() + interval '2 days')
            on conflict (id) do update set paused_until = excluded.paused_until`;
  await sql`update artists a set spotify_id = substr(md5(a.name), 1, 22), match_status = 'auto'
            from event_artists ea join events e on e.id = ea.event_id
            where ea.artist_id = a.id and e.title = 'Lollapalooza India 2027'`;
  await sql.end();
}
