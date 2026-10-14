import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: [
      "tests/unit/**/*.test.{ts,tsx}",
      "tests/evaluation/**/*.test.ts",
      "tests/integration/**/*.test.{ts,tsx}",
    ],
    clearMocks: true,
    // Bound simultaneous jsdom/PGlite runtimes. In the default parallel run the 12k-catalog
    // replay exceeded 5s under contention, while the isolated file took 3.08s.
    maxWorkers: 4,
  },
});
