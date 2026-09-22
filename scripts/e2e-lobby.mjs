/**
 * End-to-end check of the create/join/lobby flow.
 *
 * Multiplayer lobbies are miserable to test by hand — three browser windows,
 * a code typed three times, and you still miss the case you changed. This
 * drives four browser contexts at phone size and asserts the things that
 * actually matter: the ratio guard, the duplicate-name refusal, settings
 * reaching the other players, and the dead-end screens.
 *
 *   npm run dev          # in one terminal, with .env.local pointed somewhere
 *   npm run test:e2e     # in another
 *
 * It creates real lobbies in whatever project the dev server is pointed at, so
 * aim it at a dev project rather than anything you care about. Screenshots land
 * in ./e2e-shots.
 */
import { chromium } from 'playwright'

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:5173'
const OUT = process.env.E2E_SHOTS || "./e2e-shots"
const PHONE = { width: 390, height: 844 }

const results = []
const check = (name, ok, extra = '') =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })

// Collect any console error from any page, so a silent React crash cannot pass.
const consoleErrors = []
function watch(page, tag) {
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[${tag}] ${m.text()}`)
  })
  page.on('pageerror', (e) => consoleErrors.push(`[${tag}] ${e.message}`))
}

// ---------- Host ----------
const hostCtx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 })
const host = await hostCtx.newPage()
watch(host, 'host')

await host.goto(BASE, { waitUntil: 'networkidle' })
await host.screenshot({ path: `${OUT}/01-home-phone.png`, fullPage: true })
check('home renders', await host.getByText('Football Imposter').first().isVisible())
check(
  'coming-soon tiles are not links',
  (await host.locator('a', { hasText: 'Football Tic-Tac-Toe' }).count()) === 0,
)
check(
  'two coming-soon badges',
  (await host.getByText('Coming soon').count()) === 2,
  `found ${await host.getByText('Coming soon').count()}`,
)

await host.getByRole('link', { name: /Football Imposter/ }).click()
await host.waitForURL('**/imposter')
await host.screenshot({ path: `${OUT}/02-imposter-home.png`, fullPage: true })
check('imposter entry has both actions',
  (await host.getByRole('button', { name: 'Create game' }).isVisible()) &&
  (await host.getByRole('button', { name: 'Join game' }).isVisible()))

await host.getByRole('button', { name: 'Create game' }).click()
await host.waitForURL('**/imposter/create')
// waitForURL resolves before React has swapped the screen, so wait for a
// control that only exists on the create screen before asserting on it.
await host.waitForSelector('input[autocomplete="nickname"]')
check(
  'create button is disabled until a name is typed',
  await host.getByRole('button', { name: 'Create game' }).isDisabled(),
)
await host.getByLabel('Your display name').fill('Saqib')
await host.screenshot({ path: `${OUT}/03-create.png`, fullPage: true })
await host.getByRole('button', { name: 'Create game' }).click()

await host.waitForURL('**/imposter/lobby/**', { timeout: 15000 })
await host.waitForSelector('[data-testid="join-code"]')
const code = (await host.getAttribute('[data-testid="join-code"]', 'data-code')).trim()
check('lobby shows a 5-char join code', /^[A-Z0-9]{5}$/.test(code), code)
await host.screenshot({ path: `${OUT}/04-host-setup.png`, fullPage: true })

check(
  'start is blocked with 1 player',
  await host.getByRole('button', { name: 'Start game' }).isDisabled(),
)
check(
  'start hint counts the shortfall',
  (await host.getByText(/Need 2 more players to start/).count()) === 1,
)

// ---------- Two more players join ----------
const joiners = []
for (const name of ['Amir', 'Priya']) {
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  watch(page, name)
  await page.goto(`${BASE}/imposter/join`, { waitUntil: 'networkidle' })
  await page.getByLabel('Join code').fill(code.toLowerCase()) // exercise case-insensitivity
  await page.getByLabel('Your display name').fill(name)
  if (name === 'Amir') await page.screenshot({ path: `${OUT}/05-join.png`, fullPage: true })
  await page.getByRole('button', { name: 'Join game' }).click()
  await page.waitForURL('**/imposter/lobby/**', { timeout: 15000 })
  await page.waitForSelector("text=You're in")
  joiners.push({ ctx, page, name })
}
check('joiners reached the waiting room', joiners.length === 2)
const joinerCode = await joiners[0].page.locator('[data-testid="join-code"]').getAttribute('data-code')
check('a joiner can read the code off their own phone too', joinerCode === code, String(joinerCode))
check(
  'and pass the invite on without asking the host',
  (await joiners[0].page.getByRole('button', { name: /Copy invite link/ }).count()) === 1,
)
await joiners[0].page.screenshot({ path: `${OUT}/06-waiting-room.png`, fullPage: true })

// ---------- Duplicate name is refused ----------
const dupCtx = await browser.newContext({ viewport: PHONE })
const dup = await dupCtx.newPage()
watch(dup, 'dup')
await dup.goto(`${BASE}/imposter/join?code=${code}`, { waitUntil: 'networkidle' })
check('invite link prefills the code',
  (await dup.getByLabel('Join code').inputValue()) === code)
await dup.getByLabel('Your display name').fill('amir')
await dup.getByRole('button', { name: 'Join game' }).click()
await dup.waitForSelector('[role="alert"]', { timeout: 10000 })
const dupMsg = await dup.locator('[role="alert"]').first().innerText()
check('duplicate name refused with a readable message', /already called/i.test(dupMsg), dupMsg)
await dup.screenshot({ path: `${OUT}/07-duplicate-name.png`, fullPage: true })

// ---------- Host sees the lobby fill (realtime is down, so this is the poll fallback) ----------
await host.waitForFunction(
  () => document.body.innerText.includes('Priya'),
  null,
  { timeout: 20000 },
)
check('host lobby picked up both joiners without a reload', true)
check(
  'start unlocks at 3 players',
  await host.getByRole('button', { name: 'Start game' }).isEnabled(),
)
await host.screenshot({ path: `${OUT}/08-host-ready.png`, fullPage: true })

// ---------- Imposter ratio guard ----------
await host.getByRole('button', { name: 'Increase Imposters' }).click()
await host.waitForSelector('text=/Imposters have to be outnumbered/')
check(
  'raising imposters past the minority blocks start',
  await host.getByRole('button', { name: 'Start game' }).isDisabled(),
)
await host.screenshot({ path: `${OUT}/09-imposter-warning.png`, fullPage: true })
await host.getByRole('button', { name: 'Decrease Imposters' }).click()
await host.waitForSelector('text=/Ready with 3 players/')
check('dropping back to 1 imposter re-enables start',
  await host.getByRole('button', { name: 'Start game' }).isEnabled())

// ---------- Settings persist to the server ----------
await host.getByRole('button', { name: 'World Cup Heroes' }).click()
await host.getByRole('button', { name: 'Increase Discussion timer' }).click()
await host.waitForTimeout(1200) // let the debounced save land
await joiners[0].page.reload({ waitUntil: 'networkidle' })
await joiners[0].page.waitForSelector('text=World Cup Heroes')
const packSeen = await joiners[0].page.getByText('World Cup Heroes').isVisible()
const timeSeen = (await joiners[0].page.locator('dd').allInnerTexts()).join('|')
check('host settings reached the other players', packSeen && timeSeen.includes('3:30'), timeSeen)
await joiners[0].page.screenshot({ path: `${OUT}/10-settings-synced.png`, fullPage: true })

// ---------- Difficulty: the mode selector, its count, and it reaching the room ----------
const modeGroup = host.getByRole('radiogroup', { name: 'How deep' })
check(
  'a fresh lobby starts on Casual',
  (await modeGroup.getByRole('radio', { name: /Casual/ }).getAttribute('aria-checked')) === 'true',
)
const casualCount = await host.getByText(/of \d+ in play/).innerText()
await modeGroup.getByRole('radio', { name: /You Know Ball/ }).click()
const hardCount = await host.getByText(/of \d+ in play/).innerText()
const [casualN, squadN] = casualCount.match(/\d+/g).map(Number)
const [hardN] = hardCount.match(/\d+/g).map(Number)
check(
  'You Know Ball opens the whole squad',
  hardN === squadN && casualN < hardN,
  `${casualCount} -> ${hardCount}`,
)
check(
  'the mode blurb follows the selection',
  /whole squad/i.test(await host.getByTestId('difficulty-blurb').innerText()),
)
await host.screenshot({ path: `${OUT}/10b-difficulty-hard.png`, fullPage: true })
await host.waitForTimeout(1200) // debounced save
await joiners[0].page.reload({ waitUntil: 'networkidle' })
await joiners[0].page.waitForSelector('text=You Know Ball')
check(
  'the chosen mode reached the waiting room',
  await joiners[0].page.getByText('You Know Ball').isVisible(),
)
await joiners[0].page.screenshot({ path: `${OUT}/10c-mode-synced.png`, fullPage: true })

// ---------- Unknown lobby ----------
const lost = await hostCtx.newPage()
watch(lost, 'lost')
await lost.goto(`${BASE}/imposter/lobby/ZZZZZ`, { waitUntil: 'networkidle' })
await lost.waitForSelector('text=That lobby is gone')
check('unknown code shows a dead-end screen, not a crash', true)
await lost.screenshot({ path: `${OUT}/11-lobby-gone.png`, fullPage: true })

// ---------- Rejoin offers the last two seats, not a life story ----------
const oldCtx = await browser.newContext({ viewport: PHONE })
const old = await oldCtx.newPage()
watch(old, 'rejoin')
await old.goto(`${BASE}/imposter`, { waitUntil: 'networkidle' })
await old.evaluate(() => {
  // Five games' worth of seats, oldest first, the way a phone accumulates them.
  const seats = ['AAAAA', 'BBBBB', 'CCCCC', 'DDDDD', 'EEEEE']
  seats.forEach((code, i) => {
    window.localStorage.setItem(
      `fn:imposter:${code}`,
      JSON.stringify({ playerId: `0000000${i}-0000-4000-8000-000000000000`, displayName: `Player ${i}`, isHost: false, savedAt: 1000 + i }),
    )
  })
})
await old.reload({ waitUntil: 'networkidle' })
const rejoinCodes = await old.locator('[data-testid="rejoin-code"]').allInnerTexts()
check('Rejoin offers two seats, not every game ever played', rejoinCodes.length === 2, rejoinCodes.join(' | '))
check('and they are the two most recent', rejoinCodes.join(',') === 'EEEEE,DDDDD', rejoinCodes.join(' | '))
await old.screenshot({ path: `${OUT}/11b-rejoin-capped.png`, fullPage: true })
await oldCtx.close()

// ---------- Desktop view ----------
const wide = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const wp = await wide.newPage()
watch(wp, 'wide')
await wp.goto(BASE, { waitUntil: 'networkidle' })
await wp.screenshot({ path: `${OUT}/12-home-desktop.png`, fullPage: true })

// ---------- Console hygiene ----------
// Realtime cannot connect against the mock, so filter those; anything else is a bug.
const realNoise = consoleErrors.filter(
  (e) =>
    !/websocket|realtime|ws:\/\//i.test(e) &&
    // The duplicate-name check deliberately provokes a 400; the browser logs
    // the failed request even though the app handles it correctly.
    !/Failed to load resource.*400/i.test(e),
)
check('no unexpected console errors', realNoise.length === 0, realNoise.slice(0, 3).join(' // '))

await browser.close()

console.log('\n' + results.join('\n'))
const failed = results.filter((r) => r.startsWith('FAIL')).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
