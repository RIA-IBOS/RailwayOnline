import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png', 'favicon-196.png'],
      manifest: {
        name: 'RIA 铁路在线地图',
        short_name: 'RIA铁路',
        description: 'RIA 铁路在线地图应用',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'manifest-icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'manifest-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'manifest-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/data\/.*\.json$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'railway-data',
              expiration: {
                maxAgeSeconds: 7 * 24 * 60 * 60, // 7 天
              },
              networkTimeoutSeconds: 10,
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
});
