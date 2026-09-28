import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

/*
 * Lint rules for the app and its scripts.
 *
 * `npm run lint:changed` is the gate: it lints only the files that differ
 * from main, so new and touched code has to be clean without dragging the
 * whole repository into a cleanup. `npm run lint` checks everything, for
 * information.
 */
export default defineConfig([
  globalIgnores(['dist', 'e2e-shots', 'node_modules']),
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [js.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Node scripts. The E2E ones also hand functions to the browser through
    // Playwright, so browser globals are fair game in here too.
    files: ['scripts/**/*.{js,mjs}', '*.config.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },
])
