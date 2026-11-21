import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminNav } from "@/components/admin/AdminNav";
import { requireAdminPage } from "./admin-guard";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · Admin · Tixtape" },
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Admin console shell (P3.5). Every page also calls `requireAdminPage()` itself; there is
 * deliberately no loading.tsx, so a non-admin gets a real 404 status (QA-UI-1).
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdminPage();
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
      <AdminNav />
      {children}
    </div>
  );
}
