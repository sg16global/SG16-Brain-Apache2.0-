import { defineConfig } from "vite";

// The sovereign host (sg16.server) serves this directory raw as ES modules.
// Vite is an *optional* build path for people who want a bundled dist/; the
// runtime never requires it, which is what keeps the brain air-gapped-friendly.
export default defineConfig({
  root: ".",
  publicDir: "public",
  server: {
    host: "0.0.0.0",
    port: 5173,
    // The brain API lives on the sovereign host; proxy it so the Vite dev
    // server never needs a CORS exception and never leaks the origin.
    proxy: {
      "/api": { target: "http://127.0.0.1:8080", changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2020",
  },
});
