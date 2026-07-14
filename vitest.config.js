import path from "path";
import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": path.resolve("./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["tests/setup.js"],
    include: ["tests/**/*.test.{js,jsx}"],
    testTimeout: 20000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{js,jsx}"],
      exclude: ["src/i18n/**", "src/main.jsx"],
      reporter: ["text", "text-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
