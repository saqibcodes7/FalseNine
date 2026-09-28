-- ============================================================================
-- False Nine, rollback for migration 0008 (more than one game)
--
-- Puts the database back exactly as 0007 left it. Run it in the Supabase SQL
-- editor only if you need to undo 0008. It runs as one transaction.
--
-- It refuses to run while any session belongs to a game other than Football
-- Imposter, because dropping sessions.game_mode would leave those rows
-- describing a game that no longer exists. Close those lobbies first. It also
-- refuses while Football Tic-Tac-Toe's own tables exist; roll those back first.
--
-- Every function below is restored from the migration that last defined it:
-- join_session from 0001, update_session_settings and start_game from 0004,
-- play_again and leave_session from 0005.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.game_modes') is null then
    raise exception 'Migration 0008 is not applied to this database';
  end if;
  if to_regclass('public.ttt_games') is not null then
    raise exception 'Roll back the Football Tic-Tac-Toe migration before 0008';
  end if;
  if exists (select 1 from public.sessions where game_mode <> 'imposter') then
    raise exception 'Some sessions are not Football Imposter games. Close them before rolling back 0008';
  end if;
end $$;

-- ---- Functions, as they were ------------------------------------------------

drop function public.join_session(text, text, text);

create function public.join_session(
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

  if v_session.status in ('waiting', 'ended') then
    if v_session.host_player_id = p_player_id then
      delete from public.sessions where id = p_session_id;
    else
      delete from public.players where id = p_player_id and session_id = p_session_id;
    end if;
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

drop function public.imposter_leave_in_play(uuid, uuid);
drop function public.give_up_seat(uuid, uuid);

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

-- ---- Schema, as it was ------------------------------------------------------

alter table public.sessions drop constraint sessions_status_valid;
alter table public.sessions drop column game_mode;
alter table public.sessions add constraint sessions_status_valid
  check (status in ('waiting','peeking','discussion','voting','reveal','salvage','ended'));

comment on table public.sessions is
  'One game lobby. `code` is the short join code, always stored uppercase.';

drop table public.game_modes;

-- ---- Grants, as 0001 set them -----------------------------------------------

revoke all on function public.join_session(text, text) from public;
grant execute on function public.join_session(text, text) to anon, authenticated;

commit;
