import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';

/* Mécanique Mobile H.I.S — build.
   - base './' : the site works at hostnextline.github.io/garage2.0/ and, later, at the root of its own domain.
   - two pages: the team app (index.html) and the public client page (client.html: estimate, invoice, payment, tracking).
   - the service worker precaches the app shell (fast start with no signal) and never caches data or API calls. */
export default defineConfig(({ mode }) => ({
  base: './',
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  plugins: [
    preact(),
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
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,webmanifest,json}'],
        globIgnores: ['**/client.html', '**/assets/client-*.js', '**/assets/client-*.css'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/client\.html/],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true,
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
