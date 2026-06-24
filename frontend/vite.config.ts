import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,woff}"],
        maximumFileSizeToCacheInBytes: 5000000,
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: "NetworkOnly", // API 请求不缓存
          },
        ],
      },
      manifest: {
        name: "Image Optimizer & Cleaner",
        short_name: "ImgOpt",
        description: "二合一局部消除与切图增强工具",
        theme_color: "#5b5ce2",
        background_color: "#0c0d12",
        display: "standalone",
        orientation: "any",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
