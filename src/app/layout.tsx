import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from "next/font/google";
import { cookies, headers } from "next/headers";
import { preconnect } from "react-dom";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader, type HeaderUser } from "@/components/SiteHeader";
import { Analytics } from "@/components/analytics/Analytics";
import { AfterPlayShare } from "@/components/AfterPlayShare";
import { Splash } from "@/components/Splash";
import { IdentityPrompts } from "@/components/identity/IdentityPrompts";
import { SavedSync } from "@/components/saved/SavedSync";
import { NavShell } from "@/components/nav/NavShell";
import { InstallNudge } from "@/components/pwa/InstallNudge";
import { NetworkBanner } from "@/components/pwa/NetworkBanner";
import { ServiceWorker } from "@/components/pwa/ServiceWorker";
import { WebVitals } from "@/components/pwa/WebVitals";
import { ImageGuard } from "@/components/ui/ImageGuard";
import { MotionProvider } from "@/components/ui/MotionProvider";
import { ToastProvider } from "@/components/ui/Toast";
import { CITY_COOKIE, visitorCity } from "@/server/location";
import { SITE_URL } from "@/lib/site";
import { withTimeout } from "@/lib/timeout";
import { SESSION_COOKIE } from "@/server/auth/cookies";
import { authService } from "@/server/auth/spotify-auth";
import "./globals.css";

const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
// Only the desktop "/" hint and admin screens use mono: don't spend phone bandwidth preloading it.
const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: "Tixtape · Every ticket gets a mixtape",
    template: "%s · Tixtape",
  },
  description: "Every gig, its playlist. Tap a show → hear its setlist on Spotify 🎧",
  metadataBase: new URL(SITE_URL),
  applicationName: "Tixtape",
  openGraph: { siteName: "Tixtape", type: "website", locale: "en_IN" },
  twitter: { card: "summary_large_image" },
  appleWebApp: { capable: true, title: "Tixtape", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0f" },
    { media: "(prefers-color-scheme: light)", color: "#f3f3f7" },
  ],
};

/** A slow session read must not hold every page (D-084): after this, render logged out. */
const SESSION_READ_TIMEOUT_MS = 1500;

/** The signed-in user for the header, or null. Login is optional, so any failure means "logged out". */
async function headerUser(): Promise<HeaderUser | null> {
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;
  const read = authService()
    .getSessionUser(sessionId)
    .catch((err: unknown) => {
      console.error("Could not read the session for the header", err);
      return null;
    });
  const user = await withTimeout(read, SESSION_READ_TIMEOUT_MS, null);
  return user ? { name: user.displayName?.trim() || "Spotify listener" } : null;
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // "Listen here": the song clip and Spotify's player connect ahead of the tap.
  preconnect("https://audio-ssl.itunes.apple.com");
  preconnect("https://open.spotify.com");
  const user = await headerUser();
  const hdrs = await headers();
  const city =
    visitorCity({ headers: await headers(), cookie: (await cookies()).get(CITY_COOKIE)?.value })
      ?.city ?? null;
  return (
    <html
      lang="en-IN"
      className={`${bricolage.variable} ${inter.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-dvh flex-col antialiased">
        <Splash nonce={nonceOf(hdrs.get("content-security-policy"))} />
        <MotionProvider>
          <ToastProvider>
            {/* Off-screen until focused, but full-size so it's a real tap target. */}
            <a
              href="#main"
              className="fixed top-3 left-3 z-[80] inline-flex min-h-11 -translate-y-[200%] items-center rounded-chip bg-lime px-5 font-semibold text-on-block focus:translate-y-0"
            >
              Skip to content
            </a>
            <SiteHeader user={user} city={city} />
            <main id="main" tabIndex={-1} className="flex-1 outline-none">
              {children}
            </main>
            <SiteFooter />
            <NavShell />
            <NetworkBanner />
            <InstallNudge />
            <ServiceWorker />
            <ImageGuard />
            <WebVitals />
            <Analytics />
            <IdentityPrompts />
            <AfterPlayShare />
            <SavedSync />
          </ToastProvider>
        </MotionProvider>
      </body>
    </html>
  );
}

/** The page's CSP nonce (set by the middleware), so the splash's one-line script may run. */
function nonceOf(csp: string | null): string | undefined {
  return csp?.match(/'nonce-([^']+)'/u)?.[1];
}
