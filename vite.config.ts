import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';

/* Mécanique Mobile H.I.S — build.
   - base './' : the same files work at the root of mecanique-mobile-his.vercel.app and at hostnextline.github.io/garage2.0/.
   - two pages: the team app (index.html) and the public client page (client.html: estimate, invoice, payment, tracking).
   - the service worker precaches the app shell (fast start with no signal) and never caches data or API calls. */
/* when this version was made (the commit's time on GitHub), and the version file the running app reads to know whether a
   newer one exists and whether it is important (a commit with « [important] » in its message since this one) */
const BUILT_AT = process.env.VITE_BUILT_AT || new Date().toISOString();

export default defineConfig(({ mode }) => ({
  base: './',
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  define: { __BUILT_AT__: JSON.stringify(BUILT_AT) },
  plugins: [
    preact(),
    {
      name: 'version-file',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset', fileName: 'version.json',
          source: JSON.stringify({
            version: process.env.VITE_APP_VERSION || 'dev', built_at: BUILT_AT,
            important_since: process.env.APP_IMPORTANT_SINCE || null, notes: process.env.APP_NOTES || null
          })
        });
      }
    },
    {
      /* the customer's page is not the team app: no « Installer l'app » offer there */
      name: 'client-page-without-manifest',
      transformIndexHtml: {
        order: 'post',
        handler(html: string, ctx: { path: string }) {
          return ctx.path.endsWith('client.html') ? html.replace(/\s*<link rel="manifest"[^>]*>/g, '') : html;
        }
      }
    },
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifestFilename: 'manifest.webmanifest',
      includeAssets: ['icons/*.png', 'logo-his.png'],
      manifest: {
        id: './',
        name: 'Mécanique Mobile H.I.S',
        short_name: 'H.I.S',
        description: 'Réservations, jobs, factures et équipe du garage mobile.',
        lang: 'fr-CA',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webp,woff2,webmanifest,json}'],
        globIgnores: ['**/client.html', '**/assets/client-*.js', '**/assets/client-*.css', '**/version.json'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/client\.html/],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        /* the alert while the app is closed (« Texto entrant »): public/push-sw.js */
        importScripts: ['push-sw.js'],
        runtimeCaching: [
          { /* map tiles: kept a little while so the map still shows with weak signal */
            urlPattern: ({ url }) => /tile\.openstreetmap\.org$/.test(url.hostname),
            handler: 'CacheFirst',
            options: { cacheName: 'tuiles', expiration: { maxEntries: 600, maxAgeSeconds: 14 * 24 * 3600 } }
          },
          { /* the heavy tools loaded only when used (receipt reader, barcode reader) */
            urlPattern: ({ url }) => url.hostname === 'cdn.jsdelivr.net',
            handler: 'CacheFirst',
            options: { cacheName: 'outils', expiration: { maxEntries: 40, maxAgeSeconds: 60 * 24 * 3600 }, cacheableResponse: { statuses: [0, 200] } }
          },
          { /* the barcode reader (VIN), our own file: downloaded the first time a VIN is scanned, then kept */
            urlPattern: ({ url }) => url.pathname.endsWith('.wasm'),
            handler: 'CacheFirst',
            options: { cacheName: 'outils-garage', expiration: { maxEntries: 4, maxAgeSeconds: 120 * 24 * 3600 } }
          },
          { /* the lists of car models (NHTSA), kept so a model already seen opens without signal */
            urlPattern: ({ url }) => url.hostname === 'vpic.nhtsa.dot.gov',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'modeles', expiration: { maxEntries: 300, maxAgeSeconds: 90 * 24 * 3600 }, cacheableResponse: { statuses: [0, 200] } }
          }
        ]
      },
      devOptions: { enabled: false }
    })
  ],
  build: {
    target: 'es2022',
    sourcemap: mode !== 'production' ? true : false,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        client: resolve(__dirname, 'client.html')
      }
    }
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test-setup.ts']
  }
}));
