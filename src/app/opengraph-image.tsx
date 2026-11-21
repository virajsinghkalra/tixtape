import { OG_SIZE } from "@/components/og/og-card";
import { renderBrandCard } from "@/server/og-image";

/** D-084: the home and search link preview: the brand card. */
export const alt = "Tixtape: every lineup, one playlist";
export const size = OG_SIZE;
export const contentType = "image/jpeg";

export default function Image() {
  return renderBrandCard();
}
