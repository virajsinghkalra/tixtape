"use client";

import { Button } from "../ui/Button";

export function ReloadButton() {
  return (
    <Button size="lg" onClick={() => window.location.reload()}>
      Try again
    </Button>
  );
}
