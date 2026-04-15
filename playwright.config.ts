import { defineConfig } from "@playwright/test";
import { config } from "dotenv";
import path from "path";

config({ path: path.resolve(__dirname, ".env.local") });

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /global-setup\.ts/ },
    {
      name: "admin",
      testMatch: /admin\/.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { storageState: "e2e/.auth/admin.json" },
    },
    {
      name: "member",
      testMatch: /member\/.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { storageState: "e2e/.auth/member.json" },
    },
    {
      name: "public",
      testMatch: /public\/.*\.spec\.ts/,
    },
  ],
});
