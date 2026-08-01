import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Vitest replaces CSS module content with an empty string by default (a
    // speed optimisation — most suites never need real CSS), which silently
    // empties src/index.css's `?raw` import in theme.test.ts even though the
    // import itself resolves. Scoped to index.css so every other stylesheet
    // in the app keeps the fast, mocked path.
    css: { include: [/index\.css/] },
    // Vitest's default include picks up e2e/*.spec.ts, which import
    // @playwright/test and fail under Vitest. Spread the defaults — replacing
    // them outright would put node_modules back in scope.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
