import { ButtonLink } from "@/components/ui/Button";
import { Sticker } from "@/components/ui/Sticker";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <Sticker tone="pink" size="md" emoji="🫠" tilt={-4}>
        404
      </Sticker>
      <h1 className="mt-5 font-display text-huge font-extrabold">Not on the bill</h1>
      <ButtonLink href="/" size="lg" className="mt-8">
        Back home
      </ButtonLink>
    </div>
  );
}
