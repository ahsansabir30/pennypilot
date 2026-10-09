import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    pool: "threads",
    fileParallelism: false,
  },
  // Lowest supported system webviews (WebView2 on Windows, WebKit elsewhere). Safari 14 is the
  // floor rather than Tauri's suggested safari13 because money arithmetic uses BigInt literals.
  build: {
    target: ["chrome105", "safari14"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
