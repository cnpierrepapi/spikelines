import { renderOgCard, OG_SIZE, OG_CONTENT_TYPE, OG_ALT } from "@/lib/og-card";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = OG_ALT;

export default function Image() {
  return renderOgCard();
}
