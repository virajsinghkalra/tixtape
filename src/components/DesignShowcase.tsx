import type { ReactNode } from "react";
import { DesignDemos } from "./DesignDemos";
import { Button, ButtonLink } from "./ui/Button";
import { Card } from "./ui/Card";
import { Chip, ChipButton } from "./ui/Chip";
import { Countdown } from "./ui/Countdown";
import { Marquee } from "./ui/Marquee";
import { Skeleton } from "./ui/Skeleton";
import { Sticker } from "./ui/Sticker";
import { StoryRing } from "./ui/StoryRing";
import { Tile } from "./ui/Tile";
import { BLOCK_TONES, TONES } from "./ui/tone";

const DAY = 86_400_000;

/** Every primitive and variant, for /design. */
export function DesignShowcase({ now, theme }: { now: string; theme: "light" | "dark" }) {
  const t = new Date(now).getTime();
  const at = (days: number) => new Date(t + days * DAY).toISOString();
  return (
    <div className="mt-6 space-y-10">
      <Group title="Colour blocks">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
          {TONES.map((tone) => (
            <Tile key={tone} tone={tone} className="text-sm font-bold">
              {tone}
            </Tile>
          ))}
        </div>
      </Group>

      <Group title="Type scale">
        <p className="font-display text-mega font-extrabold">Mega</p>
        <p className="font-display text-huge font-extrabold">Huge</p>
        <p className="font-display text-big font-extrabold">Big</p>
        <p>
          Body text in Inter, with a <span className="text-muted">muted</span> tone.
        </p>
      </Group>

      <Group title="Buttons">
        <div className="flex flex-wrap gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="night">Night</Button>
          <Button size="lg">Large</Button>
          <Button disabled>Disabled</Button>
          <ButtonLink href="/design" variant="secondary">
            Link button
          </ButtonLink>
        </div>
      </Group>

      <Group title="Chips and stickers">
        <div className="flex flex-wrap items-center gap-3">
          <Chip>Chip</Chip>
          <ChipButton>Tap chip</ChipButton>
          <ChipButton selected>Selected</ChipButton>
          {BLOCK_TONES.map((tone, i) => (
            <Sticker key={tone} tone={tone} emoji="✦" tilt={i % 2 ? 3 : -3}>
              {tone}
            </Sticker>
          ))}
          <Sticker tone="night" size="md" emoji="🎪">
            Festival
          </Sticker>
        </div>
      </Group>

      <Group title="Countdown (live badges)">
        <div className="flex flex-wrap gap-3">
          <Countdown startsAt={at(0.4)} endsAt={null} now={now} />
          <Countdown startsAt={at(1)} endsAt={null} now={now} />
          <Countdown startsAt={at(21)} endsAt={null} now={now} />
          <Countdown startsAt={at(90)} endsAt={null} now={now} />
          <Countdown startsAt={at(-1)} endsAt={at(1)} now={now} />
        </div>
      </Group>

      <Group title="Story rings">
        <div className="flex gap-3">
          <StoryRing label="NH7 Weekender" face="12" subface="Dec" tone="pink" />
          <StoryRing label="Lollapalooza" face="23" subface="Jan" tone="lime" />
          <StoryRing label="Seen" face="6" subface="Feb" tone="sky" seen />
        </div>
      </Group>

      <Group title="Card, tile and skeleton">
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="p-5">A plain card on the surface.</Card>
          <Tile tone="violet">A violet tile with white text.</Tile>
          <div className="space-y-2">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </Group>

      <Group title="Marquee">
        <Marquee
          label={`Marquee demo (${theme})`}
          items={["Olivia Dean", "Seedhe Maut", "Diljit"]}
          tone="lime"
          className="rounded-card"
        />
      </Group>

      <Group title="Interactive: sheet, story, toast, confetti">
        <DesignDemos theme={theme} />
      </Group>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-bold tracking-wider text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}
