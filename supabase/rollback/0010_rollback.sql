-- ============================================================================
-- False Nine, rollback for migration 0010 (Football Tic-Tac-Toe)
--
-- Puts the database back exactly as 0009 left it. Run it in the Supabase SQL
-- editor only if you need to undo 0010. It runs as one transaction.
--
-- It refuses to run while any Football Tic-Tac-Toe lobby exists, because this
-- removes every table those lobbies keep their boards, moves, settings and
-- seat owners in. Close them first. join_session() and leave_session() are
-- restored exactly as 0008 wrote them, and the sessions and players read
-- policies exactly as 0001 wrote them.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.ttt_games') is null then
    raise exception 'Migration 0010 is not applied to this database';
  end if;
  if exists (select 1 from public.sessions where game_mode = 'tic_tac_toe') then
    raise exception 'Football Tic-Tac-Toe lobbies still exist. Close them before rolling back 0010';
  end if;
end $$;

-- ---- Read policies on the shared tables, as 0001 left them -------------------

drop policy "sessions are readable" on public.sessions;
create policy "sessions are readable" on public.sessions for select using (true);

drop policy "players are readable" on public.players;
create policy "players are readable"  on public.players  for select using (true);

-- ---- join_session, as 0008 left it ------------------------------------------

create or replace function public.join_session(
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

-- ---- leave_session, as 0008 left it -----------------------------------------

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

-- ---- Functions ---------------------------------------------------------------

drop function public.ttt_leave(uuid, uuid);
drop function public.ttt_pass(uuid);
drop function public.ttt_submit_move(uuid, int, uuid);
drop function public.ttt_rematch(uuid);
drop function public.ttt_start_game(uuid);
drop function public.ttt_update_settings(uuid, text);
drop function public.ttt_create_session(text, text);
drop function public.ttt_begin_board(uuid);
drop function public.ttt_acting_seat(uuid);
drop function public.ttt_my_seat(uuid);
drop function public.ttt_settle(uuid, text);
drop function public.ttt_board_has_answers(uuid, smallint[], uuid[]);
drop function public.ttt_winning_line(smallint[]);
drop function public.ttt_cell_accepts(uuid, int, uuid);
drop function public.ttt_generate_board(text, text);
drop function public.ttt_build_board(uuid[], uuid[], text, text);
drop function public.ttt_board_meets(int[], text, text);
drop function public.ttt_active_profile();

-- ---- Tables (their triggers and Realtime publication entries go with them) ---

-- This trigger lives on players, which stays, so it goes by name.
drop trigger players_ttt_seat_owned on public.players;

drop table public.seat_owners;
drop table public.ttt_move_checks;
drop table public.ttt_moves;
drop table public.ttt_games;
drop table public.ttt_board_cells;
drop table public.ttt_board_axes;
drop table public.ttt_boards;
drop table public.ttt_settings;
drop table public.ttt_config;
drop table public.ttt_difficulty_bands;
drop table public.ttt_threshold_profiles;
drop table public.ttt_lines;

-- The read-policy helpers, now that no policy uses them.
drop function public.ttt_can_see_board(uuid);
drop function public.session_visible(uuid);
drop function public.ttt_is_seated(uuid);

drop function public.ttt_games_after_delete();
drop function public.ttt_check_seat_owned();
drop function public.ttt_check_game_seated();
drop function public.ttt_check_board_complete();
drop function public.ttt_keep_board_whole();
drop function public.ttt_moves_before_update();
drop function public.ttt_forbid_change();

-- ---- The keys 0010 added to shared tables ------------------------------------

alter table public.football_categories drop constraint football_categories_id_type_unique;
alter table public.players             drop constraint players_id_session_unique;
alter table public.sessions            drop constraint sessions_id_game_mode_unique;

commit;
