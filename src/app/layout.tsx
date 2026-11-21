import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader, type HeaderUser } from "@/components/SiteHeader";
import { ToastProvider } from "@/components/ui/Toast";
import { SESSION_COOKIE } from "@/server/auth/cookies";
import { authService } from "@/server/auth/spotify-auth";
import "./globals.css";

const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  title: {
    default: "Tixtape · Every ticket gets a mixtape",
    template: "%s · Tixtape",
  },
  description: "Every lineup. One playlist. Concerts and festivals across India.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0f" },
    { media: "(prefers-color-scheme: light)", color: "#f3f3f7" },
  ],
};

/** The signed-in user for the header, or null. Login is optional, so any failure means "logged out". */
async function headerUser(): Promise<HeaderUser | null> {
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;
  try {
    const user = await authService().getSessionUser(sessionId);
    return user ? { name: user.displayName?.trim() || "Spotify listener" } : null;
  } catch (err) {
    console.error("Could not read the session for the header", err);
    return null;
  }
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await headerUser();
  return (
    <html lang="en-IN" className={`${bricolage.variable} ${inter.variable} ${jetbrains.variable}`}>
      <body className="flex min-h-dvh flex-col antialiased">
        <ToastProvider>
          {/* Off-screen until focused, but full-size so it's a real tap target. */}
          <a
            href="#main"
            className="fixed top-3 left-3 z-[80] inline-flex min-h-11 -translate-y-[200%] items-center rounded-chip bg-lime px-5 font-semibold text-on-block focus:translate-y-0"
          >
            Skip to content
          </a>
          <SiteHeader user={user} />
          <main id="main" tabIndex={-1} className="flex-1 outline-none">
            {children}
          </main>
          <SiteFooter />
        </ToastProvider>
      </body>
    </html>
  );
}
