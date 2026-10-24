import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The built app goes into the Python package, so `wiqaya serve` runs without Node.
export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "../wiqaya/web_dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
