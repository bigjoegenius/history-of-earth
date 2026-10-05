/**
 * Size of the whole-globe paleo and borders rasters. A 4096 × 2048 bitmap is ~34 MB, plus a GPU
 * texture with mipmaps for every layer on screen, which phones and low-memory devices cannot afford
 * several of during a long playback: they get 2048 × 1024 (a quarter of the memory).
 */
export function globalRasterSize(): { width: number; height: number } {
  // deviceMemory (GB, capped at 8) is Chromium-only; iOS Safari exposes nothing, hence the media checks.
  const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const constrained = memoryGb <= 4 || window.matchMedia('(max-width: 799px), (pointer: coarse)').matches;
  return constrained ? { width: 2048, height: 1024 } : { width: 4096, height: 2048 };
}
