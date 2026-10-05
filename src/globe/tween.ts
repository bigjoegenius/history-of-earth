/**
 * Calls `step(t)` on animation frames with t eased from 0 to 1 over `ms`, then `done()`.
 * Returns a cancel function (after cancelling, neither callback fires again).
 */
export function tween(ms: number, step: (t: number) => void, done?: () => void): () => void {
  const start = performance.now();
  let raf = 0;
  const frame = (now: number): void => {
    const t = Math.min(1, (now - start) / ms);
    step(t * t * (3 - 2 * t));
    if (t < 1) raf = requestAnimationFrame(frame);
    else done?.();
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
