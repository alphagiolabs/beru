import { mergeConfig } from "vite";
import base from "../../vite.config.js";

export default mergeConfig(base, {
  server: {
    watch: {
      ignored: ["**/.tmp/**", "**/.audit-tmp/**", "**/build/**", "**/bin/**", "**/dist/**"],
    },
  },
});
