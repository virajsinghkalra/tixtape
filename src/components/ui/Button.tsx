import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "night";
export type ButtonSize = "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  // UX #9 "sticker press-in": the hard shadow shrinks as the button sinks.
  primary:
    "bg-lime text-on-block shadow-[0_6px_0_0_var(--color-night)] hover:-translate-y-0.5 active:translate-y-1 active:shadow-[0_2px_0_0_var(--color-night)]",
  secondary: "border-2 border-ink bg-surface text-ink hover:-translate-y-0.5",
  ghost: "text-ink hover:bg-surface-2",
  night: "bg-night text-white hover:-translate-y-0.5",
};

const SIZE: Record<ButtonSize, string> = {
  md: "min-h-11 px-5 text-sm",
  lg: "min-h-14 px-7 text-base",
};

/** Shared look for every button and button-like link: chunky, pill-shaped, springy on press. */
export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cx(
    "inline-flex select-none items-center justify-center gap-2 rounded-chip font-semibold",
    "transition-[transform,background-color,box-shadow] duration-(--duration-base) ease-spring active:duration-100",
    "active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100",
    "disabled:cursor-not-allowed disabled:opacity-60",
    "aria-disabled:cursor-not-allowed aria-disabled:opacity-60",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ variant, size, className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

type LinkProps = {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** Opens in a new tab with a screen-reader note. Use for Spotify and ticket sellers. */
  external?: boolean;
};

export function ButtonLink({ href, children, variant, size, className, external }: LinkProps) {
  const cls = buttonClass(variant, size, className);
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
        {children}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    );
  }
  // Same-page anchors and API routes are plain links; app pages use client navigation.
  if (href.startsWith("#") || href.startsWith("/api/")) {
    return (
      <a href={href} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}
