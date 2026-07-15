import { ImageResponse } from "next/og";

// Shared designed social card for opengraph-image + twitter-image. Rendered by
// next/og (Satori): flexbox-only layout, inline SVG allowed. These routes are
// static, so the Google font fetch below runs once at build and the PNG is cached
// — it never hits per-request, and a failed fetch falls back to the bundled font.

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";
export const OG_ALT = "Spikelines — feel the match, call what happens next";

const NAVY = "#050e1a";
const YELLOW = "#f5c800";
const CREAM = "#f7f1e4";
const MUTED = "#8b93a3";

type FontDef = { name: string; data: ArrayBuffer; weight: 400 | 500 | 800; style: "normal" };

// Pull a TTF for a given weight from Google Fonts. No modern User-Agent → Google
// serves a truetype url that Satori can parse. Best-effort: returns null on failure.
async function loadFont(weight: 500 | 800): Promise<FontDef | null> {
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=Inter:wght@${weight}`,
      { headers: { "User-Agent": "Mozilla/4.0" } }
    ).then((r) => r.text());
    const url = css.match(/src:\s*url\((https:[^)]+\.ttf)\)/)?.[1];
    if (!url) return null;
    const data = await fetch(url).then((r) => r.arrayBuffer());
    return { name: "Inter", data, weight, style: "normal" };
  } catch {
    return null;
  }
}

function Logo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512">
      <rect width="512" height="512" rx="116" fill="#0a1a30" />
      <rect x="8" y="8" width="496" height="496" rx="108" fill="none" stroke={YELLOW} strokeOpacity="0.25" strokeWidth="6" />
      <polyline
        points="72,316 176,316 240,316 280,120 320,316 372,316 404,244 440,316"
        fill="none" stroke={YELLOW} strokeWidth="34" strokeLinecap="round" strokeLinejoin="round"
      />
      <circle cx="280" cy="120" r="30" fill={YELLOW} />
    </svg>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 999,
        padding: "10px 22px",
        color: MUTED,
        fontSize: 26,
        fontWeight: 500,
      }}
    >
      {label}
    </div>
  );
}

export async function renderOgCard() {
  const [bold, medium] = await Promise.all([loadFont(800), loadFont(500)]);
  const fonts = [bold, medium].filter(Boolean) as FontDef[];
  const heavy = bold ? 800 : 400;
  const mid = medium ? 500 : 400;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 64,
          background: `linear-gradient(135deg, #0a1a30 0%, ${NAVY} 55%)`,
          color: CREAM,
          fontFamily: "Inter",
        }}
      >
        {/* eyebrow + logo */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", color: MUTED, fontSize: 26, letterSpacing: 8, fontWeight: mid }}>
            SPIKELINES · TXLINE WORLD CUP
          </div>
          <Logo size={92} />
        </div>

        {/* headline */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 74, fontWeight: heavy, lineHeight: 1.04 }}>
            Feel the match.
          </div>
          <div style={{ display: "flex", fontSize: 74, fontWeight: heavy, lineHeight: 1.04, color: YELLOW }}>
            Call what happens next.
          </div>
          <div style={{ display: "flex", marginTop: 24, maxWidth: 880, fontSize: 29, lineHeight: 1.38, color: MUTED, fontWeight: mid }}>
            A 5-second call fires as the attack builds. Tap YES / NO, build a streak, and earn SPIKES — every result settled on live World Cup data and proven on Solana.
          </div>
        </div>

        {/* chips + domain */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 14 }}>
            <Chip label="free to play" />
            <Chip label="live + archived" />
            <Chip label="on-chain proof" />
          </div>
          <div style={{ display: "flex", color: YELLOW, fontSize: 28, fontWeight: heavy }}>
            spikelines.vercel.app
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: fonts.length ? fonts : undefined }
  );
}
