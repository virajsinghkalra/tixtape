import type { Metadata } from "next";
import { YourGigsPage } from "@/components/saved/YourGigsPage";

export const metadata: Metadata = { title: "Your gigs", robots: { index: false } };

/** D-092: everything saved on this device (synced for opted-in people), upcoming first. */
export default function MyGigsPage() {
  return <YourGigsPage />;
}
