import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Vitest runs the pure domain/reorder logic and the mocked server-action tests in
// a Node environment. The `@/*` alias mirrors tsconfig so tests import modules the
// same way app code does.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
