import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for pure domain logic (matching, idempotency classification, waiver
// version). Page and full request/response flows are covered by Playwright E2E.
const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "lib/**/*.test.ts",
      "app/**/*.test.{ts,tsx}",
      "components/**/*.test.{ts,tsx}",
    ],
  },
  resolve: {
    alias: { "@": root },
  },
});
