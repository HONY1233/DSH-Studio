import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// vitest 默认不注入全局 afterEach，RTL 的自动清理不会生效。
afterEach(() => {
  cleanup()
})
