import { defineConfig } from "vitest/config";
import os from "node:os";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/helpers/globalSetup.ts"],
    fileParallelism: false,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://printer:printer@localhost:5432/printer_test?schema=public",
      FRONTEND_URL: "http://localhost:3000",
      API_PUBLIC_URL: "http://localhost:4000",
      APP_SECRET: "test-secret-0123456789-0123456789-abcdef",
      PAYMENT_PROVIDER: "mock",
      FAPSHI_WEBHOOK_SECRET: "whsec-test-123",
      STORAGE_DRIVER: "local",
      STORAGE_LOCAL_DIR: path.join(os.tmpdir(), "ps-test-storage"),
      WORKER_INLINE: "false",
      LOG_LEVEL: "silent",
    },
  },
});
