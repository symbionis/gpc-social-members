import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Unit tests for pure domain logic (matching, idempotency classification, waiver
// version) plus React component tests (jsdom, opted in per-file via a
// `@vitest-environment jsdom` docblock). Page and full request/response flows are
// covered by Playwright E2E.
const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
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
