/** Cesium Viewer construction and the satellite imagery layers (no Cesium ion, no API keys). */
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';

/** Height above which ESRI tiles are not requested (they only add detail when zoomed in). */
const HI_RES_MIN_TERRAIN_LEVEL = 5;

/**
 * GIBS EPSG:4326 tile matrices are not a plain 180° pyramid: level 0 is two 512 px tiles of
 * 288° each (0.5625°/px) anchored at (-180°, 90°), padded beyond the globe; level n has
 * 288/2^n° tiles (3×2 at level 1, 5×3 at level 2, …). Describing that padded extent keeps tiles
 * georeferenced correctly and stops requests for tiles GIBS does not have (HTTP 400).
 */
const GIBS_TILING = new Cesium.GeographicTilingScheme({
  rectangle: Cesium.Rectangle.fromDegrees(-180, -198, 396, 90),
  numberOfLevelZeroTilesX: 2,
  numberOfLevelZeroTilesY: 1,
});
/** The "500m" matrix set stops at level 7 (160 × 80 tiles). */
const GIBS_MAX_LEVEL = 7;

export interface GlobeViewer {
  viewer: Cesium.Viewer;
  /** NASA GIBS Blue Marble (shaded relief + bathymetry). */
  base: Cesium.ImageryLayer;
  /** ESRI World Imagery, shown only at terrain level ≥ 5. */
  hiRes: Cesium.ImageryLayer;
}

export function createViewer(container: HTMLElement): GlobeViewer {
  Cesium.Ion.defaultAccessToken = ''; // silences the "no ion token" banner; ion is never used

  const gibs = new Cesium.WebMapTileServiceImageryProvider({
    url: 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_ShadedRelief_Bathymetry/default/default/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpeg',
    layer: 'BlueMarble_ShadedRelief_Bathymetry',
    style: 'default',
    format: 'image/jpeg',
    tileMatrixSetID: '500m',
    maximumLevel: GIBS_MAX_LEVEL,
    tileWidth: 512,
    tileHeight: 512,
    tilingScheme: GIBS_TILING,
    rectangle: Cesium.Rectangle.MAX_VALUE,
    // showOnScreen: provider credits otherwise go to Cesium's "Data attribution" pop-up only.
    credit: new Cesium.Credit('Imagery: NASA GIBS Blue Marble', true),
  });
  const base = new Cesium.ImageryLayer(gibs);

  // Our own credit container: the Viewer re-positions its default one with inline styles on every
  // resize, while this one is laid out by src/app/shell.css.
  const credits = document.createElement('div');
  credits.className = 'hoe-map-credits';
  container.append(credits);

  const viewer = new Cesium.Viewer(container, {
    creditContainer: credits,
    baseLayer: base,
    baseLayerPicker: false,
    geocoder: false,
    timeline: false,
    animation: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    infoBox: false,
    selectionIndicator: false,
    homeButton: false,
    fullscreenButton: false,
    terrain: undefined,
    scene3DOnly: true,
    // Render only when something changes; every module calls scene.requestRender().
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
  });

  const esri = new Cesium.UrlTemplateImageryProvider({
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    maximumLevel: 18,
    // Wording required by Esri's attribution guidelines; it must be visible on the map itself.
    credit: new Cesium.Credit('Powered by Esri · Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community', true),
  });
  const hiRes = new Cesium.ImageryLayer(esri, { minimumTerrainLevel: HI_RES_MIN_TERRAIN_LEVEL });
  viewer.imageryLayers.add(hiRes);

  const { scene } = viewer;
  scene.globe.showGroundAtmosphere = true;
  scene.screenSpaceCameraController.minimumZoomDistance = 20_000;
  scene.screenSpaceCameraController.maximumZoomDistance = 60_000_000;
  // The default double-click "track entity" behaviour has nothing to track here.
  viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

  return { viewer, base, hiRes };
}
