import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import pkg from "./package.json" with { type: "json" };

const devPort = Number(process.env.BERU_DEV_PORT || 5173);

export default defineConfig({
  plugins: [react()],
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
        },
      },
    },
  },
  resolve: { alias: { "@": path.resolve("./src") } },
  server: { port: devPort, strictPort: true },
});
