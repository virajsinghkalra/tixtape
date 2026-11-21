/**
 * D-084: resolves with `fallback` when `work` takes longer than `ms` (or rejects), so a slow
 * optional read never holds a page hostage. The work itself isn't cancelled; its late result or
 * error is dropped.
 */
export function withTimeout<T, F>(work: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
