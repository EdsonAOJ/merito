import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
  globalCss: {
    "html, body": {
      bg: "#0f172a",
      color: "#f1f5f9",
    },
  },
});

export const system = createSystem(defaultConfig, config);
