import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const devPort = Number(process.env.BERU_DEV_PORT || 5173);

export default defineConfig({
  plugins: [react()],
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
