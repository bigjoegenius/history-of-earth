/**
 * Publishes the band of the screen the overlay leaves uncovered as `--hoe-view-top` and
 * `--hoe-view-bottom` (px from each edge) on :root. The globe camera reads them so that a flight
 * lands its target in that band (src/globe/camera.ts): on phones the bottom sheet and controls
 * cover the lower half of the screen, so the screen centre is often hidden.
 * Written on :root because the globe is not inside the `.hoe-ui` overlay.
 */
import type { Disposer } from './dom';

/**
 * `top` lists the overlay elements along the top edge (timeline, year readout); one counts only
 * while it spans the screen's vertical centre line, as the readout does on phones but not on wide
 * screens, where it sits off to the left. Returns a function that re-measures (call it after
 * layout changes the observers cannot see).
 */
export function publishViewInsets(top: HTMLElement[], controls: HTMLElement, d: Disposer): () => void {
  const vars = document.documentElement.style;
  const sync = (): void => {
    const cx = window.innerWidth / 2;
    const topInset = Math.max(0, ...top.map((el) => el.getBoundingClientRect())
      .filter((r) => r.height > 0 && r.left <= cx && r.right >= cx)
      .map((r) => r.bottom));
    // The controls ride above the bottom sheet on phones, so their top edge bounds both.
    const bottom = window.innerHeight - controls.getBoundingClientRect().top;
    vars.setProperty('--hoe-view-top', `${Math.round(topInset)}px`);
    vars.setProperty('--hoe-view-bottom', `${Math.max(0, Math.round(bottom))}px`);
  };
  const ro = new ResizeObserver(sync);
  for (const el of [...top, controls]) ro.observe(el);
  d.listen(window, 'resize', sync);
  d.add(() => {
    ro.disconnect();
    vars.removeProperty('--hoe-view-top');
    vars.removeProperty('--hoe-view-bottom');
  });
  sync();
  return sync;
}
