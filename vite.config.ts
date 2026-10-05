import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // One base path for the app, its /data files (import.meta.env.BASE_URL) and Cesium's static
  // assets, e.g. `BASE=/history-of-earth/ npm run build` for a project page. Defaults to "/".
  const base = loadEnv(mode, '.', '').BASE || '/';
  return {
    base,
    define: {
      // Cesium static assets live in public/cesium (copied by scripts/copy-cesium.mjs on postinstall).
      CESIUM_BASE_URL: JSON.stringify(`${base}cesium/`),
    },
    build: {
      // Cesium alone is ~4 MB minified; it gets its own long-lived chunk (below).
      chunkSizeWarningLimit: 4500,
      rolldownOptions: {
        output: {
          // Cesium changes only on upgrades, the app (and its event data) often: keep them apart
          // so a content edit does not make returning visitors download Cesium again.
          codeSplitting: {
            groups: [{ name: 'cesium', test: /[\\/]node_modules[\\/]@?cesium[\\/]/ }],
          },
        },
      },
    },
    server: { port: 5173 },
  };
});
