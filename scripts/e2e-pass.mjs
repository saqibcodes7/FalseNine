/**
 * Plays Pass & Play end to end in a real browser, phone-sized.
 *
 *   npm run dev        (in one terminal)
 *   npm run test:pass  (in another)
 *
 * No Supabase, no lobby, no network: this mode is entirely local, and the
 * suite deliberately checks that by watching for requests leaving the page.
 *
 * Screenshots land in e2e-shots/pass/.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:5173'
const OUT = process.env.E2E_SHOTS || './e2e-shots/pass'
const PHONE = { width: 390, height: 844 }
mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 })
const page = await ctx.newPage()

const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon/i.test(m.text())) consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push(String(e)))

// Anything that is not the app's own assets counts as reaching for a network
// this mode is supposed to do without.
const offSite = []
page.on('request', (r) => {
  const url = r.url()
  if (!url.startsWith(BASE) && !url.startsWith('data:') && !url.startsWith('blob:')) {
    offSite.push(url)
  }
})

const title = () => page.locator('h1').first().innerText()
const tapUntil = async (locator) => {
  await locator.click()
}

// ---------------------------------------------------------------------------
console.log('\n=== Getting in ===')
await page.goto(`${BASE}/imposter`, { waitUntil: 'networkidle' })
const passButton = page.getByRole('button', { name: 'Pass & Play' })
check('Football Imposter offers Pass & Play', (await passButton.count()) === 1)
check(
  'and it is not gated on a backend being configured',
  await passButton.isEnabled(),
)
await passButton.click()
await page.waitForSelector('text=Deal the cards')
check('the setup screen came up with no code and no name to type', true)
check('nothing asks for a display name', (await page.getByLabel('Your display name').count()) === 0)
await page.screenshot({ path: `${OUT}/01-setup.png`, fullPage: true })

// ---------------------------------------------------------------------------
console.log('\n=== Setting up: 4 players, 1 imposter, hints on, short clocks ===')
const stepDown = (label, times) => async () => {
  for (let i = 0; i < times; i += 1) await page.getByRole('button', { name: `Decrease ${label}` }).click()
}
await stepDown('Players', 1)() // 5 -> 4

// Wind the discussion clock all the way down, which is this mode's "no limit".
// The key disables itself at the bottom, so stop when it does.
const minus = (label) => page.getByRole('button', { name: `Decrease ${label}` })
for (let i = 0; i < 30 && (await minus('Discussion').isEnabled()); i += 1) {
  await minus('Discussion').click()
}
check('the discussion key stops at the bottom', !(await minus('Discussion').isEnabled()))
const discussionReadout = await page.getByText('No limit', { exact: true }).first().innerText()
check('a clock wound to zero reads as no limit', discussionReadout === 'No limit', discussionReadout)

// Voting clock down to 15s so the suite can watch it expire on its own.
for (let i = 0; i < 3; i += 1) {
  await page.getByRole('button', { name: 'Decrease Voting' }).click()
}
await page.getByText('Hints for imposters').click()
await page.screenshot({ path: `${OUT}/02-setup-filled.png`, fullPage: true })

await page.getByRole('button', { name: 'Deal the cards' }).click()
await page.waitForSelector('[data-testid="pass-progress"]')
check('dealing goes straight to Player 1', (await title()) === 'Player 1')

// ---------------------------------------------------------------------------
console.log('\n=== The pass: two taps each, card face down in between ===')
const seen = []
for (let n = 1; n <= 4; n += 1) {
  check(`Player ${n} is up`, (await title()) === `Player ${n}`)

  // The card must be face down before anyone taps it — that is the only thing
  // keeping the previous player's card from the next pair of eyes.
  const faceDown = await page.getByRole('button', { name: /Your card, face down/ }).count()
  check(`Player ${n}'s card arrives face down`, faceDown === 1)
  check(`Player ${n} cannot pass the phone on without looking`, !(await page.getByTestId('pass-on').isEnabled()))

  await tapUntil(page.getByRole('button', { name: /Your card, face down/ })) // tap one: peek
  await page.waitForFunction(
    () => (document.querySelector('.rolecard-front p.display')?.textContent || '').trim().length > 0,
  )
  const face = (await page.locator('.rolecard-front p.display').first().textContent()).trim()
  const hintEl = page.locator('[data-testid="hint"]')
  const hint = (await hintEl.count()) ? (await hintEl.textContent()).trim() : null
  seen.push({ n, imposter: face === 'Imposter', name: face === 'Imposter' ? null : face, hint })

  // Let the card finish turning over before the shutter goes.
  if (n === 1) {
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${OUT}/03-card.png`, fullPage: true })
  }

  await tapUntil(page.getByTestId('pass-on')) // tap two: pass it on
}

const imposters = seen.filter((s) => s.imposter)
const civilians = seen.filter((s) => !s.imposter)
check('exactly one imposter was dealt', imposters.length === 1, JSON.stringify(seen))
check(
  'every civilian saw the same footballer',
  new Set(civilians.map((s) => s.name)).size === 1,
  civilians.map((s) => s.name).join(' | '),
)
check('the imposter got a one-word clue, and only the imposter', Boolean(imposters[0].hint) && civilians.every((s) => s.hint === null), String(imposters[0].hint))
const target = civilians[0].name

// ---------------------------------------------------------------------------
console.log('\n=== Discussion: no limit, so it counts up and waits ===')
await page.waitForSelector('[role="timer"]')
check('the last pass went straight into the discussion', (await title()) === 'Discussion')
const clockLabel = await page.locator('[role="timer"]').getAttribute('aria-label')
check('an unlimited clock counts up rather than down', /no limit/i.test(clockLabel), clockLabel)
await page.waitForTimeout(1600)
const climbed = await page.locator('[role="timer"]').getAttribute('aria-label')
check('and it is actually ticking', climbed !== clockLabel, `${clockLabel} -> ${climbed}`)
await page.screenshot({ path: `${OUT}/04-discussion.png`, fullPage: true })

await page.getByTestId('advance').click()
await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Vote')
check('the table can move on early', true)

// ---------------------------------------------------------------------------
console.log('\n=== Voting: a real clock, which runs out by itself ===')
const voteLabel = await page.locator('[role="timer"]').getAttribute('aria-label')
check('the voting clock counts down from its setting', /Voting, 0:1\d remaining/.test(voteLabel), voteLabel)
await page.screenshot({ path: `${OUT}/05-voting.png`, fullPage: true })

// Nobody presses anything: the clock should take the game on.
await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Who went out?', null, { timeout: 25000 })
check('the clock running out moved the game on with nobody pressing anything', true)
await page.screenshot({ path: `${OUT}/06-who-went-out.png`, fullPage: true })

// ---------------------------------------------------------------------------
console.log('\n=== The reveal, by player number ===')
check('every player is offered, by number', (await page.getByTestId(/^vote-[1-4]$/).count()) === 4)
const civilianNumber = civilians[0].n
await page.getByTestId(`vote-${civilianNumber}`).click()
await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Voted out')
const revealText = await page.locator('[role="status"]').innerText()
check(
  'voting out a civilian says so, and says the imposters are still there',
  new RegExp(`Player ${civilianNumber} was a civilian`).test(revealText),
  revealText.replace(/\n/g, ' | '),
)
check('the roster strikes them out', (await page.locator('[data-player][data-out="true"]').count()) === 1)
await page.screenshot({ path: `${OUT}/07-civilian-out.png`, fullPage: true })

await page.getByRole('button', { name: 'Start round 2' }).click()
await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Discussion')
check('round 2 starts back at the discussion', true)

// ---------------------------------------------------------------------------
console.log('\n=== Round 2: catch the imposter ===')
await page.getByTestId('advance').click()
await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Vote')
await page.getByTestId('advance').click()
await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Who went out?')
check('a voted-out player is not offered again', (await page.getByTestId(`vote-${civilianNumber}`).count()) === 0)

const imposterNumber = imposters[0].n
await page.getByTestId(`vote-${imposterNumber}`).click()
await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Voted out')
const caughtText = await page.locator('[role="status"]').innerText()
check(
  'catching the imposter uses the game’s own wording',
  new RegExp(`Player ${imposterNumber} was indeed the Imposter\\. That was the last one\\.`).test(caughtText),
  caughtText.replace(/\n/g, ' | '),
)
await page.screenshot({ path: `${OUT}/08-imposter-out.png`, fullPage: true })

// ---------------------------------------------------------------------------
console.log('\n=== Full reveal ===')
await page.getByTestId('finish').click()
await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Cards on the table')
const endText = await page.locator('[role="status"]').innerText()
check('the footballer is finally named', endText.includes(target), endText.replace(/\n/g, ' | '))
check(
  'and the phone does not declare a winner',
  !/civilians win|imposter wins/i.test(endText),
  endText.replace(/\n/g, ' | '),
)
check('every card is face up', (await page.locator('[data-testid="pass-table"] li').count()) === 4)
const chips = await page.locator('[data-testid="pass-table"]').innerText()
check('including the ones nobody voted out', (chips.match(/Civilian/g) || []).length === 3 && (chips.match(/Imposter/g) || []).length === 1, chips.replace(/\n/g, ' '))
await page.screenshot({ path: `${OUT}/09-cards-on-the-table.png`, fullPage: true })

// ---------------------------------------------------------------------------
console.log('\n=== Deal again, and surviving a refresh ===')
await page.getByTestId('deal-again').click()
await page.waitForSelector('[data-testid="pass-progress"]')
check('dealing again goes back to Player 1 with the same table', (await title()) === 'Player 1')

await page.getByRole('button', { name: /Your card, face down/ }).click()
await page.getByTestId('pass-on').click()
check('and it is a fresh pass, at Player 2', (await title()) === 'Player 2')

await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('[data-testid="pass-progress"]')
check('a refresh mid-pass does not lose the game', (await title()) === 'Player 2')
const progress = await page.getByTestId('pass-progress').innerText()
check('and it picks up exactly where it was', progress === '2 of 4', progress)

await page.getByRole('button', { name: 'End this game' }).click()
await page.waitForSelector('text=Deal the cards')
check('ending the game throws the deal away and returns to setup', true)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForSelector('text=Deal the cards')
check('and it stays gone after a refresh', true)

// ---------------------------------------------------------------------------
check('the whole mode ran without touching the network', offSite.length === 0, offSite.slice(0, 3).join(' | '))
check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '))

await ctx.close()
await browser.close()

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
