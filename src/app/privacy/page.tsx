import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DeleteMyData } from "@/components/identity/DeleteMyData";
import { CONSENT_TEXT } from "@/domain/analytics/identity";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Tixtape collects, why, for how long, and how to delete it.",
};

const CONTACT = "lineupmixes@gmail.com";

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-xl font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

/**
 * D-090: the privacy notice, in plain short language (DPDP Act 2023: what, why, how long,
 * your rights, who to contact), with "Delete my data".
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-10 sm:px-6">
      <h1 className="font-display text-huge font-extrabold">
        Privacy <span aria-hidden>🔒</span>
      </h1>

      <Block title="What we collect">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            A random ID stored in your browser. It isn&apos;t built from your device and we
            don&apos;t fingerprint.
          </li>
          <li>
            What you do here: pages, searches, gigs opened, shares, saves, reminders and playlist
            taps.
          </li>
          <li>Your rough city and how you found us (e.g. WhatsApp, Google).</li>
          <li>Only if you choose: a nickname, and your name and email.</li>
        </ul>
        <p className="text-muted">
          We never store your IP address, exact location or full web addresses you came from.
        </p>
      </Block>

      <Block title="Why">
        <p>
          To see what people use, fix what&apos;s broken, and find gigs people want. Your email is
          only for gig updates you asked for, when you ticked &ldquo;{CONSENT_TEXT}&rdquo;. We
          don&apos;t sell or share your data, and there are no ad trackers.
        </p>
      </Block>

      <Block title="How long">
        <p>
          Activity is deleted after 180 days. Your nickname and email stay until you delete them.
        </p>
      </Block>

      <Block title="Your choices">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Turn on Do Not Track or Global Privacy Control in your browser and we record nothing.
          </li>
          <li>Unsubscribe anytime, or ask us what we hold or to fix it.</li>
          <li>Delete everything linked to this browser:</li>
        </ul>
        <div className="mt-2">
          <DeleteMyData />
        </div>
      </Block>

      <Block title="Contact">
        <p>
          Questions or requests:{" "}
          <a className="font-semibold underline" href={`mailto:${CONTACT}`}>
            {CONTACT}
          </a>
        </p>
      </Block>
    </div>
  );
}
