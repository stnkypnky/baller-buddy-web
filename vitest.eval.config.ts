import { defineConfig } from "vitest/config";

// npm run eval: the AI accuracy evals against a real model (tests/evals).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/evals/**/*.eval.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 240_000,
    fileParallelism: false,
  },
});
