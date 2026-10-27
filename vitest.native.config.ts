import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["tests/native/**/*.native.test.ts"],
    setupFiles: ["tests/native/setup.ts"], maxWorkers: 1, fileParallelism: false },
});
