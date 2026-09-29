# Stage 5A integration gate

Checks the Football Tic-Tac-Toe backend (migration 0010) against a real
Supabase project: real Anonymous Auth, the Data API (PostgREST), row level
security and Realtime. `npm run test:db` and `npm run test:concurrency` stay
exactly as they are. They only ever talk to a plain local Postgres, and they
still refuse anything that looks like Supabase.

Everything here targets one **disposable development project** and nothing
else. It is never pointed at production.

## What each command does, and what it touches

| Command | Talks to | Changes anything? |
|---|---|---|
| `npm run integration:dev:check` | nothing (no network) | no. Shows the one target the other commands will use |
| `npm run integration:dev:migrate -- --plan` | the development database | no. Shows what it would apply |
| `npm run integration:dev:migrate` | the development database | yes. Applies migrations 0001 to 0010 that are missing, loads the fictional football fixture, sets the `dev` difficulty profile |
| `npm run integration:dev:migrate -- --export-sql` | nothing (no network) | no. Writes the same steps as files for the SQL editor, under `.integration/sql-editor/` |
| `npm run integration:dev:gate` | the development project's public API, with the publishable key | yes. Creates about six anonymous users and some test lobbies, and closes the lobbies afterwards (one is kept for `verify`) |
| `npm run integration:dev:verify` | the development database, read-only | no |
| `npm run integration:build-expectations` | a local throwaway Postgres only (same rules as `test:db`) | no. Regenerates `expectations.json` and `fixture-oracle.json` after a migration or fixture change |

`migrate` and `verify` are the only commands that connect to the database, and
only with `FN_DEV_DB_URL`. The gate never connects to the database, and it never
uses a secret or service-role key.

## Safety checks, before any request is sent

- Settings come from `.env.integration.local` (git-ignored) or the environment.
  Nothing reads `VITE_SUPABASE_URL` as a target.
- `FN_DEV_PROJECT_REF` must be typed out, and the URL (and the database host and
  user) must name that same project.
- A project listed in `FN_PROTECTED_PROJECT_REFS`, or the project the app's own
  `.env` files point at, is refused.
- Only a publishable key (or a legacy anon key) is accepted. An `sb_secret_` or
  service-role key stops everything.
- `migrate` only proceeds on a database that identifies as Supabase (API roles,
  Auth, `auth.uid()`, Realtime and its publication). It only applies migrations
  in order. It refuses a project whose `public` schema already holds tables
  that are not ours, and it refuses any database holding non-fixture
  footballers. Each migration runs in one transaction. It never drops anything
  and never touches the `auth`, `storage` or `realtime` schemas.

## Setting up

1. Copy `.env.integration.example` to `.env.integration.local` and fill it in.
2. In the development project's dashboard, under Authentication:
   - turn on **Allow anonymous sign-ins** (Sign In / Providers);
   - keep **Allow new users to sign up** on;
   - keep CAPTCHA off for this project;
   - under Rate Limits, raise the limit for anonymous sign-ins if you want more
     than about four runs an hour (each run signs in 6 users; the default limit
     is 30 an hour per IP address).
3. `npm run integration:dev:check`, and read the target it prints.
4. `npm run integration:dev:migrate -- --plan`, then `npm run integration:dev:migrate`.
5. `npm run integration:dev:gate`.
6. `npm run integration:dev:verify`. After a gate run, this also proves from the
   database side that `auth.uid()` inside the RPCs was the signed-in user: the
   seat each user created is owned, in `seat_owners`, by that user's Auth id.

`migrate`, `gate` and `verify` write their full output to
`.integration/<command>-<time>.log` (git-ignored). The gate also writes
`.integration/last-run.json`, which `verify` reads.

### Without a database password

Run `npm run integration:dev:migrate -- --export-sql` and paste the files from
`.integration/sql-editor/` into the development project's SQL editor, one at a
time and in order. The last one loads the fixture and has to be run as a single
paste. The gate works the same afterwards. `verify` needs the database
connection, so skip it.

## Outliving an access token (optional)

`npm run integration:dev:gate -- --wait-for-expiry` also keeps two Realtime
subscriptions open until 20 seconds after the access token they were opened
with has expired, and checks they still deliver. With Supabase's default
one-hour token that is too long to wait, so it skips itself unless you first
set the access token expiry to 5 minutes (Authentication > Sessions, or JWT
settings, depending on the dashboard version). Set it back afterwards.

## Local Supabase CLI stack

With `FN_DEV_PROJECT_REF=local`, the same commands accept
`http://127.0.0.1:<port>` and a local database URL, for a stack started with the
Supabase CLI.
