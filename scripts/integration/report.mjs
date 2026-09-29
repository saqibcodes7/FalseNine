/**
 * PASS / FAIL / INFO lines for the integration scripts, printed as they happen
 * and saved to .integration/<name>-<timestamp>.log (git-ignored) at the end.
 *
 * INFO is for things the gate observes and reports without judging, such as
 * the exact shape of a Realtime DELETE payload. Only FAIL fails the run.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { OUTPUT_DIR, ROOT } from './config.mjs'

export function createReport(name) {
  const lines = []
  const counts = { pass: 0, fail: 0, info: 0, skip: 0 }
  const failures = []
  let current = ''
  const started = new Date()

  const emit = (text) => {
    console.log(text)
    lines.push(text)
  }
  const fmt = (detail) => {
    if (detail === undefined || detail === null || detail === '') return ''
    const text = typeof detail === 'string' ? detail : JSON.stringify(detail)
    return ` (${text.length > 400 ? text.slice(0, 400) + '...' : text})`
  }

  const report = {
    section(title) {
      current = title
      emit(`\n${title}`)
    },
    pass(label, detail) {
      counts.pass += 1
      emit(`  PASS  ${label}${fmt(detail)}`)
      return true
    },
    fail(label, detail) {
      counts.fail += 1
      failures.push(`${current}: ${label}${fmt(detail)}`)
      emit(`  FAIL  ${label}${fmt(detail)}`)
      return false
    },
    info(label, detail) {
      counts.info += 1
      emit(`  INFO  ${label}${fmt(detail)}`)
    },
    skip(label, why) {
      counts.skip += 1
      emit(`  SKIP  ${label}${fmt(why)}`)
    },
    check(label, ok, detail) {
      return ok ? report.pass(label, detail) : report.fail(label, detail)
    },
    note(text) {
      emit(`        ${text}`)
    },
    get failed() {
      return counts.fail
    },
    finish(extra = {}) {
      const seconds = ((Date.now() - started.getTime()) / 1000).toFixed(1)
      emit(`\n${counts.pass} passed, ${counts.fail} failed, ${counts.info} observations, ${counts.skip} skipped in ${seconds}s.`)
      if (failures.length) {
        emit('\nFailures:')
        for (const f of failures) emit(`  - ${f}`)
      }
      emit(counts.fail ? `\n${name} FAILED` : `\n${name} passed`)
      const stamp = started.toISOString().replace(/[:.]/g, '-')
      const dir = path.join(ROOT, OUTPUT_DIR)
      mkdirSync(dir, { recursive: true })
      const file = path.join(dir, `${name}-${stamp}.log`)
      writeFileSync(file, lines.join('\n') + '\n')
      if (extra.json) writeFileSync(path.join(dir, extra.json.file), JSON.stringify(extra.json.data, null, 2) + '\n')
      console.log(`\nFull log: ${path.relative(ROOT, file)}`)
      return counts.fail ? 1 : 0
    },
  }
  return report
}
