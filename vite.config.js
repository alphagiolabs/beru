import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { createRequire } from "module";
import pkg from "./package.json" with { type: "json" };

const require = createRequire(import.meta.url);

// Bundle analysis: set VITE_BERU_ANALYZE=1 and install rollup-plugin-visualizer
// to generate a stats report at dist/stats.html
let visualizer = null;
if (process.env.VITE_BERU_ANALYZE === "1") {
  try {
    const { visualizer: vizPlugin } = require("rollup-plugin-visualizer");
    visualizer = vizPlugin({ filename: "dist/stats.html", open: true });
  } catch {
    console.warn("[beru] VITE_BERU_ANALYZE=1 but rollup-plugin-visualizer not installed");
  }
}

const devPort = Number(process.env.BERU_DEV_PORT || 5173);

export default defineConfig({
  plugins: [react(), ...(visualizer ? [visualizer] : [])],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  base: "./",
  root: ".",
  build: {
    outDir: "build",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          xlsx: ["xlsx"],
          icons: ["lucide-react"],
          vendor: ["react", "react-dom", "zustand"],
        },
      },
    },
  },
  resolve: { alias: { "@": path.resolve("./src") } },
  server: { port: devPort, strictPort: true },
});
