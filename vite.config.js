import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  root: ".",
  build: { outDir: "build", emptyOutDir: true },
  resolve: { alias: { "@": path.resolve("./src") } },
  server: { port: 5173, strictPort: true },
});
