import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: "jsdom",
    globals: false,
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
