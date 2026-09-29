import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__tests__/*.test.js"],
    env: {
      // Prevents pg.Pool from throwing on import — no real connection is made
      // during pure-function unit tests because query() is never called.
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      JWT_SECRET: "test-secret",
      CREDENTIAL_ENCRYPTION_KEY: "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=",
    },
  },
});
