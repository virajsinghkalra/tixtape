/**
 * E2E fixture events (D-049). They live only in the concert_e2e database, never in real data.
 * Names are realistic so search tests ("lolla", "olivia", "ritviz", "diljeet", "pune") mean something.
 */
import { AdminEventInputSchema } from "@/application/events";
import { createEventsModule } from "@/infrastructure/events-module";
import { container } from "@/server/container";

export const FIXTURE_EVENTS = [
  {
    title: "Lollapalooza India 2027",
    type: "festival",
    startsAt: "2027-01-23T12:00:00+05:30",
    endsAt: "2027-01-24T23:00:00+05:30",
    venue: { name: "Mahalaxmi Racecourse", city: "Mumbai", country: "IN" },
    lineup: [
      { name: "Olivia Dean", tier: "headliner" },
      { name: "Limp Bizkit", tier: "headliner" },
      { name: "KATSEYE", tier: "headliner" },
      { name: "Fontaines D.C.", tier: "sub" },
      { name: "Prateek Kuhad", tier: "mid" },
      { name: "Seedhe Maut", tier: "mid" },
      { name: "Nucleya b2b Ritviz", tier: "support" },
    ],
  },
  {
    title: "NH7 Weekender Pune",
    type: "festival",
    startsAt: "2026-12-12T14:00:00+05:30",
    endsAt: "2026-12-13T23:00:00+05:30",
    venue: { name: "Mahalakshmi Lawns", city: "Pune", country: "IN" },
    lineup: [
      { name: "When Chai Met Toast", tier: "headliner" },
      { name: "Anuv Jain", tier: "sub" },
      { name: "The Local Train", tier: "mid" },
      { name: "Lifafa", tier: "support" },
    ],
  },
  {
    title: "Diljit Dosanjh Live in Bengaluru",
    type: "concert",
    startsAt: "2027-02-06T19:00:00+05:30",
    venue: { name: "Palace Grounds", city: "Bangalore", country: "IN" },
    lineup: [{ name: "Diljit Dosanjh", tier: "headliner" }],
  },
] as const;

export async function seedFixtures(): Promise<void> {
  const c = container();
  const events = createEventsModule(c);
  // D-056: fixtures are public, so seed them as published.
  for (const e of FIXTURE_EVENTS)
    await events.createAdminEvent(AdminEventInputSchema.parse({ ...e, visibility: "published" }));
  await c.db.$close();
}

// Run directly by tests/e2e/global-setup.ts via tsx (which resolves the "@/" alias).
if (process.argv[1]?.endsWith("seed.ts")) {
  seedFixtures().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
