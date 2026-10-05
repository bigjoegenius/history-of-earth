// Copies the CesiumJS static assets (Workers, ThirdParty, Assets, Widgets) into public/cesium
// so they are served identically by `vite dev` and `vite build`.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const src = resolve('node_modules/cesium/Build/Cesium');
const dest = resolve('public/cesium');
if (!existsSync(src)) {
  console.error('cesium not installed; run npm install first');
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ['Workers', 'ThirdParty', 'Assets', 'Widgets']) {
  cpSync(resolve(src, dir), resolve(dest, dir), { recursive: true });
}
console.log('Copied Cesium assets to public/cesium');
