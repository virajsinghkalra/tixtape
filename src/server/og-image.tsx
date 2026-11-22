/**
 * D-084 (UX plan #1, OD-1): renders link-preview cards with `next/og`. Pictures (the poster or
 * artist photos) are fetched here with a timeout and a size cap, inlined, and simply left out
 * when slow, missing or an unsupported type, so the card falls back to typography and never
 * fails. Output is JPEG when `sharp` is available (WhatsApp skips previews much over ~300 KB),
 * else PNG.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { OG_SIZE, type OgCardPlan } from "@/components/og/og-card";
import { withTimeout } from "@/lib/timeout";

const PICTURE_TIMEOUT_MS = 2500;
const MAX_PICTURE_BYTES = 3_000_000;
const NIGHT = "#0b0b0f";
const LIME = "#c6f432";
export const OG_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";

type Font = { name: string; data: ArrayBuffer; weight: 600 | 800; style: "normal" };

let fonts: Promise<Font[]> | undefined;
function loadFonts(): Promise<Font[]> {
  const read = async (file: string) => {
    const buf = await readFile(path.join(process.cwd(), "public", "fonts", file));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  };
  fonts ??= Promise.all([read("bricolage-800.ttf"), read("inter-600.ttf")])
    .then(([display, sans]): Font[] => [
      { name: "Bricolage", data: display, weight: 800, style: "normal" },
      { name: "Inter", data: sans, weight: 600, style: "normal" },
    ])
    .catch(() => {
      fonts = undefined; // Retry next time; next/og's built-in font is the fallback.
      return [];
    });
  return fonts;
}

let logo: Promise<string> | undefined;
function loadLogo(): Promise<string> {
  logo ??= readFile(path.join(process.cwd(), "src", "app", "icon.svg"), "utf8")
    .then((svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`)
    .catch(() => "");
  return logo;
}

/** A picture as a data URL, or null when it's slow, too big, missing or not JPEG/PNG. */
async function inlinePicture(url: string): Promise<string | null> {
  // Public https pictures only: never an internal or plain-http address.
  if (!isPublicHttps(url)) return null;
  const controller = new AbortController();
  const work = (async () => {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "TixtapeLinkPreview/1.0 (+https://tixtape.vercel.app)",
        Accept: "image/jpeg,image/png",
      },
      redirect: "follow",
    });
    const type = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!res.ok || (type !== "image/jpeg" && type !== "image/png")) return null;
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_PICTURE_BYTES) return null;
    return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  })();
  const result = await withTimeout(work, PICTURE_TIMEOUT_MS, null);
  if (result === null) controller.abort();
  return result;
}

function isPublicHttps(raw: string): boolean {
  try {
    const u = new URL(raw);
    const host = u.hostname;
    return (
      u.protocol === "https:" &&
      host.includes(".") &&
      !/^(\d+\.){3}\d+$/.test(host) &&
      !host.includes(":") &&
      !/(^|\.)(localhost|internal|local)$/i.test(host)
    );
  } catch {
    return false;
  }
}

async function toResponse(image: ImageResponse): Promise<Response> {
  const png = Buffer.from(await image.arrayBuffer());
  const headers = { "Cache-Control": OG_CACHE_CONTROL };
  try {
    const { default: sharp } = await import("sharp");
    const jpeg = await sharp(png).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    return new Response(new Uint8Array(jpeg), {
      headers: { ...headers, "Content-Type": "image/jpeg" },
    });
  } catch {
    return new Response(new Uint8Array(png), {
      headers: { ...headers, "Content-Type": "image/png" },
    });
  }
}

export async function renderEventCard(plan: OgCardPlan): Promise<Response> {
  const [loadedFonts, logoUrl, pictures] = await Promise.all([
    loadFonts(),
    loadLogo(),
    Promise.all(plan.pictures.map(inlinePicture)).then((p) => p.filter((x) => x !== null)),
  ]);
  const image = new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: NIGHT,
        border: `16px solid ${plan.tone}`,
        color: "#f5f5f7",
        fontFamily: "Inter",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "60%",
          padding: "44px 40px 40px 48px",
        }}
      >
        <Brand logoUrl={logoUrl} />
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontFamily: "Bricolage",
              fontSize: plan.titleSize,
              lineHeight: 1.02,
              letterSpacing: "-0.02em",
              lineClamp: 3,
              display: "block",
            }}
          >
            {plan.title}
          </div>
          <div style={{ marginTop: 22, fontSize: 32, color: plan.tone }}>{plan.dateLine}</div>
          {plan.names && (
            <div
              style={{
                marginTop: 14,
                fontSize: 26,
                color: "#c9c9d6",
                lineClamp: 2,
                display: "block",
              }}
            >
              {plan.names}
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            alignSelf: "flex-start",
            background: LIME,
            color: NIGHT,
            fontSize: 28,
            fontFamily: "Bricolage",
            padding: "8px 22px",
            borderRadius: 999,
            border: `3px solid ${NIGHT}`,
            boxShadow: `4px 5px 0 0 ${plan.tone}`,
            transform: "rotate(-3deg)",
          }}
        >
          {plan.sticker}
        </div>
      </div>
      <Picture pictures={pictures} focus={plan.focus} tone={plan.tone} logoUrl={logoUrl} />
    </div>,
    { ...OG_SIZE, fonts: loadedFonts.length ? loadedFonts : undefined },
  );
  return toResponse(image);
}

export async function renderBrandCard(): Promise<Response> {
  const [loadedFonts, logoUrl] = await Promise.all([loadFonts(), loadLogo()]);
  const image = new ImageResponse(
    <div
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        height: "100%",
        background: NIGHT,
        border: `16px solid ${LIME}`,
        color: "#f5f5f7",
        padding: "0 72px",
        fontFamily: "Bricolage",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", width: "64%" }}>
        <div style={{ fontSize: 96, lineHeight: 0.98, letterSpacing: "-0.03em" }}>Every gig.</div>
        <div style={{ fontSize: 96, lineHeight: 0.98, color: LIME, letterSpacing: "-0.03em" }}>
          Its playlist.
        </div>
        <div style={{ marginTop: 28, fontSize: 34, fontFamily: "Inter", color: "#c9c9d6" }}>
          Concert setlists on Spotify
        </div>
      </div>
      {logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- rendered by next/og, not the DOM
        <img
          src={logoUrl}
          alt=""
          width={340}
          height={340}
          style={{ marginLeft: "auto", transform: "rotate(-6deg)" }}
        />
      )}
    </div>,
    { ...OG_SIZE, fonts: loadedFonts.length ? loadedFonts : undefined },
  );
  return toResponse(image);
}

function Brand({ logoUrl }: { logoUrl: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", fontFamily: "Bricolage", fontSize: 34 }}>
      {logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- rendered by next/og, not the DOM
        <img src={logoUrl} alt="" width={56} height={56} style={{ marginRight: 14 }} />
      )}
      Tixtape
    </div>
  );
}

/** Right 40%: the poster, a photo grid, or (no pictures) the logo on the event's colour. */
function Picture({
  pictures,
  focus,
  tone,
  logoUrl,
}: {
  pictures: string[];
  focus: OgCardPlan["focus"];
  tone: string;
  logoUrl: string;
}) {
  const box = { display: "flex", width: "40%", height: "100%", background: tone } as const;
  if (pictures.length === 0) {
    return (
      <div style={{ ...box, alignItems: "center", justifyContent: "center" }}>
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- rendered by next/og, not the DOM
          <img
            src={logoUrl}
            alt=""
            width={300}
            height={300}
            style={{ transform: "rotate(-6deg)" }}
          />
        )}
      </div>
    );
  }
  const W = 0.4 * (OG_SIZE.width - 32);
  const H = OG_SIZE.height - 32;
  const cols = pictures.length >= 2 ? 2 : 1;
  const rows = pictures.length >= 3 ? 2 : 1;
  return (
    <div style={{ ...box, flexDirection: "column", flexWrap: "wrap", background: NIGHT }}>
      {pictures.map((src, i) => {
        // Columns fill top to bottom; with three photos the first fills the left column.
        const tall = pictures.length === 3 && i === 0;
        const w = W / cols;
        const h = tall ? H : H / rows;
        return (
          // eslint-disable-next-line @next/next/no-img-element -- rendered by next/og, not the DOM
          <img
            key={i}
            src={src}
            alt=""
            width={w}
            height={h}
            style={{ objectFit: "cover", objectPosition: focus === "top" ? "50% 15%" : "50% 50%" }}
          />
        );
      })}
    </div>
  );
}
