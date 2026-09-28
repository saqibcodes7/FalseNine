/**
 * Lints only the JavaScript that differs from main: committed on this branch,
 * staged, unstaged or brand new. This is the lint gate, so new and touched
 * files have to be clean while untouched files are left exactly as they are.
 *
 *   npm run lint:changed
 *   LINT_BASE=origin/main npm run lint:changed    compare against another ref
 *
 * Fails on any error or warning. Plain Node and git, so it runs the same on
 * Windows, macOS and Linux.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LINTABLE = /\.(js|jsx|mjs|cjs)$/

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' })
  if (result.status !== 0) return null
  return result.stdout.split(/\r?\n/).filter(Boolean)
}

// Compare against where this branch left main, so changes that landed on main
// since then are not counted as ours.
const candidates = process.env.LINT_BASE ? [process.env.LINT_BASE] : ['main', 'origin/main']
const base = candidates.map((ref) => git(['merge-base', 'HEAD', ref])?.[0]).find(Boolean)
if (!base) {
  console.error(`lint:changed could not find ${candidates.join(' or ')} to compare against. Set LINT_BASE.`)
  process.exit(2)
}

const changed = new Set([
  ...(git(['diff', '--name-only', '--diff-filter=ACMR', base]) ?? []),
  ...(git(['ls-files', '--others', '--exclude-standard']) ?? []),
])
const files = [...changed].filter((file) => LINTABLE.test(file) && existsSync(path.join(ROOT, file))).sort()

if (files.length === 0) {
  console.log('lint:changed: no changed JavaScript files.')
  process.exit(0)
}

const eslint = new ESLint({ cwd: ROOT, warnIgnored: false })
const results = await eslint.lintFiles(files)
const formatter = await eslint.loadFormatter('stylish')
const report = await formatter.format(results)

const errors = results.reduce((n, r) => n + r.errorCount, 0)
const warnings = results.reduce((n, r) => n + r.warningCount, 0)

console.log(`lint:changed: ${files.length} changed file${files.length === 1 ? '' : 's'}`)
for (const file of files) console.log(`  ${file}`)
if (report.trim()) console.log(report)
console.log(errors + warnings === 0 ? 'lint:changed passed' : `lint:changed FAILED: ${errors} errors, ${warnings} warnings`)
process.exit(errors + warnings === 0 ? 0 : 1)
