import { loadShareEvent } from "@/server/event-share";
import { eventCardPlan } from "@/server/event-card";
import { renderEventCard } from "@/server/og-image";
import { noteUx } from "@/server/ux";

/**
 * D-084 (UX plan #1): the event's 1200×630 link-preview card. The page's metadata points here
 * with `?v=<card version>`, so WhatsApp's per-URL cache refreshes when the lineup, picture or
 * playlist state changes. Unknown events get a 404, never an error page.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const share = await loadShareEvent((await ctx.params).id).catch(() => null);
  if (!share) return new Response("Not found", { status: 404 });
  noteUx("og_hit");
  return renderEventCard(eventCardPlan(share));
}
