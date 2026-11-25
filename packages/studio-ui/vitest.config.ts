import { defineConfig } from "vitest/config"

// 只跑本包（工作台源码 + 装配验收）。工程其余测试在 packages/testkit（node:test）。
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
})
