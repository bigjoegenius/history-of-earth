/** Mouse interaction with markers: click to select, pointer cursor on hover. */
import * as Cesium from 'cesium';

const HOVER_THROTTLE_MS = 60;

/**
 * `isMarker` filters picks to event markers (billboards and labels carry the event id).
 * Returns a function that removes the handlers.
 */
export function attachPicking(
  scene: Cesium.Scene, isMarker: (id: string) => boolean, onClick: (id: string) => void,
): () => void {
  const pickId = (pos: Cesium.Cartesian2): string | null => {
    const picked: unknown = scene.pick(pos);
    const id = (picked as { id?: unknown } | undefined)?.id;
    return typeof id === 'string' && isMarker(id) ? id : null;
  };

  const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
  handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
    const id = pickId(e.position);
    if (id) onClick(id);
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

  // Picking renders an off-screen pass, so hover checks are throttled.
  let latest: Cesium.Cartesian2 | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  handler.setInputAction((e: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
    latest = Cesium.Cartesian2.clone(e.endPosition, latest ?? undefined);
    timer ??= setTimeout(() => {
      timer = undefined;
      if (latest && !scene.isDestroyed()) scene.canvas.style.cursor = pickId(latest) ? 'pointer' : '';
    }, HOVER_THROTTLE_MS);
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  return () => {
    clearTimeout(timer);
    handler.destroy();
  };
}
