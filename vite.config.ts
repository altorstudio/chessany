import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Cross-Origin isolation headers let multi-threaded WASM engines use
// SharedArrayBuffer. Single-threaded engines work without them, but enabling
// them here keeps the door open for threaded Stockfish builds.
const crossOriginIsolation = {
  name: "cross-origin-isolation",
  configureServer(server: any) {
    server.middlewares.use((_req: any, res: any, next: any) => {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      next();
    });
  },
};

export default defineConfig({
  // Relative base so the build works when loaded from file:// inside the
  // Capacitor native shells (iOS/Android), not just from a web server root.
  base: "./",
  plugins: [react(), crossOriginIsolation],
  server: {
    port: 5173,
  },
  // The engine workers in public/engines are plain classic scripts loaded at
  // runtime; keep Vite from trying to pre-bundle or transform them.
  optimizeDeps: {
    exclude: [],
  },
});
