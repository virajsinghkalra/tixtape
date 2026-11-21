"use client";

import { useState } from "react";
import { Button } from "./ui/Button";
import { Confetti } from "./ui/Confetti";
import { Sheet } from "./ui/Sheet";
import { StoryViewer, type Story } from "./ui/StoryViewer";
import { useToast } from "./ui/Toast";

const SLIDES: Story[] = [
  {
    id: "a",
    tone: "lime",
    label: "One",
    content: <p className="font-display text-huge font-extrabold">Slide one</p>,
  },
  {
    id: "b",
    tone: "violet",
    label: "Two",
    content: <p className="font-display text-huge font-extrabold">Slide two</p>,
  },
  {
    id: "c",
    tone: "pink",
    label: "Three",
    content: <p className="font-display text-huge font-extrabold">Slide three</p>,
  },
];

/** Client-side demos for /design. */
export function DesignDemos({ theme }: { theme: string }) {
  const toast = useToast();
  const [sheet, setSheet] = useState(false);
  const [story, setStory] = useState(false);
  const [burst, setBurst] = useState(0);
  return (
    <div className="space-y-4">
      <div className="relative flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => setSheet(true)}>
          Open sheet
        </Button>
        <Button variant="secondary" onClick={() => setStory(true)}>
          Open story
        </Button>
        <Button variant="secondary" onClick={() => toast.show(`Hello from the ${theme} panel 👋`)}>
          Toast
        </Button>
        <Button variant="secondary" onClick={() => toast.show("Something broke", "error")}>
          Error toast
        </Button>
        <Button onClick={() => setBurst((n) => n + 1)}>Confetti 🎉</Button>
        {burst > 0 && <Confetti key={burst} />}
      </div>
      <Sheet open={sheet} onClose={() => setSheet(false)} closeLabel="Close">
        {sheet && (
          <div className="rounded-card border border-line bg-surface p-4">
            Full-screen on phones, inline on larger screens.{" "}
            <button
              type="button"
              className="min-h-11 font-semibold underline"
              onClick={() => setSheet(false)}
            >
              Close
            </button>
          </div>
        )}
      </Sheet>
      <StoryViewer title="Inline story demo" slides={SLIDES} />
      <StoryViewer
        variant="modal"
        open={story}
        onClose={() => setStory(false)}
        title="Modal story demo"
        slides={SLIDES}
      />
    </div>
  );
}
