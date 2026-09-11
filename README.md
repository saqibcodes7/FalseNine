# False Nine

Football party games you play on your phones, together. No install, no account.
One person starts a game, everyone else joins with a five-character code.

This repo currently covers **steps 1 to 3** of the build order — the app shell,
the Supabase schema, the create/join flow with a live lobby — plus the visual
design system every later screen is built from. The round engine (peek,
discussion, voting, reveal) is next.

---

## Quick start

```bash
npm install
```

### 1. Create the Supabase project

You have to do this bit yourself, it needs your login.

1. Go to [supabase.com](https://supabase.com) and create a new project. The free
   tier is fine. Pick the region closest to you (London if you are in the UK) —
   this is the round trip on every realtime message, so it is worth getting right.
2. Wait for it to finish provisioning, then open **SQL Editor → New query**.
3. Paste in the whole of `supabase/migrations/0001_init.sql` and run it.
   It creates the tables, turns on Realtime, locks down Row Level Security and
   adds the `create_session` / `join_session` functions.
   Then do the same with `supabase/migrations/0002_difficulty.sql` and
   `supabase/migrations/0003_round_engine.sql`, one query each, in that order.
   Migrations run in number order, each one exactly once.
4. Go to **Project Settings → API** and copy the **Project URL** and the
   **anon public** key.

### 2. Point the app at it

```bash
cp .env.example .env.local
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. The anon key is meant
to be public — it is what the browser uses, and RLS is what actually protects
the data. Never put the `service_role` key in this file.

### 3. Run it

```bash
npm run dev
```

Open http://localhost:5173. The dev server also binds to your LAN, so to test on
a real phone, find your machine's IP and open `http://<that-ip>:5173` on the
phone while both are on the same wifi.

The shell runs without Supabase configured, so you can work on layout before any
of the above. The Imposter screens will tell you the database is missing rather
than failing silently.

---

## How the pieces fit

```
src/
  screens/       one file per screen, routed in App.jsx
    Lobby.jsx      host setup and the waiting room; hands over to Game.jsx at kick-off
    Game.jsx       picks the phase screen from sessions.status
    game/          one file per phase: Peek, Discussion, Voting, Reveal, Salvage, Ended
  ui/            the design system — every primitive the screens are built from
    materials.css  metal frames, enamel plates, engraving, backdrop, foil, flip
    brand/         logo.svg (full lock-up) and mark.svg (the 9), traced from logo.png
  hooks/
    useLobby.js    live session, players, rounds and votes over Realtime, with a poll fallback
    useCountdown.js counts down to the server's deadline and nudges tick()
  lib/
    supabase.js  the client, plus the column lists the browser may read
    identity.js  which player this browser is, per lobby, in localStorage
    game.js      pure helpers that read the game state: tallies, who is left, what is next
  data/
    packs.js     the three player packs, each in three tiers (see below)
    games.js     the cards in the binder
public/assets/
  card-back-*.png, logo.png   your source paintings (not loaded by the app)
  art/                        sliced art layers the GameCard renders
supabase/
  migrations/    the schema. 0001 is steps 1-3, 0002 the difficulty, 0003 the round engine
  tests/         psql smoke tests, one per migration
scripts/
  e2e-lobby.mjs      browser test of the whole create/join/lobby flow
  e2e-game.mjs       plays two whole games in four phone-sized browsers
  mock-postgrest.mjs offline stand-in for Supabase's REST layer
  slice-art.py       cuts the paintings into art layers (re-run after a re-export)
```

## The design system

Open **`/kit`** in the running app. Every primitive is on that page in every
state, including the three the round engine will use next: the role card that
turns over, the scoreboard clock, and the reveal.

The reference cards are made of three physical things, and so is every surface
in the interface:

| Material | CSS | Used for |
|---|---|---|
| **Metal frame** | `.frame` + `.metal-gold` / `-copper` / `-silver` / `-steel` / `-lime` | cards, panels, button rims, chips, fields |
| **Enamel plate** | `.plate` + `.enamel-ink` / `-navy` / `-red` / `-malachite` / `-lime` | button faces, chips, the join code, the timer |
| **Engraving** | `.engraved` (cut in) / `.raised` (stamped up) | every piece of display type |

Compose them, do not invent new ones:

```jsx
<div className="frame metal-gold">
  <div className="frame-inner enamel-ink">…</div>
</div>
```

**Colour** lives in `src/index.css` under `@theme`, in OKLCH, every value
sampled from the paintings. Neutrals are tinted toward the navy of the card
backs. Lime is the exact logo colour and is reserved for the one thing to do
next. There is no purple, no gradient text, no glass.

**Type** is Teko (titles, card names, join codes, timers) and Saira (everything
people read). Both are self-hosted through Fontsource, latin subset, about 90kB
of woff2 in total, so nothing is fetched from Google at runtime.

**Motion** is confined to state changes: the card turning over, a button
pressing, the clock ticking under ten seconds, a reveal landing. Nothing loops
while people are talking. `prefers-reduced-motion` turns the flip into a
crossfade and stops the tick.

**Primitives** in `src/ui/`: `Backdrop`, `Logo`, `Screen`, `Button`, `Panel`,
`Chip`, `Field`, `Stepper`, `Toggle`, `Corners`, `GameCard`,
`JoinCodeDisplay`, `PlayerRoster`, `TimerDisplay`, `RoleCard`, `RevealCard`,
`ConfigNotice`.

**Artwork** is never used as UI. `GameCard` draws the frame, the title band and
the plate itself and puts the sliced painting only in the art window. See
`public/assets/README.md` for the re-export notes — the current sources are
280px wide and go soft on a phone.

## One deliberate change from the build spec

The spec puts `target_player_name` on `sessions` and `role` on `players`. Both of
those tables are read by the browser using the anon key, which is public by
design, so a player could open devtools and read the target footballer and
everyone's role. That is the entire game.

So the secrets live in two side tables, `session_secrets` and `player_secrets`,
which have **no grants to the anon role at all** and are **not published to
Realtime**. Nothing the browser can do reaches them. When the round engine is
built, a player gets their own card through a `SECURITY DEFINER` function that
returns exactly what that one player is allowed to see and nothing else.

Everything else in the spec's data model is unchanged.

There are also no insert, update or delete policies on any table. Every write
goes through a function (`create_session`, `join_session`,
`update_session_settings`, `leave_session`), so validation lives in one place and
the browser cannot invent its own rows.

---

## Testing

**Schema.** Against a throwaway database:

```bash
psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
psql "$DATABASE_URL" -f supabase/migrations/0002_difficulty.sql
psql "$DATABASE_URL" -f supabase/migrations/0003_round_engine.sql
psql "$DATABASE_URL" -f supabase/tests/0001_smoke.sql
psql "$DATABASE_URL" -f supabase/tests/0002_smoke.sql
psql "$DATABASE_URL" -f supabase/tests/0003_smoke.sql
```

17, 7 and 46 checks. The first two confirm the join flow works and, more
importantly, that the anon role genuinely cannot read the secret tables or
write to anything directly. The third plays three games through the RPCs:
ties, majority skips, timer expiry, elimination, the salvage guess with close
spellings, the parity win, and that nothing secret leaks on the way.

**The lobby flow.** With the dev server running:

```bash
npm run test:e2e
```

Needs Playwright's browser once: `npx playwright install chromium`.

22 checks across four browser contexts at phone size: the ratio guard, the
duplicate-name refusal, an invite link prefilling the code, host settings and
the chosen difficulty reaching the other players, and the dead-end screens.
Screenshots land in `e2e-shots/`. It creates real lobbies, so point it at a dev
project.

**Whole games.** Also with the dev server running:

```bash
npm run test:game
```

22 checks. Four phones play a game with a tied vote, a found imposter and a
failed salvage guess; then three phones play one where the imposter steals it
with a surname. With `PGHOST` set it also winds the discussion clock down in
the database to prove the deadline moves every phone on.

---

## Deploying

Push to GitHub, import the repo at [vercel.com](https://vercel.com), and add
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under **Settings → Environment
Variables**. Vite is detected automatically. `vercel.json` already routes every
non-`/api` path to `index.html` so deep links like `/imposter/lobby/ABC12` work
on a hard refresh.

When the AI hints function arrives in step 7 it goes in `/api`, and
`ANTHROPIC_API_KEY` gets added as an environment variable **without** the `VITE_`
prefix, so it stays server-side.

---

## How a game runs

Everything after Start game is a `sessions.status` that every phone follows
over Realtime, and every transition is a database function (migration 0003).
The browser never writes a row itself.

```
waiting → peeking → discussion → voting → reveal ─┬→ discussion
                       ▲            └─ skip / tie ─┘  ├→ salvage → ended
                       └────────────────────────────  └→ ended
```

- **Start.** The host's phone sends the names for the chosen pack and mode;
  the server picks one and deals the roles. Not even the host's phone knows
  which name was picked.
- **Peek.** Tap the card. The first tap fetches your role (`get_my_card`, the
  only route a role ever takes out of the database) and counts you as having
  looked. When the last active player has looked the discussion starts by
  itself; the host can start it early.
- **Discussion.** A server deadline on `rounds.ends_at`; every phone counts
  down to the same instant and nudges `tick()` at zero, which checks its own
  clock before doing anything. Everyone pressing Vote now opens the vote early.
- **Vote.** One vote each, for another active player or a skip. The vote
  closes as soon as the result cannot change: everyone has voted, skips have a
  strict majority, or one player has a strict majority. A skip majority or a
  tie goes straight back to discussion with nobody out.
- **Reveal.** Who went out and what they were, in the brief's wording for an
  imposter. The breakdown of the vote is public here whatever the host chose.
  The host taps Continue.
- **Salvage.** If that was the last imposter, they get one typed guess. Lower
  case, no accents, one edit for short names and two for long, and a bare
  surname counts. Compared on the server, so the name never travels to the
  imposter's phone.
- **Full time.** Winner, how, the footballer, and every role on the sheet.

Three things the brief left open, settled with Saqib:

- **Live votes are the host's call.** Off (default) shows "4 of 6 have voted"
  until the reveal; on shows who picked whom as it happens.
- **Imposters win at parity.** The moment they are no longer outnumbered the
  game ends, the same rule the setup screen enforces. Without it a 1 v 1 ties
  forever.
- **The host carries on from a reveal**, even if they were the one voted out.

Still as before: nobody can join once the game has started, a refresh keeps
your seat (it is in localStorage), leaving mid-game marks you out, and the
lobby caps at 12.

## What is next

| Step | |
|---|---|
| 7 | AI hints via a serverless function (`ai_hints_enabled` and `player_secrets.hint_text` are already in place) |
| 8 | Card component with your artwork, responsive pass |
| 9 | Deploy and test across real devices |

## Packs and difficulty

Three packs, three modes, and they are independent: the pack picks the
competition and the era, the mode picks how obscure the names get. Every pack
is meant to be as hard as every other at the same mode.

| Mode | Squad metaphor | Who it is for | Footballers in play |
|---|---|---|---|
| **Casual** | starting XI | the whole table | 30 |
| **Ball Aware** | XI + bench | people who watch most weeks | 60 |
| **You Know Ball** | the full squad | the one who knows the back-up keeper | 100 |

Each pack file (`src/data/*.json`) has three lists keyed by mode id, and
`playersFor(pack, mode)` in `packs.js` returns everything up to and including
the chosen tier. The host picks both in the lobby; they are saved on the
session (`player_pack`, `difficulty`) so every phone sees the same thing and a
refresh does not lose them.

**Premier League** and **Champions League** are the 2026/27 season (the
Champions League pack leaves out English clubs so the two do not overlap);
**World Cup Heroes** is every tournament. The lists were written from general
football knowledge plus a read of the summer 2026 window, not a live data
source, so give them a read before launch. Squads move on.
