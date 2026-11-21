import type { Metadata } from "next";
import type { ReviewItem } from "@/application/matching";
import { ReviewQueue } from "@/components/admin/ReviewQueue";
import { toReviewView } from "@/components/admin/review-queue";
import { Card } from "@/components/ui/Card";
import { matching } from "@/server/matching";
import { requireAdminPage } from "../admin-guard";

export const metadata: Metadata = { title: "Artist review" };
export const dynamic = "force-dynamic";

/** Small batches: an artist without stored candidates costs two Spotify searches. */
const BATCH = 20;

async function loadQueue(): Promise<ReviewItem[] | null> {
  try {
    return await matching().listReviewQueue(BATCH);
  } catch (err) {
    // Usually Spotify pausing us (D-006); the page says so instead of failing.
    console.error("Could not load the artist review queue", err);
    return null;
  }
}

export default async function AdminArtistsPage() {
  await requireAdminPage();
  const items = await loadQueue();

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-big font-extrabold">Artist review</h1>
      <p className="text-sm text-muted">
        Pick the right Spotify artist for each lineup name (D-066). “Strong match” means the
        resolver&apos;s own rules would accept it; only those can be approved in bulk. Showing up to{" "}
        {BATCH} at a time, oldest first.
      </p>
      {items === null ? (
        <Card role="alert" className="p-6">
          Couldn&apos;t load the queue. Spotify may be pausing requests for a while. Reload in a few
          minutes.
        </Card>
      ) : items.length === 0 ? (
        <Card className="p-6 text-center text-muted">
          Nothing to review. Every artist is resolved.
        </Card>
      ) : (
        <ReviewQueue items={items.map(toReviewView)} />
      )}
    </div>
  );
}
