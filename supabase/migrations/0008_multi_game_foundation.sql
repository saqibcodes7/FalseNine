-- ============================================================================
-- False Nine, migration 0008: more than one game
--
-- Run this in the Supabase SQL editor AFTER 0001 to 0007 (paste the contents of
-- this file, not its path). It refuses to run twice, and it runs as one
-- transaction, so it either all lands or none of it does.
--
-- Until now every session was a game of Football Imposter. This gives each
-- session a game mode, so a second game can share the lobby machinery (codes,
-- seats, joining and leaving) without borrowing Imposter's rules.
--
-- What changes
--
--   game_modes          A small registry: each game's id, name and seat limits.
--                       Football Tic-Tac-Toe is registered now so the rules
--                       below can name it; nothing can create one until its
--                       own migration adds the RPCs.
--
--   sessions.game_mode  Every existing session becomes 'imposter', which is
--                       what they all are. The status check now depends on the
--                       mode: Imposter keeps its seven phases, Tic-Tac-Toe
--                       gets waiting, playing and ended.
--
--   join_session()      Gains p_game_mode, defaulting to 'imposter'. Leaving it
--                       out means "I am joining a Football Imposter game", so
--                       an older app can never land in another game. A code
--                       from a different game is refused with a message that
--                       names it. The seat limit comes from game_modes (still
--                       12 for Imposter), the session row is locked so two
--                       people cannot both take the last seat, and the hidden
--                       role row is only created for Imposter.
--
--   leave_session()     Before kick-off it works as it always has, for every
--                       game: the host leaving closes the lobby, anyone else
--                       gives up their seat. After kick-off it hands over to
--                       the game. Imposter's rules move, unchanged, into
--                       imposter_leave_in_play().
--
--   start_game(), update_session_settings(), play_again()
--                       These three can act on a lobby that is waiting or
--                       finished, so they now refuse a session that is not a
--                       Football Imposter game. Their bodies are otherwise
--                       exactly as 0004 and 0005 left them. The other Imposter
--                       RPCs only act in Imposter's own phases, which a session
--                       of another game can never be in.
--
--   create_session() is untouched. It is the Football Imposter entry point and
--   every session it makes is an Imposter one by default.
--
-- supabase/rollback/0008_rollback.sql undoes all of this.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.game_modes') is not null then
    raise exception 'Migration 0008 has already been run on this database';
  end if;
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tie_grace'
  ) then
    raise exception 'Run migrations 0001 to 0007 before 0008';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- The registry
-- ----------------------------------------------------------------------------

create table public.game_modes (
  id           text primary key,
  name         text not null,
  min_players  int  not null,
  max_players  int  not null,

  constraint game_modes_id_format    check (id ~ '^[a-z][a-z0-9_]*$'),
  constraint game_modes_player_range check (min_players >= 1 and max_players >= min_players)
);

comment on table public.game_modes is
  'The games a session can be. Seat limits live here so joining works the same way for every game.';

insert into public.game_modes (id, name, min_players, max_players) values
  ('imposter',    'Football Imposter',    3, 12),
  ('tic_tac_toe', 'Football Tic-Tac-Toe', 2, 2);

alter table public.game_modes enable row level security;
create policy "game modes are readable" on public.game_modes for select using (true);
revoke all on public.game_modes from anon, authenticated;
grant select on public.game_modes to anon, authenticated;

-- ----------------------------------------------------------------------------
-- sessions.game_mode, and a status check that depends on it
-- ----------------------------------------------------------------------------

alter table public.sessions
  add column game_mode text not null default 'imposter' references public.game_modes(id);

comment on column public.sessions.game_mode is
  'Which game this session is. Set once, when the session is created.';

comment on table public.sessions is
  'One game lobby. `code` is the short join code, always stored uppercase. The settings and round columns (player_pack through revealed_target) belong to Football Imposter; other games keep their state in tables of their own.';

alter table public.sessions drop constraint sessions_status_valid;
alter table public.sessions add constraint sessions_status_valid check (
  (game_mode = 'imposter'
     and status in ('waiting','peeking','discussion','voting','reveal','salvage','ended'))
  or
  (game_mode = 'tic_tac_toe'
     and status in ('waiting','playing','ended'))
);

-- ----------------------------------------------------------------------------
-- RPC: join_session, now for a named game
-- ----------------------------------------------------------------------------

drop function public.join_session(text, text);

create function public.join_session(
  p_code         text,
  p_display_name text,
  p_game_mode    text default 'imposter'
)
returns table (session_id uuid, code text, player_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code      text := upper(trim(coalesce(p_code, '')));
  v_name      text := trim(coalesce(p_display_name, ''));
  -- Omitted, null or blank all mean Football Imposter, never "any game".
  v_mode      text := coalesce(nullif(trim(p_game_mode), ''), 'imposter');
  v_game      public.game_modes%rowtype;
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

  select * into v_game from public.game_modes g where g.id = v_mode;
  if not found then
    raise exception 'Unknown game' using errcode = 'invalid_parameter_value';
  end if;

  -- Locked, so two people joining at the same moment are seated one after the
  -- other and cannot both take the last seat.
  select * into v_session from public.sessions s where s.code = v_code for update;

  if not found then
    raise exception 'No game found with code %', v_code using errcode = 'no_data_found';
  end if;

  if v_session.game_mode <> v_mode then
    raise exception 'That code is for %. Join it from there.',
      (select g.name from public.game_modes g where g.id = v_session.game_mode)
      using errcode = 'check_violation';
  end if;

  if v_session.status <> 'waiting' then
    raise exception 'That game has already started' using errcode = 'check_violation';
  end if;

  select count(*) into v_count from public.players p where p.session_id = v_session.id;
  if v_count >= v_game.max_players then
    raise exception 'That game is full (% players max)', v_game.max_players using errcode = 'check_violation';
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

  -- Only Imposter deals hidden roles.
  if v_session.game_mode = 'imposter' then
    insert into public.player_secrets (player_id) values (v_player_id);
  end if;

  return query select v_session.id, v_session.code, v_player_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Leaving
--
-- give_up_seat() is the rule every game shares before kick-off: the host
-- leaving closes the lobby, anyone else just gives up their seat. It is the
-- same rule 0005 wrote inline, lifted out so each game can use it.
-- ----------------------------------------------------------------------------

create function public.give_up_seat(p_session_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.sessions s
    where s.id = p_session_id and s.host_player_id = p_player_id
  ) then
    delete from public.sessions where id = p_session_id;
  else
    delete from public.players where id = p_player_id and session_id = p_session_id;
  end if;
end;
$$;

-- Football Imposter's leave_session() from 0005, moved here unchanged apart
-- from calling give_up_seat() for the lobby rule it used to spell out.
create function public.imposter_leave_in_play(
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

  if v_session.status in ('waiting', 'ended') then
    perform public.give_up_seat(p_session_id, p_player_id);
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
  -- Every path below runs under this lock, whichever game it is.
  select * into v_session from public.sessions s where s.id = p_session_id for update;
  if not found then
    return;
  end if;

  if v_session.status = 'waiting' then
    perform public.give_up_seat(p_session_id, p_player_id);
    return;
  end if;

  -- After kick-off, what leaving means is up to the game.
  if v_session.game_mode = 'imposter' then
    perform public.imposter_leave_in_play(p_session_id, p_player_id);
    return;
  end if;

  raise exception 'Leaving this game is not supported yet' using errcode = 'feature_not_supported';
end;
$$;

-- ----------------------------------------------------------------------------
-- The three Imposter RPCs that can act on a waiting or finished lobby refuse
-- any other game. Bodies otherwise exactly as 0004 and 0005 left them.
-- ----------------------------------------------------------------------------

create or replace function public.update_session_settings(
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
  if v_session.game_mode <> 'imposter' then
    raise exception 'That is not a Football Imposter game' using errcode = 'check_violation';
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

create or replace function public.start_game(
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
  if v_session.game_mode <> 'imposter' then
    raise exception 'That is not a Football Imposter game' using errcode = 'check_violation';
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

create or replace function public.play_again(p_session_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.sessions%rowtype;
begin
  select * into v_session from public.sessions where id = p_session_id for update;

  if not found then
    raise exception 'Game not found' using errcode = 'no_data_found';
  end if;
  if v_session.game_mode <> 'imposter' then
    raise exception 'That is not a Football Imposter game' using errcode = 'check_violation';
  end if;
  if v_session.host_player_id is distinct from p_player_id then
    raise exception 'Only the host can start another game' using errcode = 'insufficient_privilege';
  end if;
  if v_session.status = 'waiting' then
    return; -- already back in the lobby; harmless double tap
  end if;
  if v_session.status <> 'ended' then
    raise exception 'Finish this game first' using errcode = 'check_violation';
  end if;

  -- Votes hang off rounds and go with them.
  delete from public.rounds where session_id = p_session_id;
  delete from public.votes  where session_id = p_session_id;
  delete from public.session_secrets where session_id = p_session_id;

  update public.player_secrets s
  set role = null, hint_text = null
  from public.players p
  where p.id = s.player_id and p.session_id = p_session_id;

  update public.players
  set is_active = true, has_peeked = false, vote_ready = false,
      revealed_role = null, eliminated_in_round = null
  where session_id = p_session_id;

  update public.sessions
  set status = 'waiting', current_round = 1, started_at = null,
      peek_ends_at = null, reveal_ends_at = null, winner = null,
      salvage_player_id = null, salvage_guess = null, salvage_correct = null,
      revealed_target = null, ended_at = null
  where id = p_session_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Grants. join_session has a new signature, so it needs its grants again. The
-- two leaving helpers are internal: nobody but the owner can call them.
-- ----------------------------------------------------------------------------

revoke all on function public.join_session(text, text, text) from public;
grant execute on function public.join_session(text, text, text) to anon, authenticated;

revoke all on function public.give_up_seat(uuid, uuid)           from public, anon, authenticated;
revoke all on function public.imposter_leave_in_play(uuid, uuid) from public, anon, authenticated;

commit;
