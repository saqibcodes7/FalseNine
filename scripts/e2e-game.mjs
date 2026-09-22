/**
 * Plays two whole games of Football Imposter in real browsers, phone-sized.
 *
 *   npm run dev            (in one terminal, pointed at a dev project)
 *   npm run test:game      (in another)
 *
 * Game 1: four players. A tied vote, then the imposter is found, a wrong
 * salvage guess, civilians win. Game 2: three players. The imposter is
 * found and steals it with a surname guess. If PGHOST is set the discussion
 * timer is wound down directly in the database to prove tick() opens the
 * vote; without it that check is skipped.
 *
 * It creates real lobbies. Screenshots land in e2e-shots/game/.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:5173'
const OUT = process.env.E2E_SHOTS || './e2e-shots/game'
const PHONE = { width: 390, height: 844 }
mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const consoleErrors = []

async function phone(name) {
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|WebSocket|websocket|realtime/i.test(m.text())) {
      consoleErrors.push(`${name}: ${m.text()}`)
    }
  })
  page.on('pageerror', (e) => consoleErrors.push(`${name}: ${e}`))
  return { name, ctx, page }
}

async function createLobby(host) {
  await host.page.goto(`${BASE}/imposter/create`, { waitUntil: 'networkidle' })
  await host.page.getByLabel('Your display name').fill(host.name)
  await host.page.getByRole('button', { name: 'Create game' }).click()
  await host.page.waitForSelector('[data-testid="join-code"]')
  return host.page.locator('[data-testid="join-code"]').getAttribute('data-code')
}

async function join(p, code) {
  await p.page.goto(`${BASE}/imposter/join?code=${code}`, { waitUntil: 'networkidle' })
  await p.page.getByLabel('Your display name').fill(p.name)
  await p.page.getByRole('button', { name: 'Join game' }).click()
  await p.page.waitForSelector("text=You're in")
}

const phaseOf = (p) => p.page.locator('[data-testid="phase"]').innerText()
const waitPhase = (p, re, timeout = 15000) =>
  p.page.waitForFunction(
    (src) => new RegExp(src, 'i').test(document.querySelector('[data-testid="phase"]')?.textContent || ''),
    re.source,
    { timeout },
  )

/** Flip the card and report what it says. */
async function peek(p) {
  await p.page.getByRole('button', { name: /Your card, face down/ }).click()
  // The face is uppercased by CSS, so read textContent, which ignores that.
  const face = p.page.locator('.rolecard-front p.display').first()
  await p.page.waitForFunction(() => (document.querySelector('.rolecard-front p.display')?.textContent || '').trim().length > 0)
  const text = (await face.textContent()).trim()
  const imposter = text === 'Imposter'
  const hintEl = p.page.locator('[data-testid="hint"]')
  const hint = (await hintEl.count()) ? (await hintEl.textContent()).trim() : null
  return { imposter, name: imposter ? null : text, hint }
}

async function voteFor(voter, targetName) {
  await voter.page.getByRole('button', { name: targetName, exact: true }).click()
  await voter.page.getByRole('button', { name: `Vote out ${targetName}` }).click()
}

// ============================================================================
// GAME 1
// ============================================================================
console.log('\n=== Game 1: four players ===')
const host = await phone('Saqib')
const amir = await phone('Amir')
const priya = await phone('Priya')
const tom = await phone('Tom')
const everyone = [host, amir, priya, tom]

const code = await createLobby(host)
for (const p of [amir, priya, tom]) await join(p, code)
await host.page.waitForFunction(() => document.body.innerText.includes('Tom'))

// Hints on for this game, so the imposter's clue can be checked.
await host.page.getByText('Hints for imposters').click()
await host.page.waitForFunction(() => document.querySelector('input[type=checkbox]:checked') !== null)
await host.page.waitForTimeout(900) // debounced save

await host.page.getByRole('button', { name: 'Start game' }).click()
await Promise.all(everyone.map((p) => waitPhase(p, /Round 1 · Peek/)))
check('start game put every phone on the peek screen', true)
await host.page.screenshot({ path: `${OUT}/01-peek-facedown.png`, fullPage: true })

// Peek, one by one. The last peek must NOT snatch the card away: the server
// arms a grace period and the discussion opens when it runs out.
const cards = {}
for (const p of everyone) cards[p.name] = await peek(p)
const lastPhase = await phaseOf(tom)
check('the last player to look is still on their card, not in the discussion', /Peek/i.test(lastPhase), lastPhase)
const countdown = await tom.page.locator('[data-testid="peek-countdown"]').innerText()
check('the table is shown a countdown to kick-off', /Discussion starts in\s*\d+/i.test(countdown), countdown.replace(/\n/g, ' '))
await tom.page.screenshot({ path: `${OUT}/01b-peek-countdown.png`, fullPage: true })

const imposters = everyone.filter((p) => cards[p.name].imposter)
const civilians = everyone.filter((p) => !cards[p.name].imposter)
check('exactly one imposter was dealt', imposters.length === 1, JSON.stringify(cards))
check(
  'every civilian sees the same footballer',
  new Set(civilians.map((p) => cards[p.name].name)).size === 1,
  civilians.map((p) => cards[p.name].name).join(' | '),
)
const target = cards[civilians[0].name].name
const imposter = imposters[0]
check(
  'the imposter is given a one-word clue',
  Boolean(cards[imposter.name].hint) && cards[imposter.name].hint.split(/\s+/).length === 1,
  String(cards[imposter.name].hint),
)
check(
  'the clue is not the footballer, and no civilian is shown one',
  cards[imposter.name].hint.toLowerCase() !== target.toLowerCase() &&
    civilians.every((p) => cards[p.name].hint === null),
  `${cards[imposter.name].hint} vs ${target}`,
)
await imposter.page.screenshot({ path: `${OUT}/02-imposter-card.png`, fullPage: true })
await civilians[0].page.screenshot({ path: `${OUT}/03-civilian-card.png`, fullPage: true })

// Nothing is pressed here: the grace period expiring is what moves the game on.
await Promise.all(everyone.map((p) => waitPhase(p, /Round 1 · Discuss/, 20000)))
check('the grace period ran out and the discussion opened on every phone', true)
const timerText = await host.page.getByRole('timer').getAttribute('aria-label')
check('discussion clock is running from the server deadline', /Discussion, [0-2]:\d\d remaining/.test(timerText), timerText)
await host.page.screenshot({ path: `${OUT}/04-discussion.png`, fullPage: true })

// Timer expiry via the database, if we can reach it.
if (process.env.PGHOST) {
  const pg = (await import('pg')).default
  const pool = new pg.Pool({ host: process.env.PGHOST, port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER || 'postgres', database: process.env.PGDATABASE || 'fn_test' })
  await pool.query(
    `update rounds set ends_at = now() - interval '1 second'
     where session_id = (select id from sessions where code = $1) and round_number = 1 and phase = 'discussion'`,
    [code],
  )
  await Promise.all(everyone.map((p) => waitPhase(p, /Round 1 · Vote/, 20000)))
  check('the discussion clock running out opened the vote (tick)', true)
  await pool.end()
} else {
  for (const p of everyone) await p.page.getByRole('button', { name: 'Vote now' }).click()
  await Promise.all(everyone.map((p) => waitPhase(p, /Round 1 · Vote/)))
  check('everyone pressing Vote now opened the vote', true)
}

// Round 1: engineer a 2-2 tie between two civilians.
const [c1, c2, c3] = civilians
await voteFor(c1, c2.name)
await voteFor(c2, c1.name)
await voteFor(c3, c2.name)
await c3.page.waitForFunction(() => /3 of 4/i.test(document.querySelector('[data-testid="vote-count"]')?.textContent || ''))
const countText = await c3.page.locator('[data-testid="vote-count"]').innerText()
check('after voting you see the running count and your own vote only', /3 of 4/i.test(countText) && new RegExp(`You voted for ${c2.name}`).test(countText) && !countText.includes(c1.name), countText)
check('live votes are hidden by default', (await c3.page.locator('[data-testid="live-votes"]').count()) === 0)
await c3.page.screenshot({ path: `${OUT}/05-voted-waiting.png`, fullPage: true })
await voteFor(imposter, c1.name)
await Promise.all(everyone.map((p) => waitPhase(p, /Round 2 · Discuss/)))
check('a 2-2 tie went straight back to discussion, round 2', true)
check('nobody was voted out on the tie', (await host.page.locator('[data-out]').count()) === 0)

// Round 2: everyone finds the imposter. Three votes of four closes it early.
for (const p of everyone) await p.page.getByRole('button', { name: 'Vote now' }).click()
await Promise.all(everyone.map((p) => waitPhase(p, /Round 2 · Vote/)))
for (const p of civilians) await voteFor(p, imposter.name)
await Promise.all(everyone.map((p) => waitPhase(p, /Round 2 · Reveal/)))
check('three votes of four closed the vote without waiting for the fourth', true)
const revealText = await amir.page.locator('[role="status"]').innerText()
check(
  'the reveal uses the brief’s wording for a found imposter',
  new RegExp(`${imposter.name} was indeed the Imposter\\. That was the last one\\.`).test(revealText),
  revealText.replace(/\n/g, ' | '),
)
const breakdown = await amir.page.locator('[data-testid="vote-breakdown"]').innerText()
check('the vote breakdown is public at the reveal', breakdown.includes(imposter.name) && breakdown.includes('3'), breakdown.replace(/\n/g, ' | '))
check('non-hosts have no Continue button', (await amir.page.getByRole('button', { name: /last chance|Start round|See the result/ }).count()) === 0)

// The last imposter is out, so the salvage starts on its own clock. Nobody,
// host included, is going to press anything here.
const revealCountdown = await amir.page.locator('[data-testid="reveal-countdown"]').innerText()
check(
  'the table is told the last chance is coming, on a clock',
  new RegExp(`Last chance for ${imposter.name} in\\s*\\d+`, 'i').test(revealCountdown),
  revealCountdown.replace(/\n/g, ' '),
)
await amir.page.screenshot({ path: `${OUT}/06-reveal-imposter.png`, fullPage: true })

await Promise.all(everyone.map((p) => waitPhase(p, /Last chance/, 25000)))
check('the salvage opened by itself, with no host tap', true)
check('only the imposter gets the guess box', (await imposter.page.getByLabel('The footballer').count()) === 1 && (await c1.page.getByLabel('The footballer').count()) === 0)
await imposter.page.screenshot({ path: `${OUT}/07-salvage-guess.png`, fullPage: true })
await c1.page.screenshot({ path: `${OUT}/07b-salvage-waiting.png`, fullPage: true })

await imposter.page.getByLabel('The footballer').fill('Somebody Else')
await imposter.page.getByRole('button', { name: 'Lock it in' }).click()
await Promise.all(everyone.map((p) => waitPhase(p, /Full time/)))
const endText = await c1.page.locator('[role="status"]').innerText()
check('a wrong guess ends it for the civilians', /Civilians win/i.test(endText) && endText.includes(target), endText.replace(/\n/g, ' | '))
const roster = await c1.page.locator('ul').last().innerText()
check('every role is public at full time', /Imposter/i.test(roster) && /Civilian/i.test(roster), roster.replace(/\n/g, ' | '))
// amir is never the host; c1 sometimes is, when the host draws a civilian.
check('only the host is offered another game', (await host.page.getByRole('button', { name: 'Play again' }).count()) === 1 && (await amir.page.getByRole('button', { name: 'Play again' }).count()) === 0)
await c1.page.screenshot({ path: `${OUT}/08-full-time-civilians.png`, fullPage: true })

// ---- Play again: same code, same people, nobody types anything ------------
await host.page.getByRole('button', { name: 'Play again' }).click()
await Promise.all(everyone.map((p) => p.page.waitForSelector('[data-testid="join-code"]', { timeout: 15000 })))
check('one tap took the whole table back to the lobby', true)
const sameCode = await Promise.all(everyone.map((p) => p.page.locator('[data-testid="join-code"]').getAttribute('data-code')))
check('it is the same lobby, same code, for everyone', sameCode.every((c) => c === code), sameCode.join(' | '))
check('the host is back on the setup screen', (await host.page.getByRole('button', { name: 'Start game' }).count()) === 1)
check('the players are back in the waiting room', (await amir.page.locator("text=You're in").count()) === 1)
await host.page.screenshot({ path: `${OUT}/08b-play-again-lobby.png`, fullPage: true })

// And it really is playable, not just a screen that looks right.
await host.page.getByRole('button', { name: 'Start game' }).click()
await Promise.all(everyone.map((p) => waitPhase(p, /Round 1 · Peek/)))
const cards1b = {}
for (const p of everyone) cards1b[p.name] = await peek(p)
check('a fresh deal in the same lobby', everyone.filter((p) => cards1b[p.name].imposter).length === 1, JSON.stringify(cards1b))
const target1b = cards1b[everyone.find((p) => !cards1b[p.name].imposter).name].name
check('the second game has its own footballer to talk about', Boolean(target1b), `${target} then ${target1b}`)
await Promise.all(everyone.map((p) => waitPhase(p, /Round 1 · Discuss/, 20000)))
check('the second game runs the same way', true)

for (const p of everyone) await p.ctx.close()

// ============================================================================
// GAME 2: three players, the imposter steals it with a surname
// ============================================================================
console.log('\n=== Game 2: three players, salvage success ===')
const h2 = await phone('Host')
const bea = await phone('Bea')
const cal = await phone('Cal')
const trio = [h2, bea, cal]
const code2 = await createLobby(h2)
for (const p of [bea, cal]) await join(p, code2)
await h2.page.waitForFunction(() => document.body.innerText.includes('Cal'))

// Turn live votes on for this one.
await h2.page.getByText('Show votes as they land').click()
await h2.page.waitForFunction(() => document.querySelector('input[type=checkbox]:checked') !== null)
await h2.page.waitForTimeout(900) // debounced save
await h2.page.getByRole('button', { name: 'Start game' }).click()
await Promise.all(trio.map((p) => waitPhase(p, /Round 1 · Peek/)))

const cards2 = {}
for (const p of trio) cards2[p.name] = await peek(p)
const imp2 = trio.find((p) => cards2[p.name].imposter)
const civ2 = trio.filter((p) => !cards2[p.name].imposter)
const target2 = cards2[civ2[0].name].name
check('hints off means the imposter is shown no clue', cards2[imp2.name].hint === null, String(cards2[imp2.name].hint))
await Promise.all(trio.map((p) => waitPhase(p, /Round 1 · Discuss/, 20000)))

for (const p of trio) await p.page.getByRole('button', { name: 'Vote now' }).click()
await Promise.all(trio.map((p) => waitPhase(p, /Round 1 · Vote/)))
await voteFor(civ2[0], imp2.name)
await civ2[1].page.waitForSelector('[data-testid="live-votes"]')
const live = await civ2[1].page.locator('[data-testid="live-votes"]').innerText()
check('with live votes on, names show as they land', live.includes(imp2.name) && live.includes(civ2[0].name), live.replace(/\n/g, ' | '))
await civ2[1].page.screenshot({ path: `${OUT}/09-live-votes.png`, fullPage: true })
await voteFor(civ2[1], imp2.name)
await Promise.all(trio.map((p) => waitPhase(p, /Round 1 · Reveal/)))
check('two of three is a majority, closed early', true)
// This time the host does cut the wait short, which is still allowed.
await h2.page.getByRole('button', { name: 'Skip the wait' }).click()
await Promise.all(trio.map((p) => waitPhase(p, /Last chance/)))
check('the host can still skip the wait', true)

const surname = target2.split(' ').pop().toLowerCase()
await imp2.page.getByLabel('The footballer').fill(surname)
await imp2.page.getByRole('button', { name: 'Lock it in' }).click()
await Promise.all(trio.map((p) => waitPhase(p, /Full time/)))
const end2 = await civ2[0].page.locator('[role="status"]').innerText()
check(`a surname guess ("${surname}") steals the win`, /Stolen/i.test(end2) && end2.includes(target2), end2.replace(/\n/g, ' | '))
await civ2[0].page.screenshot({ path: `${OUT}/10-full-time-stolen.png`, fullPage: true })

for (const p of trio) await p.ctx.close()
await browser.close()

check('no unexpected console errors', consoleErrors.length === 0, consoleErrors.join(' || '))

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
