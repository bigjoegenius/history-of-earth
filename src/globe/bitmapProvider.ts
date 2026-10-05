import * as Cesium from 'cesium';

/**
 * A single global equirectangular image as a Cesium imagery provider. It reuses
 * SingleTileImageryProvider (geographic tiling, one level-0 tile) but serves an in-memory,
 * already decoded ImageBitmap instead of fetching a URL, which avoids PNG-encoding
 * multi-megapixel canvases into data URLs.
 */
export class BitmapImageryProvider extends Cesium.SingleTileImageryProvider {
  constructor(readonly bitmap: ImageBitmap) {
    // The URL is never fetched because requestImage is overridden.
    super({ url: 'data:,', tileWidth: bitmap.width, tileHeight: bitmap.height });
  }

  override requestImage(): Promise<ImageBitmap> {
    return Promise.resolve(this.bitmap);
  }
}
