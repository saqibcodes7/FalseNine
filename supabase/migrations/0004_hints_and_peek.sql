-- ============================================================================
-- False Nine — migration 0004: a breath before kick-off, and hints that work
--
-- Run this in the Supabase SQL editor AFTER 0001, 0002 and 0003 (paste the
-- contents of this file, not its path). It refuses to run twice.
--
-- Two fixes, both reported from a real game.
--
-- 1. The last player to look at their card got no time to read it. get_my_card()
--    started the discussion the instant their peek landed, which is the same
--    round-trip that returns them their footballer. Now the last peek arms a
--    deadline — sessions.peek_ends_at — and the discussion opens when that
--    passes. Everyone at the table watches the same countdown, and the host can
--    still cut it short with "Start the discussion".
--
--    Nobody has to press Continue. The grace period is the whole mechanism.
--
-- 2. Hints never appeared. start_game() dealt the roles and wrote
--    hint_text = null, and nothing ever wrote anything else, so an imposter with
--    hints turned on saw the same blank card as one without. The hints are now
--    curated per footballer and live next to the names in src/data/*.json; the
--    browser sends them alongside the candidates, and the server keeps the one
--    belonging to the footballer it picked.
--
--    The hint travels with the pack, not the target, so the server still chooses
--    the footballer on its own and no phone ever learns which one it was.
--
--    ai_hints_enabled is renamed hints_enabled to match: nothing about this is
--    AI any more, it is a hand-written word per player.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Columns
-- ----------------------------------------------------------------------------

alter table public.sessions
  add column peek_ends_at timestamptz;

comment on column public.sessions.peek_ends_at is
  'Set when the last active player peeks. The discussion opens once it passes, so the last person gets to read their card.';

alter table public.sessions
  rename column ai_hints_enabled to hints_enabled;

comment on column public.sessions.hints_enabled is
  'Host setting: give every imposter the one-word clue that ships with the target footballer.';

comment on table public.player_secrets is
  'Per-player role and, for imposters with hints on, the target''s one-word clue. Only ever returned by get_my_card() to that one player.';

-- How long the table gets to read the card once the last person has looked.
-- Long enough to take in a name and a clue, short enough that nobody fidgets.
create function public.peek_grace()
returns interval
language sql
immutable
as $$ select interval '8 seconds' $$;

-- ----------------------------------------------------------------------------
-- Settings RPCs: ai_hints_enabled -> hints_enabled
--
-- Postgres will not rename a parameter with CREATE OR REPLACE, and supabase-js
-- addresses arguments by name, so both functions are dropped and rebuilt. The
-- bodies are otherwise unchanged from 0003.
-- ----------------------------------------------------------------------------

drop function public.create_session(text, text, text, int, boolean, boolean, int, int);

create function public.create_session(
  p_display_name       text,
  p_player_pack        text    default 'premier_league',
  p_difficulty         text    default 'casual',
  p_num_imposters      int     default 1,
  p_hints_enabled      boolean default false,
  p_votes_visible      boolean default false,
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

  loop
    v_attempt := v_attempt + 1;
    v_code := public.generate_session_code();
    exit when not exists (select 1 from public.sessions s where s.code = v_code);
    if v_attempt >= 10 then
      raise exception 'Could not allocate a session code, please try again';
    end if;
  end loop;

  insert into public.sessions (
    code, player_pack, difficulty, num_imposters, hints_enabled, votes_visible,
    discussion_seconds, voting_seconds, status
  )
  values (
    v_code, p_player_pack, p_difficulty, p_num_imposters, p_hints_enabled, p_votes_visible,
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

drop function public.update_session_settings(uuid, uuid, text, text, int, boolean, boolean, int, int);

create function public.update_session_settings(
  p_session_id         uuid,
  p_player_id          uuid,
  p_player_pack        text,
  p_difficulty         text,
  p_num_imposters      int,
  p_hints_enabled      boolean,
  p_votes_visible      boolean,
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
      difficulty         = coalesce(p_difficulty, difficulty),
      num_imposters      = coalesce(p_num_imposters, num_imposters),
      hints_enabled      = coalesce(p_hints_enabled, hints_enabled),
      votes_visible      = coalesce(p_votes_visible, votes_visible),
      discussion_seconds = coalesce(p_discussion_seconds, discussion_seconds),
      voting_seconds     = coalesce(p_voting_seconds, voting_seconds)
  where id = p_session_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Internal helper: arm the peek deadline.
--
-- coalesce, not a plain assignment, so a second caller cannot push kick-off
-- further away — the first person to finish sets the clock and it runs.
-- ----------------------------------------------------------------------------

create function public.arm_peek(p_session_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.sessions
  set peek_ends_at = coalesce(peek_ends_at, now() + public.peek_grace())
  where id = p_session_id and status = 'peeking';
$$;

-- ----------------------------------------------------------------------------
-- begin_discussion: clears the peek deadline on the way past.
-- ----------------------------------------------------------------------------

create or replace function public.begin_discussion(p_session_id uuid, p_round int)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seconds int;
begin
  select discussion_seconds into v_seconds from public.sessions where id = p_session_id;

  update public.players set vote_ready = false where session_id = p_session_id;

  insert into public.rounds (session_id, round_number, phase, started_at, ends_at)
  values (p_session_id, p_round, 'discussion', now(), now() + make_interval(secs => v_seconds));

  update public.sessions
  set status = 'discussion', current_round = p_round, peek_ends_at = null
  where id = p_session_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- start_game: takes the hints alongside the candidates.
--
-- p_hints is positional — p_hints[i] belongs to p_candidates[i]. The server
-- draws an index, keeps the name in session_secrets and hands the matching clue
-- to every imposter. Sending the whole pack's hints rather than one hint is the
-- point: the host's phone posts the same payload whoever gets picked, so there
-- is nothing in the request to read the answer off.
-- ----------------------------------------------------------------------------

drop function public.start_game(uuid, uuid, text[]);

create function public.start_game(
  p_session_id uuid,
  p_player_id  uuid,
  p_candidates text[],
  p_hints      text[] default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.sessions%rowtype;
  v_players int;
  v_count   int;
  v_pick    int;
  v_target  text;
  v_hint    text := null;
begin
  select * into v_session from public.sessions where id = p_session_id for update;

  if not found then
    raise exception 'Game not found' using errcode = 'no_data_found';
  end if;
  if v_session.host_player_id is distinct from p_player_id then
    raise exception 'Only the host can start the game' using errcode = 'insufficient_privilege';
  end if;
  if v_session.status <> 'waiting' then
    raise exception 'The game has already started' using errcode = 'check_violation';
  end if;

  select count(*) into v_players from public.players where session_id = p_session_id;
  if v_players < 3 then
    raise exception 'Need at least 3 players to start' using errcode = 'check_violation';
  end if;
  if v_session.num_imposters >= v_players - v_session.num_imposters then
    raise exception 'Imposters have to be outnumbered' using errcode = 'check_violation';
  end if;

  v_count := coalesce(array_length(p_candidates, 1), 0);
  if p_candidates is null or v_count < 3 then
    raise exception 'The player pack is empty' using errcode = 'check_violation';
  end if;

  v_pick   := 1 + floor(random() * v_count)::int;
  v_target := p_candidates[v_pick];
  if v_target is null or char_length(trim(v_target)) = 0 or char_length(v_target) > 80 then
    raise exception 'The player pack has a bad entry' using errcode = 'check_violation';
  end if;

  -- A hint only counts if the arrays line up. A mismatched or missing list
  -- means no clue, never someone else's clue.
  if v_session.hints_enabled
     and p_hints is not null
     and coalesce(array_length(p_hints, 1), 0) = v_count then
    v_hint := nullif(trim(coalesce(p_hints[v_pick], '')), '');
    if v_hint is not null then
      v_hint := left(v_hint, 60);
    end if;
  end if;

  insert into public.session_secrets (session_id, target_player_name)
  values (p_session_id, trim(v_target))
  on conflict (session_id) do update set target_player_name = excluded.target_player_name;

  -- Deal the roles: shuffle, first num_imposters are imposters. The clue goes
  -- on their rows only, so a civilian's row has nothing to leak.
  with dealt as (
    select p.id, row_number() over (order by random()) as seat
    from public.players p
    where p.session_id = p_session_id
  )
  update public.player_secrets s
  set role      = case when d.seat <= v_session.num_imposters then 'imposter' else 'civilian' end,
      hint_text = case when d.seat <= v_session.num_imposters then v_hint else null end
  from dealt d
  where s.player_id = d.id;

  update public.players
  set is_active = true, has_peeked = false, vote_ready = false,
      revealed_role = null, eliminated_in_round = null
  where session_id = p_session_id;

  update public.sessions
  set status = 'peeking', current_round = 1, started_at = now(),
      peek_ends_at = null, winner = null, salvage_player_id = null,
      salvage_guess = null, salvage_correct = null, revealed_target = null,
      ended_at = null
  where id = p_session_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- get_my_card: the last peek arms the clock instead of starting the discussion.
-- ----------------------------------------------------------------------------

create or replace function public.get_my_card(p_session_id uuid, p_player_id uuid)
returns table (role text, target_name text, hint_text text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.sessions%rowtype;
  v_player  public.players%rowtype;
  v_secret  public.player_secrets%rowtype;
  v_waiting int;
begin
  select * into v_session from public.sessions where id = p_session_id for update;
  if not found then
    raise exception 'Game not found' using errcode = 'no_data_found';
  end if;

  select * into v_player from public.players p where p.id = p_player_id and p.session_id = p_session_id;
  if not found then
    raise exception 'You are not in this game' using errcode = 'insufficient_privilege';
  end if;
  if v_session.status = 'waiting' then
    raise exception 'The game has not started' using errcode = 'check_violation';
  end if;

  select * into v_secret from public.player_secrets s where s.player_id = p_player_id;

  if v_session.status = 'peeking' and not v_player.has_peeked then
    update public.players set has_peeked = true where id = p_player_id;

    select count(*) into v_waiting
    from public.players p where p.session_id = p_session_id and p.is_active and not p.has_peeked;

    -- Everyone has looked. Start the clock rather than the discussion: the
    -- person who just tapped is still reading the card this call returned.
    if v_waiting = 0 then
      perform public.arm_peek(p_session_id);
    end if;
  end if;

  return query select
    v_secret.role,
    case when v_secret.role = 'civilian'
         then (select ss.target_player_name from public.session_secrets ss where ss.session_id = p_session_id)
         else null end,
    case when v_secret.role = 'imposter' then v_secret.hint_text else null end;
end;
$$;

-- ----------------------------------------------------------------------------
-- tick: also opens the discussion when the peek deadline passes.
-- ----------------------------------------------------------------------------

create or replace function public.tick(p_session_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.sessions%rowtype;
  v_ends    timestamptz;
begin
  select * into v_session from public.sessions where id = p_session_id for update;
  if not found then
    return null;
  end if;

  if v_session.status = 'peeking' then
    if v_session.peek_ends_at is not null and v_session.peek_ends_at <= now() then
      perform public.begin_discussion(p_session_id, 1);
    end if;

  elsif v_session.status in ('discussion', 'voting') then
    select ends_at into v_ends from public.rounds
    where session_id = p_session_id and round_number = v_session.current_round and phase = v_session.status;

    if v_ends is not null and v_ends <= now() then
      if v_session.status = 'discussion' then
        perform public.begin_voting(p_session_id);
      else
        perform public.tally_votes(p_session_id);
      end if;
    end if;
  end if;

  select status into v_session.status from public.sessions where id = p_session_id;
  return v_session.status;
end;
$$;

-- ----------------------------------------------------------------------------
-- leave_session: if the departed was the last one everyone was waiting on, the
-- others may have only just looked, so they get the grace period too.
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
  v_counts  record;
  v_waiting int;
begin
  select * into v_session from public.sessions s where s.id = p_session_id for update;
  if not found then
    return;
  end if;

  if v_session.status = 'waiting' then
    if v_session.host_player_id = p_player_id then
      delete from public.sessions where id = p_session_id;
    else
      delete from public.players where id = p_player_id and session_id = p_session_id;
    end if;
    return;
  end if;

  if v_session.status = 'ended' then
    return;
  end if;

  update public.players
  set is_active = false, vote_ready = false
  where id = p_player_id and session_id = p_session_id and is_active;

  if not found then
    return;
  end if;

  select * into v_counts from public.session_counts(p_session_id);

  if v_counts.imposters = 0 then
    perform public.end_game(p_session_id, 'civilians');
    return;
  end if;
  if v_counts.imposters >= v_counts.civilians then
    perform public.end_game(p_session_id, 'imposters');
    return;
  end if;

  if v_session.status = 'peeking' then
    select count(*) into v_waiting from public.players where session_id = p_session_id and is_active and not has_peeked;
    if v_waiting = 0 then perform public.arm_peek(p_session_id); end if;
  elsif v_session.status = 'discussion' then
    select count(*) into v_waiting from public.players where session_id = p_session_id and is_active and not vote_ready;
    if v_waiting = 0 then perform public.begin_voting(p_session_id); end if;
  elsif v_session.status = 'voting' then
    select count(*) into v_waiting
    from public.players p
    where p.session_id = p_session_id and p.is_active
      and not exists (
        select 1 from public.votes v
        join public.rounds r on r.id = v.round_id
        where v.voter_id = p.id and r.session_id = p_session_id
          and r.round_number = v_session.current_round and r.phase = 'voting');
    if v_waiting = 0 then perform public.tally_votes(p_session_id); end if;
  elsif v_session.status = 'salvage' and v_session.salvage_player_id = p_player_id then
    perform public.end_game(p_session_id, 'civilians');
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Grants for the rebuilt functions. peek_grace() and arm_peek() are internal.
-- ----------------------------------------------------------------------------

revoke all on function public.create_session(text, text, text, int, boolean, boolean, int, int) from public;
revoke all on function public.update_session_settings(uuid, uuid, text, text, int, boolean, boolean, int, int) from public;
revoke all on function public.start_game(uuid, uuid, text[], text[])     from public;

revoke all on function public.peek_grace()                               from public, anon, authenticated;
revoke all on function public.arm_peek(uuid)                             from public, anon, authenticated;

grant execute on function public.create_session(text, text, text, int, boolean, boolean, int, int) to anon, authenticated;
grant execute on function public.update_session_settings(uuid, uuid, text, text, int, boolean, boolean, int, int) to anon, authenticated;
grant execute on function public.start_game(uuid, uuid, text[], text[])  to anon, authenticated;
