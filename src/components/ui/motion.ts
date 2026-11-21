/**
 * Motion tokens for the `motion` library. They mirror the CSS tokens in globals.css
 * (`--ease-spring`, `--ease-out-expo`, `--duration-*`), so CSS and JS animations feel the same.
 */
export const SPRING = { type: "spring", stiffness: 420, damping: 28 } as const;
export const SPRING_SOFT = { type: "spring", stiffness: 260, damping: 26 } as const;
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;
export const DURATION = { fast: 0.15, base: 0.25, slow: 0.5 } as const;
