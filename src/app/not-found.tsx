import { ButtonLink } from "@/components/ui/Button";
import { Sticker } from "@/components/ui/Sticker";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <Sticker tone="pink" size="md" emoji="🫠" tilt={-4}>
        404
      </Sticker>
      <h1 className="mt-5 font-display text-huge font-extrabold">
        This show isn&apos;t on the bill
      </h1>
      <p className="mt-4 text-muted">
        The event may have been removed, or the link is wrong. Search for it from the home page.
      </p>
      <ButtonLink href="/" size="lg" className="mt-8">
        Back home
      </ButtonLink>
    </div>
  );
}
