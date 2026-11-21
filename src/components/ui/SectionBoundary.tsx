"use client";

import { Component, type ReactNode } from "react";
import { Button } from "./Button";

type Props = { children: ReactNode; /** Names the section for screen readers. */ label?: string };
type State = { failed: boolean };

/**
 * D-084 (UX plan #13): isolates one section, so a failing story strip or panel shows a compact
 * "Couldn't load this · Retry" instead of taking down the whole page. Retry re-mounts the
 * children; the error is logged, never shown.
 */
export class SectionBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.error(error);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="group"
        aria-label={this.props.label}
        className="flex flex-wrap items-center justify-center gap-3 rounded-card border-2 border-dashed border-line px-6 py-8 text-center"
      >
        <p className="font-display text-xl font-extrabold">
          <span aria-hidden>🫥</span> Couldn&apos;t load this
        </p>
        <Button variant="secondary" onClick={() => this.setState({ failed: false })}>
          Retry
        </Button>
      </div>
    );
  }
}
