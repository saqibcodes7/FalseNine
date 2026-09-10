# False Nine

Football party games you play on your phones, together. No install, no account.
One person starts a game, everyone else joins with a five-character code.

This repo currently covers **steps 1 to 3** of the build order: the app shell,
the Supabase schema, and the create/join flow with a live lobby. The round
engine (peek, discussion, voting, reveal) is next.

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
  components/    shared UI — Button, Field, Stepper, Toggle, PlayerList…
  hooks/
    useLobby.js  live session + player list over Realtime, with a poll fallback
  lib/
    supabase.js  the client, plus the column lists the browser may read
    identity.js  which player this browser is, per lobby, in localStorage
  data/
    packs.js     the three player packs
    games.js     the tiles on the landing page
supabase/
  migrations/    the schema. 0001 is the whole of steps 1-3
  tests/         psql smoke tests for the migration
scripts/
  e2e-lobby.mjs      browser test of the whole create/join/lobby flow
  mock-postgrest.mjs offline stand-in for Supabase's REST layer
```

### Where the brand colours live

All of them are CSS custom properties at the top of `src/index.css`, under
`@theme`. Change `--color-lime-400` there and every button, badge and focus ring
follows. Nothing hardcodes a hex value.

### Where your artwork goes

`public/assets/`, with notes on export sizes in the README in that folder.
Nothing references it yet — that is step 8.

---

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
psql "$DATABASE_URL" -f supabase/tests/0001_smoke.sql
```

17 checks. It confirms the join flow works and, more importantly, that the anon
role genuinely cannot read the secret tables or write to anything directly.

**The lobby flow.** With the dev server running:

```bash
npm run test:e2e
```

18 checks across four browser contexts at phone size: the ratio guard, the
duplicate-name refusal, an invite link prefilling the code, host settings
reaching the other players, and the dead-end screens. Screenshots land in
`e2e-shots/`. It creates real lobbies, so point it at a dev project.

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

## What is next

| Step | |
|---|---|
| 4 | Round engine: peeking → discussion → voting → reveal, one round |
| 5 | Multi-round looping and imposter elimination tracking |
| 6 | Salvage guess for the last imposter voted out |
| 7 | AI hints via a serverless function |
| 8 | Card component with your artwork, responsive pass |
| 9 | Deploy and test across real devices |

A few things step 4 will need a decision on:

- **Votes are readable live.** Any client can watch votes land in real time
  rather than seeing them all at the tally. If you want the simultaneous-reveal
  moment, that becomes a function returning counts only.
- **Nobody can rejoin a game in progress.** `join_session` refuses once the
  status leaves `waiting`. If someone's phone dies mid-game they are out, unless
  we add a rejoin path keyed on their stored player id.
- **The lobby caps at 12.** Arbitrary, easy to change in `join_session`.

The player packs were written from general football knowledge rather than a live
data source, so give them a read before launch. Squads move on.
