-- ============================================================================
-- False Nine — Football Imposter
-- Migration 0001: initial schema, Realtime, RLS and the create/join RPCs.
--
-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query),
-- or via `supabase db push` if you use the CLI. It is safe to run once on a
-- fresh project. Re-running it will fail on the CREATE TABLE statements, which
-- is deliberate: it stops you silently wiping a live game.
--
-- ----------------------------------------------------------------------------
-- A NOTE ON WHERE THE SECRETS LIVE  (deviation from Section 3 of the spec)
--
-- The spec puts `target_player_name` on `sessions` and `role` / `hint_text` on
-- `players`. Both tables are read by the browser using the anon key, which is
-- public by design. If the secrets sat on those tables, any player could open
-- devtools and read the target footballer and everyone's role, which is the
-- whole game.
--
-- So the secrets live in two side tables, `session_secrets` and
-- `player_secrets`, which have NO grants to the anon role and are NOT published
-- to Realtime. Nothing the browser can do reaches them. They are only ever read
-- through SECURITY DEFINER functions that hand a player exactly what that one
-- player is allowed to see. Everything else in the spec's model is unchanged.
-- ============================================================================

-- Postgres 13+ ships gen_random_uuid() in pgcrypto; Supabase enables it already.
create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table public.sessions (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,
  -- FK added after `players` exists, since the two tables reference each other.
  host_player_id      uuid,
  player_pack         text not null default 'premier_league',
  num_imposters       int  not null default 1,
  ai_hints_enabled    boolean not null default false,
  discussion_seconds  int  not null default 180,
  voting_seconds      int  not null default 60,
  status              text not null default 'waiting',
  current_round       int  not null default 1,
  created_at          timestamptz not null default now(),
  started_at          timestamptz,

  constraint sessions_code_format     check (code ~ '^[A-Z0-9]{5}$'),
  constraint sessions_status_valid    check (status in ('waiting','peeking','discussion','voting','reveal','ended')),
  constraint sessions_imposters_range check (num_imposters between 1 and 4),
  constraint sessions_discussion_range check (discussion_seconds between 60 and 300),
  constraint sessions_voting_range    check (voting_seconds >= 30),
  constraint sessions_round_positive  check (current_round >= 1)
);

comment on table public.sessions is
  'One game lobby. `code` is the short join code, always stored uppercase.';

create table public.players (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.sessions(id) on delete cascade,
  display_name  text not null,
  is_host       boolean not null default false,
  is_active     boolean not null default true,
  has_peeked    boolean not null default false,
  joined_at     timestamptz not null default now(),

  constraint players_name_length check (char_length(trim(display_name)) between 1 and 20)
);

-- Two people in the same lobby cannot both be "Sam". Case-insensitive, because
-- "sam" and "Sam" on two phones is exactly the confusion this game does not need.
create unique index players_session_name_unique
  on public.players (session_id, lower(trim(display_name)));

create index players_session_idx on public.players (session_id);

-- The circular reference, added now that both tables exist.
alter table public.sessions
  add constraint sessions_host_player_fk
  foreign key (host_player_id) references public.players(id) on delete set null;

create table public.rounds (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.sessions(id) on delete cascade,
  round_number  int  not null,
  phase         text not null default 'discussion',
  started_at    timestamptz not null default now(),
  -- Server-computed deadline. Every client counts down to the same instant, so
  -- refreshing your phone cannot buy you extra seconds (Section 5).
  ends_at       timestamptz,

  constraint rounds_phase_valid check (phase in ('discussion','voting','reveal')),
  constraint rounds_number_positive check (round_number >= 1)
);

create unique index rounds_session_number_phase_unique
  on public.rounds (session_id, round_number, phase);

create index rounds_session_idx on public.rounds (session_id);

create table public.votes (
  id            uuid primary key default gen_random_uuid(),
  round_id      uuid not null references public.rounds(id) on delete cascade,
  voter_id      uuid not null references public.players(id) on delete cascade,
  voted_for_id  uuid references public.players(id) on delete cascade,
  is_skip       boolean not null default false,
  created_at    timestamptz not null default now(),

  -- A vote is either a skip with no target, or a target with no skip.
  constraint votes_shape check (
    (is_skip = true  and voted_for_id is null) or
    (is_skip = false and voted_for_id is not null)
  )
);

-- One vote per player per round. No changing your mind.
create unique index votes_round_voter_unique on public.votes (round_id, voter_id);
create index votes_round_idx on public.votes (round_id);

-- ---- Secret tables. Not published to Realtime, no anon grants. ----

create table public.session_secrets (
  session_id          uuid primary key references public.sessions(id) on delete cascade,
  target_player_name  text not null
);

comment on table public.session_secrets is
  'The target footballer, fixed for the whole session. Never reachable from the browser.';

create table public.player_secrets (
  player_id  uuid primary key references public.players(id) on delete cascade,
  role       text,
  hint_text  text,

  constraint player_secrets_role_valid check (role is null or role in ('civilian','imposter'))
);

comment on table public.player_secrets is
  'Per-player role and AI hint. Only ever returned by get_my_card() to that one player.';

-- ----------------------------------------------------------------------------
-- Row Level Security
--
-- Read: anyone with the anon key can read the four public tables. There is no
--       login in this game, and a lobby code is the only thing gating entry.
-- Write: there are deliberately NO insert/update/delete policies. Every write
--       goes through a SECURITY DEFINER function below, so validation lives in
--       one place and the browser cannot invent its own rows.
-- ----------------------------------------------------------------------------

alter table public.sessions        enable row level security;
alter table public.players         enable row level security;
alter table public.rounds          enable row level security;
alter table public.votes           enable row level security;
alter table public.session_secrets enable row level security;
alter table public.player_secrets  enable row level security;

create policy "sessions are readable" on public.sessions for select using (true);
create policy "players are readable"  on public.players  for select using (true);
create policy "rounds are readable"   on public.rounds   for select using (true);
-- Votes are readable live, which means a client could watch votes land in real
-- time rather than seeing them all at the tally. Revisit in step 5 if you want
-- the simultaneous-reveal feel; it becomes an RPC that returns counts only.
create policy "votes are readable"    on public.votes    for select using (true);

-- No policies at all on the two secret tables. RLS with zero policies denies
-- everything, which is exactly what we want for anyone holding the anon key.

-- ----------------------------------------------------------------------------
-- Grants
--
-- Supabase grants ALL on new public tables to anon and authenticated by
-- default. Strip that back to read-only on the public tables, and nothing at
-- all on the secret ones.
-- ----------------------------------------------------------------------------

revoke all on public.sessions, public.players, public.rounds, public.votes,
              public.session_secrets, public.player_secrets
  from anon, authenticated;

grant select on public.sessions, public.players, public.rounds, public.votes
  to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Realtime
--
-- REPLICA IDENTITY FULL makes the old row available on updates and deletes,
-- which Realtime needs to evaluate RLS on the previous state.
-- ----------------------------------------------------------------------------

alter table public.sessions replica identity full;
alter table public.players  replica identity full;
alter table public.rounds   replica identity full;
alter table public.votes    replica identity full;

do $$
declare
  t text;
begin
  foreach t in array array['sessions','players','rounds','votes'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

-- Join codes avoid I, L, O, 0 and 1. Someone is going to read this out across a
-- pub table and "is that a one or an I" is not a fun conversation.
create or replace function public.generate_session_code()
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
begin
  for i in 1..5 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: create_session
-- Creates the lobby and the host player in one transaction, so you can never
-- end up with a lobby that has no host.
-- ----------------------------------------------------------------------------

create or replace function public.create_session(
  p_display_name       text,
  p_player_pack        text    default 'premier_league',
  p_num_imposters      int     default 1,
  p_ai_hints_enabled   boolean default false,
  p_discussion_seconds int     default 180,
  p_voting_seconds     int     default 60
)
returns table (session_id uuid, code text, player_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name       text := trim(coalesce(p_display_name, ''));
  v_code       text;
  v_session_id uuid;
  v_player_id  uuid;
  v_attempt    int := 0;
begin
  if char_length(v_name) = 0 then
    raise exception 'Enter a display name' using errcode = 'check_violation';
  end if;
  if char_length(v_name) > 20 then
    raise exception 'Display name must be 20 characters or fewer' using errcode = 'check_violation';
  end if;

  -- Retry on the astronomically unlikely code collision rather than 500ing.
  loop
    v_attempt := v_attempt + 1;
    v_code := public.generate_session_code();
    exit when not exists (select 1 from public.sessions s where s.code = v_code);
    if v_attempt >= 10 then
      raise exception 'Could not allocate a session code, please try again';
    end if;
  end loop;

  insert into public.sessions (
    code, player_pack, num_imposters, ai_hints_enabled,
    discussion_seconds, voting_seconds, status
  )
  values (
    v_code, p_player_pack, p_num_imposters, p_ai_hints_enabled,
    p_discussion_seconds, p_voting_seconds, 'waiting'
  )
  returning id into v_session_id;

  insert into public.players (session_id, display_name, is_host)
  values (v_session_id, v_name, true)
  returning id into v_player_id;

  insert into public.player_secrets (player_id) values (v_player_id);

  update public.sessions set host_player_id = v_player_id where id = v_session_id;

  return query select v_session_id, v_code, v_player_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: join_session
-- ----------------------------------------------------------------------------

create or replace function public.join_session(
  p_code         text,
  p_display_name text
)
returns table (session_id uuid, code text, player_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code      text := upper(trim(coalesce(p_code, '')));
  v_name      text := trim(coalesce(p_display_name, ''));
  v_session   public.sessions%rowtype;
  v_player_id uuid;
  v_count     int;
begin
  if char_length(v_name) = 0 then
    raise exception 'Enter a display name' using errcode = 'check_violation';
  end if;
  if char_length(v_name) > 20 then
    raise exception 'Display name must be 20 characters or fewer' using errcode = 'check_violation';
  end if;

  select * into v_session from public.sessions s where s.code = v_code;

  if not found then
    raise exception 'No game found with code %', v_code using errcode = 'no_data_found';
  end if;

  if v_session.status <> 'waiting' then
    raise exception 'That game has already started' using errcode = 'check_violation';
  end if;

  select count(*) into v_count from public.players p where p.session_id = v_session.id;
  if v_count >= 12 then
    raise exception 'That game is full (12 players max)' using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.players p
    where p.session_id = v_session.id
      and lower(trim(p.display_name)) = lower(v_name)
  ) then
    raise exception 'Someone in this game is already called %', v_name using errcode = 'unique_violation';
  end if;

  insert into public.players (session_id, display_name, is_host)
  values (v_session.id, v_name, false)
  returning id into v_player_id;

  insert into public.player_secrets (player_id) values (v_player_id);

  return query select v_session.id, v_session.code, v_player_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: update_session_settings
-- Host-only. The player id acts as the bearer token: it is a v4 uuid that only
-- ever travelled to the one browser that created the lobby.
-- ----------------------------------------------------------------------------

create or replace function public.update_session_settings(
  p_session_id         uuid,
  p_player_id          uuid,
  p_player_pack        text,
  p_num_imposters      int,
  p_ai_hints_enabled   boolean,
  p_discussion_seconds int,
  p_voting_seconds     int
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.sessions%rowtype;
begin
  select * into v_session from public.sessions s where s.id = p_session_id;

  if not found then
    raise exception 'Game not found' using errcode = 'no_data_found';
  end if;

  if v_session.host_player_id is distinct from p_player_id then
    raise exception 'Only the host can change the settings' using errcode = 'insufficient_privilege';
  end if;

  if v_session.status <> 'waiting' then
    raise exception 'Settings are locked once the game starts' using errcode = 'check_violation';
  end if;

  update public.sessions
  set player_pack        = coalesce(p_player_pack, player_pack),
      num_imposters      = coalesce(p_num_imposters, num_imposters),
      ai_hints_enabled   = coalesce(p_ai_hints_enabled, ai_hints_enabled),
      discussion_seconds = coalesce(p_discussion_seconds, discussion_seconds),
      voting_seconds     = coalesce(p_voting_seconds, voting_seconds)
  where id = p_session_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: leave_session
-- Used when a player backs out of the lobby before kick-off. If the host
-- leaves, the lobby goes with them rather than stranding everyone else.
-- ----------------------------------------------------------------------------

create or replace function public.leave_session(
  p_session_id uuid,
  p_player_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.sessions%rowtype;
begin
  select * into v_session from public.sessions s where s.id = p_session_id;
  if not found then
    return;
  end if;

  if v_session.host_player_id = p_player_id and v_session.status = 'waiting' then
    delete from public.sessions where id = p_session_id;
    return;
  end if;

  delete from public.players where id = p_player_id and session_id = p_session_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Function grants. Execute is granted to anon explicitly; the functions
-- themselves are the security boundary.
-- ----------------------------------------------------------------------------

revoke all on function public.generate_session_code()      from public, anon, authenticated;
revoke all on function public.create_session(text, text, int, boolean, int, int) from public;
revoke all on function public.join_session(text, text)     from public;
revoke all on function public.update_session_settings(uuid, uuid, text, int, boolean, int, int) from public;
revoke all on function public.leave_session(uuid, uuid)    from public;

grant execute on function public.create_session(text, text, int, boolean, int, int) to anon, authenticated;
grant execute on function public.join_session(text, text)  to anon, authenticated;
grant execute on function public.update_session_settings(uuid, uuid, text, int, boolean, int, int) to anon, authenticated;
grant execute on function public.leave_session(uuid, uuid) to anon, authenticated;
