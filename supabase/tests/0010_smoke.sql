-- ============================================================================
-- Smoke tests for migration 0010 (Football Tic-Tac-Toe).
--
-- Run against a THROWAWAY database, after all the migrations. The easy way is
-- `npm run test:db`. Loads the fictional fixture, so no result depends on a
-- real-world fact. Races between two phones are tested separately, with real
-- parallel connections, by `npm run test:concurrency`.
--
-- SIGNED-IN USERS. Every Tic-Tac-Toe seat belongs to a signed-in user. These
-- tests pretend to be one the way the SQL sees it: they switch to the
-- authenticated role and set request.jwt.claims, the setting Supabase fills
-- from the caller's JWT, which is what auth.uid() reads. The stand-in for
-- auth.uid() lives in supabase/tests/_supabase_shim.sql. That exercises the
-- SQL, the policies and the grants. It is NOT a Supabase Auth, PostgREST or
-- Realtime integration test: nothing here signs a JWT, sends a request or
-- subscribes to a change. Those belong to the local Supabase CLI gate.
--
-- Two boards are built by hand from the fixture so every game here is
-- deterministic:
--
--   Board A   rows  Harbour City FC, Port Aldry, Redmoor United
--             cols  Ironside FC, Veloria (nationality), Veloria Premier
--                   Division (trophy: won the league)
--
--             0 Pavel Orskin      1 Arlo Venn, Idris Kallow    2 Arlo Venn, Idris Kallow, Mateo Silvane
--             3 Stefan Dravek     4 Owen Marrick               5 Owen Marrick, Samuel Oduvar
--             6 Leon Varrow,      7 Leon Varrow, Owen Marrick, 8 Owen Marrick, Samuel Oduvar,
--               Teo Vargalo         Tomas Quell                  Tomas Quell
--
--   Board B   rows  Carvania, Veloria (nationalities), Veloria Premier Division
--             cols  Castellan CF, Golden Boot of the Isles (award), Port Aldry
--             Four claims leave every other square with nobody left to name.
--
-- Everything else (generated boards, rematches, the coin toss) uses the 'dev'
-- difficulty profile, which the small fixture needs. The 'standard' profile is
-- checked on its own in section 2 and put back at the end.
--
-- Every check prints PASS or FAIL.
-- ============================================================================

\pset pager off
\set ON_ERROR_STOP on

-- Start clean. A lobby takes its games, moves, boards and seat owners with it.
delete from sessions;
delete from ttt_boards b where not exists (select 1 from ttt_games g where g.board_id = b.id);
update ttt_config set active_profile = 'standard';
select set_config('request.jwt.claims', '', false) \gset

set fn.load_football_fixture = 'yes';
\ir ../fixtures/football_fixture.sql

-- ---- Helpers ------------------------------------------------------------------

-- Footballer ids by full name, readable by the browser's roles for these tests
-- only (the real footballer table is not).
create temp table fp as select full_name, id from public.football_players;
grant select on fp to anon, authenticated;
create function pg_temp.fid(p_name text) returns uuid language sql stable as
  $$ select id from pg_temp.fp where full_name = p_name $$;

create function pg_temp.cat(p_type text, p_label text) returns uuid language sql stable as
  $$ select id from public.football_categories where type = p_type and label = p_label $$;

-- Be this signed-in user from now on, or nobody (null). Only what auth.uid()
-- reads; the role is switched separately with SET ROLE.
create function pg_temp.act(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end,
    false);
end $$;

create function pg_temp.board_a() returns uuid language sql as $$
  select public.ttt_build_board(
    array[pg_temp.cat('CLUB', 'Harbour City FC'), pg_temp.cat('CLUB', 'Port Aldry'), pg_temp.cat('CLUB', 'Redmoor United')],
    array[pg_temp.cat('CLUB', 'Ironside FC'), pg_temp.cat('NATIONALITY', 'Veloria'), pg_temp.cat('TROPHY', 'Veloria Premier Division')],
    'medium', 'dev')
$$;

create function pg_temp.board_b() returns uuid language sql as $$
  select public.ttt_build_board(
    array[pg_temp.cat('NATIONALITY', 'Carvania'), pg_temp.cat('NATIONALITY', 'Veloria'), pg_temp.cat('TROPHY', 'Veloria Premier Division')],
    array[pg_temp.cat('CLUB', 'Castellan CF'), pg_temp.cat('TROPHY', 'Golden Boot of the Isles'), pg_temp.cat('CLUB', 'Port Aldry')],
    'medium', 'dev')
$$;

-- A two-seat lobby, through the real RPCs, each seat taken by a new signed-in
-- user. Returns both seats and both users.
create function pg_temp.lobby(p_host text, p_opp text)
returns table (sid uuid, code text, host uuid, opp uuid, host_uid uuid, opp_uid uuid) language plpgsql as $$
declare
  v      record;
  v_o    uuid;
  v_hu   uuid := gen_random_uuid();
  v_ou   uuid := gen_random_uuid();
  v_was  text := coalesce(current_setting('request.jwt.claims', true), '');
begin
  perform pg_temp.act(v_hu);
  select * into v from public.ttt_create_session(p_host);
  perform pg_temp.act(v_ou);
  select j.player_id into v_o from public.join_session(v.code, p_opp, 'tic_tac_toe') j;
  perform set_config('request.jwt.claims', v_was, false);
  return query select v.session_id, v.code, v.player_id, v_o, v_hu, v_ou;
end $$;

-- Put a hand-built board in play, with chosen marks. Owner only: this is the
-- one thing the tests do that no RPC does, so the games are deterministic.
create function pg_temp.deal(p_session uuid, p_board uuid, p_x uuid, p_o uuid, p_starter text default 'X')
returns uuid language plpgsql as $$
declare v_game uuid;
begin
  insert into public.ttt_games (session_id, board_number, board_id, x_player_id, o_player_id, x_name, o_name, starter_mark, turn_mark)
  values (
    p_session,
    (select coalesce(max(board_number), 0) + 1 from public.ttt_games where session_id = p_session),
    p_board, p_x, p_o,
    (select display_name from public.players where id = p_x),
    (select display_name from public.players where id = p_o),
    p_starter, p_starter)
  returning id into v_game;
  update public.sessions set status = 'playing' where id = p_session;
  return v_game;
end $$;

-- Play a list of turns: 'X 0 Pavel Orskin' or 'O pass'. Each turn is made as
-- that mark's signed-in user. Returns one letter a turn: c(laimed), w(rong)
-- or p(ass).
create function pg_temp.run(p_session uuid, p_x_uid uuid, p_o_uid uuid, p_steps text[]) returns text language plpgsql as $$
declare
  s      text;
  v_bits text[];
  v_out  text := '';
  v_was  text := coalesce(current_setting('request.jwt.claims', true), '');
begin
  foreach s in array p_steps loop
    perform pg_temp.act(case left(s, 1) when 'X' then p_x_uid else p_o_uid end);
    if s ~ '^. pass$' then
      perform public.ttt_pass(p_session);
      v_out := v_out || 'p';
    else
      v_bits := regexp_match(s, '^(X|O) (\d) (.+)$');
      v_out := v_out || left((select m.outcome from public.ttt_submit_move(p_session, v_bits[2]::int, pg_temp.fid(v_bits[3])) m), 1);
    end if;
  end loop;
  perform set_config('request.jwt.claims', v_was, false);
  return v_out;
end $$;

-- The next three are the tests' own view of the truth, so they read as the
-- owner whoever the test is pretending to be. What the browser itself can
-- read is tested on its own, in section 8.

-- The latest board in a lobby, as one line: 'playing turn O', 'won by X on line 0 (line)'.
create function pg_temp.state(p_session uuid) returns text language sql security definer as $$
  select g.status
         || coalesce(' turn ' || g.turn_mark, '')
         || coalesce(' by ' || g.winner_mark, '')
         || coalesce(' on line ' || g.winning_line, '')
         || coalesce(' (' || g.end_reason || ')', '')
  from public.ttt_games g where g.session_id = p_session order by g.board_number desc limit 1
$$;

-- The latest board's squares: 'X.O......'.
create function pg_temp.grid(p_session uuid) returns text language sql security definer as $$
  select string_agg(coalesce(m.mark, '.'), '' order by c.cell)
  from generate_series(0, 8) c(cell)
  left join public.ttt_moves m
    on m.cell = c.cell and m.kind = 'claim'
   and m.game_id = (select g.id from public.ttt_games g where g.session_id = p_session order by g.board_number desc limit 1)
$$;

create function pg_temp.moves(p_session uuid) returns bigint language sql security definer as
  $$ select count(*) from public.ttt_moves where session_id = p_session $$;

-- What the CURRENT role and user can read of one lobby and one board. Runs
-- as the caller, so row level security decides every count.
create function pg_temp.sees(p_session uuid, p_board uuid) returns text language sql as $$
  select 'sessions ' || (select count(*) from public.sessions where id = p_session)
      || ', players ' || (select count(*) from public.players where session_id = p_session)
      || ', settings ' || (select count(*) from public.ttt_settings where session_id = p_session)
      || ', games ' || (select count(*) from public.ttt_games where session_id = p_session)
      || ', moves ' || (select count(*) from public.ttt_moves where session_id = p_session)
      || ', boards ' || (select count(*) from public.ttt_boards where id = p_board)
      || ', axes ' || (select count(*) from public.ttt_board_axes where board_id = p_board)
$$;

-- Run some SQL and expect it to be refused with this hint.
create function pg_temp.refused(p_what text, p_sql text, p_hint text) returns text language plpgsql as $$
declare
  v_hint text;
  v_msg  text;
begin
  execute p_sql;
  return 'FAIL: ' || p_what || ' was accepted';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint, v_msg = message_text;
  if coalesce(v_hint, '') = p_hint then
    return 'PASS: ' || p_what || ' (' || v_msg || ')';
  end if;
  return 'FAIL: ' || p_what || ': ' || v_msg || ' / hint ' || coalesce(v_hint, 'none');
end $$;

-- Run some SQL and expect it to fail with exactly this message.
create function pg_temp.refused_with(p_what text, p_sql text, p_message text) returns text language plpgsql as $$
declare v_msg text;
begin
  execute p_sql;
  return 'FAIL: ' || p_what || ' was accepted';
exception when others then
  get stacked diagnostics v_msg = message_text;
  if v_msg = p_message then return 'PASS: ' || p_what; end if;
  return 'FAIL: ' || p_what || ': ' || v_msg;
end $$;

-- Run some SQL and expect it to fail with this SQLSTATE.
create function pg_temp.refused_state(p_what text, p_sql text, p_state text) returns text language plpgsql as $$
declare v_state text; v_msg text;
begin
  execute p_sql;
  return 'FAIL: ' || p_what || ' was accepted';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  if v_state = p_state then return 'PASS: ' || p_what; end if;
  return 'FAIL: ' || p_what || ': ' || v_state || ' ' || v_msg;
end $$;

-- Run some SQL and expect this exact constraint to stop it.
create function pg_temp.refused_by(p_what text, p_sql text, p_constraint text) returns text language plpgsql as $$
declare v_con text; v_msg text;
begin
  execute p_sql;
  return 'FAIL: ' || p_what || ' was accepted';
exception when others then
  get stacked diagnostics v_con = constraint_name, v_msg = message_text;
  if v_con = p_constraint then return 'PASS: ' || p_what || ' (' || p_constraint || ')'; end if;
  return 'FAIL: ' || p_what || ': ' || v_msg || ' / constraint ' || coalesce(nullif(v_con, ''), 'none');
end $$;

-- Some signed-in users with no seat yet.
select gen_random_uuid() as u_hana, gen_random_uuid() as u_ivo, gen_random_uuid() as u_jo,
       gen_random_uuid() as u_kit, gen_random_uuid() as u_late, gen_random_uuid() as u_wes,
       gen_random_uuid() as u_zed \gset

-- ============================================================================
\echo '=== 1. What the browser can and cannot touch ==='
-- ============================================================================

select pg_temp.act(null) \gset
set role anon;

do $$
declare t text;
begin
  begin
    perform 1 from public.ttt_lines limit 1;
    raise notice 'PASS: signed out, the browser can read ttt_lines';
  exception when insufficient_privilege then raise notice 'FAIL: signed out, the browser cannot read ttt_lines';
  end;

  foreach t in array array['ttt_settings', 'ttt_boards', 'ttt_board_axes', 'ttt_games', 'ttt_moves',
                           'ttt_board_cells', 'ttt_move_checks', 'ttt_difficulty_bands', 'ttt_threshold_profiles',
                           'ttt_config', 'seat_owners'] loop
    begin
      execute format('select 1 from public.%I limit 1', t);
      raise notice 'FAIL: signed out, the browser read %', t;
    exception when insufficient_privilege then raise notice 'PASS: signed out, the browser cannot read %', t;
    end;
  end loop;
end $$;

-- Every Tic-Tac-Toe RPC needs a signed-in caller. join_session and
-- leave_session are shared with Football Imposter and stay open to anon;
-- they refuse a Tic-Tac-Toe lobby themselves (sections 5, 7 and 13).
do $$
declare f text;
begin
  foreach f in array array[
    'ttt_create_session(''Hana'')',
    'ttt_update_settings(gen_random_uuid(), ''easy'')',
    'ttt_start_game(gen_random_uuid())',
    'ttt_rematch(gen_random_uuid())',
    'ttt_submit_move(gen_random_uuid(), 0, gen_random_uuid())',
    'ttt_pass(gen_random_uuid())',
    'ttt_my_seat(gen_random_uuid())'
  ] loop
    begin
      execute 'select public.' || f;
      raise notice 'FAIL: signed out, the browser called %', split_part(f, '(', 1);
    exception when insufficient_privilege then raise notice 'PASS: signed out, % is refused', split_part(f, '(', 1);
    end;
  end loop;
end $$;

reset role;
set role authenticated;

do $$
declare t text;
begin
  foreach t in array array['ttt_lines', 'ttt_settings', 'ttt_boards', 'ttt_board_axes', 'ttt_games', 'ttt_moves'] loop
    begin
      execute format('select 1 from public.%I limit 1', t);
      raise notice 'PASS: signed in, the browser can query % (its policy decides which rows)', t;
    exception when insufficient_privilege then raise notice 'FAIL: signed in, the browser cannot query %', t;
    end;
  end loop;

  foreach t in array array['ttt_board_cells', 'ttt_move_checks', 'ttt_difficulty_bands', 'ttt_threshold_profiles',
                           'ttt_config', 'seat_owners'] loop
    begin
      execute format('select 1 from public.%I limit 1', t);
      raise notice 'FAIL: signed in, the browser read %', t;
    exception when insufficient_privilege then raise notice 'PASS: signed in, the browser still cannot read %', t;
    end;
  end loop;
end $$;

select pg_temp.refused_state('the browser writing a game row',
  'insert into public.ttt_games (session_id, board_number, board_id, x_name, o_name, starter_mark, turn_mark) values (gen_random_uuid(), 1, gen_random_uuid(), ''a'', ''b'', ''X'', ''X'')', '42501');
select pg_temp.refused_state('the browser writing a move',
  'insert into public.ttt_moves (game_id, session_id, move_number, mark, kind) values (gen_random_uuid(), gen_random_uuid(), 1, ''X'', ''pass'')', '42501');
select pg_temp.refused_state('the browser editing a game',
  'update public.ttt_games set turn_mark = ''X''', '42501');
select pg_temp.refused_state('the browser writing its own settings',
  'insert into public.ttt_settings (session_id, difficulty) values (gen_random_uuid(), ''easy'')', '42501');
select pg_temp.refused_state('the browser claiming a seat by writing an owner row',
  'insert into public.seat_owners (player_id, session_id, auth_user_id) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid())', '42501');

do $$
declare f text;
begin
  foreach f in array array[
    'ttt_build_board(''{}''::uuid[], ''{}''::uuid[], ''easy'', ''dev'')',
    'ttt_generate_board(''easy'', ''dev'')',
    'ttt_begin_board(gen_random_uuid())',
    'ttt_settle(gen_random_uuid(), ''X'')',
    'ttt_leave(gen_random_uuid(), gen_random_uuid())',
    'ttt_acting_seat(gen_random_uuid())',
    'ttt_cell_accepts(gen_random_uuid(), 0, gen_random_uuid())',
    'ttt_board_has_answers(gen_random_uuid(), ''{}''::smallint[], ''{}''::uuid[])',
    'ttt_board_meets(''{1}''::int[], ''easy'', ''dev'')'
  ] loop
    begin
      execute 'select public.' || f;
      raise notice 'FAIL: the browser called %', split_part(f, '(', 1);
    exception when insufficient_privilege then raise notice 'PASS: % is internal', split_part(f, '(', 1);
    end;
  end loop;
end $$;

reset role;

select case when to_regprocedure('public.ttt_submit_move(uuid, uuid, int, uuid)') is null
             and to_regprocedure('public.ttt_pass(uuid, uuid)') is null
             and to_regprocedure('public.ttt_start_game(uuid, uuid)') is null
             and to_regprocedure('public.ttt_rematch(uuid, uuid)') is null
             and to_regprocedure('public.ttt_update_settings(uuid, uuid, text)') is null
             and to_regprocedure('public.ttt_leave_in_play(uuid, uuid)') is null
             and not exists (
               select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname like 'ttt\_%'
                 and 'p_player_id' = any (p.proargnames)
                 and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')))
  then 'PASS: no Tic-Tac-Toe RPC the browser can call takes a player id to act for'
  else 'FAIL: a callable RPC still takes a player id' end;

select case when bool_and(not has_function_privilege('anon', f::regprocedure, 'execute')
                          and has_function_privilege('authenticated', f::regprocedure, 'execute'))
  then 'PASS: the Tic-Tac-Toe RPCs are granted to signed-in callers only'
  else 'FAIL: RPC grants' end
from unnest(array['public.ttt_create_session(text, text)', 'public.ttt_update_settings(uuid, text)',
                  'public.ttt_start_game(uuid)', 'public.ttt_rematch(uuid)', 'public.ttt_submit_move(uuid, int, uuid)',
                  'public.ttt_pass(uuid)', 'public.ttt_my_seat(uuid)']) f;

select case when (select bool_and(c.relrowsecurity) from pg_class c
                  where c.oid in ('public.sessions'::regclass, 'public.players'::regclass, 'public.seat_owners'::regclass)
                     or (c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'ttt\_%'))
             and not exists (
               select 1 from pg_policies
               where schemaname = 'public' and qual = 'true'
                 and tablename in ('sessions', 'players', 'seat_owners', 'ttt_settings', 'ttt_boards', 'ttt_board_axes',
                                   'ttt_games', 'ttt_moves', 'ttt_board_cells', 'ttt_move_checks'))
             and not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('seat_owners', 'ttt_board_cells', 'ttt_move_checks'))
             and (select bool_and(roles = '{authenticated}') from pg_policies
                  where schemaname = 'public' and tablename in ('ttt_settings', 'ttt_boards', 'ttt_board_axes', 'ttt_games', 'ttt_moves'))
             and (select count(*) from pg_policies
                  where schemaname = 'public' and tablename in ('ttt_settings', 'ttt_boards', 'ttt_board_axes', 'ttt_games', 'ttt_moves')) = 5
  then 'PASS: row level security is on everywhere, no gameplay or shared-table policy reads "true", and the gameplay policies are for signed-in users only'
  else 'FAIL: row level security audit' end;

select case when (select array_agg(tablename::text order by tablename) from pg_publication_tables
                  where pubname = 'supabase_realtime' and (tablename like 'ttt_%' or tablename = 'seat_owners'))
                 = array['ttt_games', 'ttt_moves', 'ttt_settings']
             and (select bool_and(relreplident = 'f') from pg_class
                  where oid in ('public.ttt_games'::regclass, 'public.ttt_moves'::regclass, 'public.ttt_settings'::regclass))
  then 'PASS: games, moves and settings go out over Realtime, with full row images; nothing private does'
  else 'FAIL: Realtime publication is wrong' end;

select case when (select count(*) from ttt_lines) = 8
  then 'PASS: eight winning lines' else 'FAIL: lines' end;

-- ============================================================================
\echo '=== 2. Difficulty ==='
-- ============================================================================

select case when (select string_agg(difficulty || ' ' || min_answers || '-' || coalesce(max_answers::text, ''), ', ' order by min_answers)
                  from ttt_difficulty_bands where profile = 'standard')
                 = 'extreme 1-1, hard 2-4, medium 5-10, easy 11-'
  then 'PASS: the standard profile is the proposal''s: 1 Extreme, 2-4 Hard, 5-10 Medium, 11+ Easy'
  else 'FAIL: standard bands' end;

select case when (select active_profile from ttt_config) = 'standard'
  then 'PASS: boards are made with the standard profile unless a database says otherwise'
  else 'FAIL: active profile' end;

select case when
      ttt_board_meets('{11,11,11,11,11,11,11,11,11}', 'easy', 'standard')
  and not ttt_board_meets('{11,11,11,11,10,11,11,11,11}', 'easy', 'standard')
  and ttt_board_meets('{11,11,11,11,10,11,11,11,11}', 'medium', 'standard')
  and not ttt_board_meets('{11,11,11,11,11,11,11,11,11}', 'medium', 'standard')
  and ttt_board_meets('{9,9,9,9,5,9,9,9,9}', 'medium', 'standard')
  and not ttt_board_meets('{9,9,9,9,4,9,9,9,9}', 'medium', 'standard')
  and ttt_board_meets('{9,9,9,9,4,9,9,9,9}', 'hard', 'standard')
  and ttt_board_meets('{2,3,4,5,6,7,8,9,10}', 'hard', 'standard')
  and not ttt_board_meets('{1,3,4,5,6,7,8,9,10}', 'hard', 'standard')
  and ttt_board_meets('{1,30,30,30,30,30,30,30,30}', 'extreme', 'standard')
  and not ttt_board_meets('{2,30,30,30,30,30,30,30,30}', 'extreme', 'standard')
  then 'PASS: a board is as hard as its hardest square, band by band'
  else 'FAIL: band arithmetic' end;

select case when not ttt_board_meets('{0,5,5,5,5,5,5,5,5}', 'extreme', 'dev')
             and not ttt_board_meets('{5,5,5,5,5,5,5,5}', 'easy', 'dev')
             and not ttt_board_meets('{5,5,5,5,null,5,5,5,5}', 'easy', 'dev')
             and ttt_board_meets('{1,1,1,1,1,1,1,1,1}', 'easy', 'dev')
  then 'PASS: an empty square, a short board or a missing size never qualifies; dev takes any real board'
  else 'FAIL: edge cases' end;

select pg_temp.refused_state('a band that does not exist', 'select ttt_board_meets(''{1,1,1,1,1,1,1,1,1}'', ''impossible'', ''standard'')', '22023');

-- ============================================================================
\echo '=== 3. Building a board ==='
-- ============================================================================

select pg_temp.board_a() as board \gset a_

select case when (select count(*) from ttt_board_axes where board_id = :'a_board' and axis = 'row') = 3
             and (select count(*) from ttt_board_axes where board_id = :'a_board' and axis = 'col') = 3
             and (select count(*) from ttt_board_cells where board_id = :'a_board') = 9
  then 'PASS: three rows, three columns, nine squares' else 'FAIL: board shape' end;

select case when (select array_agg(c.answer_count order by c.cell) from ttt_board_cells c where c.board_id = :'a_board')
                 = '{1,2,3,1,1,2,2,3,3}'
             and not exists (
               select 1 from ttt_board_cells c
               join ttt_board_axes r on r.board_id = c.board_id and r.axis = 'row' and r.position = c.cell / 3
               join ttt_board_axes k on k.board_id = c.board_id and k.axis = 'col' and k.position = c.cell % 3
               where c.board_id = :'a_board' and c.answer_count <> football_intersection_size(r.category_id, k.category_id))
  then 'PASS: every square''s size is the real number of footballers who fit it'
  else 'FAIL: square sizes' end;

select case when (select string_agg(category_type || ':' || label, ' | ' order by axis desc, position)
                  from ttt_board_axes where board_id = :'a_board')
                 = 'CLUB:Harbour City FC | CLUB:Port Aldry | CLUB:Redmoor United | CLUB:Ironside FC | NATIONALITY:Veloria | TROPHY:Veloria Premier Division'
  then 'PASS: the board keeps a snapshot of each criterion''s type and label'
  else 'FAIL: axis snapshots' end;

select pg_temp.refused_with('the same criterion as a row and a column',
  format('select ttt_build_board(array[%L, %L, %L]::uuid[], array[%L, %L, %L]::uuid[], ''medium'', ''dev'')',
         pg_temp.cat('CLUB', 'Harbour City FC'), pg_temp.cat('CLUB', 'Port Aldry'), pg_temp.cat('CLUB', 'Redmoor United'),
         pg_temp.cat('CLUB', 'Harbour City FC'), pg_temp.cat('NATIONALITY', 'Veloria'), pg_temp.cat('TROPHY', 'Veloria Premier Division')),
  'A criterion can appear only once on a board');

select pg_temp.refused_with('two rows and three columns',
  format('select ttt_build_board(array[%L, %L]::uuid[], array[%L, %L, %L]::uuid[], ''medium'', ''dev'')',
         pg_temp.cat('CLUB', 'Harbour City FC'), pg_temp.cat('CLUB', 'Port Aldry'),
         pg_temp.cat('CLUB', 'Ironside FC'), pg_temp.cat('NATIONALITY', 'Veloria'), pg_temp.cat('TROPHY', 'Veloria Premier Division')),
  'A board has three rows and three columns');

select pg_temp.refused_with('a trophy whose winners are not verified',
  format('select ttt_build_board(array[%L, %L, %L]::uuid[], array[%L, %L, %L]::uuid[], ''medium'', ''dev'')',
         pg_temp.cat('CLUB', 'Harbour City FC'), pg_temp.cat('CLUB', 'Port Aldry'), pg_temp.cat('TROPHY', 'Dunmere Super Cup'),
         pg_temp.cat('CLUB', 'Ironside FC'), pg_temp.cat('NATIONALITY', 'Veloria'), pg_temp.cat('TROPHY', 'Veloria Premier Division')),
  'Every criterion on a board has to exist and be switched on');

select pg_temp.refused_with('a square nobody fits (two nationalities meet)',
  format('select ttt_build_board(array[%L, %L, %L]::uuid[], array[%L, %L, %L]::uuid[], ''medium'', ''dev'')',
         pg_temp.cat('CLUB', 'Harbour City FC'), pg_temp.cat('CLUB', 'Port Aldry'), pg_temp.cat('NATIONALITY', 'Carvania'),
         pg_temp.cat('CLUB', 'Ironside FC'), pg_temp.cat('NATIONALITY', 'Veloria'), pg_temp.cat('TROPHY', 'Veloria Premier Division')),
  'Every square needs at least one footballer who fits it');

select pg_temp.refused_with('a board that is not the difficulty it claims',
  format('select ttt_build_board(array[%L, %L, %L]::uuid[], array[%L, %L, %L]::uuid[], ''easy'', ''standard'')',
         pg_temp.cat('CLUB', 'Harbour City FC'), pg_temp.cat('CLUB', 'Port Aldry'), pg_temp.cat('CLUB', 'Redmoor United'),
         pg_temp.cat('CLUB', 'Ironside FC'), pg_temp.cat('NATIONALITY', 'Veloria'), pg_temp.cat('TROPHY', 'Veloria Premier Division')),
  'That board is not easy in the standard profile');

-- The schema itself, not just the builder.
select pg_temp.refused_by('a second row at the same position',
  format('insert into ttt_board_axes values (%L, ''row'', 0, %L, ''CLUB'', ''x'', null)', :'a_board', pg_temp.cat('CLUB', 'Vale Albion')), 'ttt_board_axes_pkey');
select pg_temp.refused_by('the schema refusing one criterion as a row and a column',
  format('with b as (insert into ttt_boards (difficulty, threshold_profile) values (''easy'', ''dev'') returning id) '
         'insert into ttt_board_axes select b.id, a.axis, 0, %L, ''CLUB'', ''x'', null from b, (values (''row''), (''col'')) a(axis)',
         pg_temp.cat('CLUB', 'Vale Albion')), 'ttt_board_axes_distinct');
select pg_temp.refused_by('a fourth row',
  format('insert into ttt_board_axes values (%L, ''row'', 3, %L, ''CLUB'', ''x'', null)', :'a_board', pg_temp.cat('CLUB', 'Vale Albion')), 'ttt_board_axes_position_range');
select pg_temp.refused_by('a snapshot that lies about the criterion''s type',
  format('with b as (insert into ttt_boards (difficulty, threshold_profile) values (''easy'', ''dev'') returning id) '
         'insert into ttt_board_axes select b.id, ''row'', 0, %L, ''TROPHY'', ''x'', null from b',
         pg_temp.cat('CLUB', 'Vale Albion')), 'ttt_board_axes_category_fk');
select pg_temp.refused_by('a square with nobody who fits it',
  format('insert into ttt_board_cells values (%L, 4, 0)', gen_random_uuid()), 'ttt_board_cells_answerable');
select pg_temp.refused_state('changing a row', format('update ttt_board_axes set label = ''x'' where board_id = %L', :'a_board'), '23001');
select pg_temp.refused_state('changing a square''s size', format('update ttt_board_cells set answer_count = 99 where board_id = %L', :'a_board'), '23001');
select pg_temp.refused_state('changing a board''s difficulty', format('update ttt_boards set difficulty = ''easy'' where id = %L', :'a_board'), '23001');
select pg_temp.refused_state('taking a row off a board', format('delete from ttt_board_axes where board_id = %L and axis = ''row'' and position = 0', :'a_board'), '23001');
select pg_temp.refused_state('changing a winning line', 'update ttt_lines set cells = ''{0,1,3}'' where line = 0', '23001');

do $$
begin
  insert into ttt_boards (difficulty, threshold_profile) values ('easy', 'dev');
  set constraints ttt_boards_complete immediate;
  raise notice 'FAIL: a board with no rows, columns or squares was saved';
exception when check_violation then
  raise notice 'PASS: a board without its rows, columns and squares cannot be committed';
end $$;

delete from ttt_boards where id = :'a_board';
select case when not exists (select 1 from ttt_board_axes where board_id = :'a_board')
             and not exists (select 1 from ttt_board_cells where board_id = :'a_board')
  then 'PASS: deleting a board takes its rows, columns and squares with it'
  else 'FAIL: board parts left behind' end;

-- ============================================================================
\echo '=== 4. Generating boards ==='
-- ============================================================================

select pg_temp.refused('an easy board from the fixture, standard profile',  'select ttt_generate_board(''easy'')',   'ttt_no_board_found');
select pg_temp.refused('a medium board from the fixture, standard profile', 'select ttt_generate_board(''medium'')', 'ttt_no_board_found');
select pg_temp.refused('a hard board from the fixture, standard profile',   'select ttt_generate_board(''hard'')',   'ttt_no_board_found');

select ttt_generate_board('extreme') as board \gset x_
select case when (select min(answer_count) from ttt_board_cells where board_id = :'x_board') = 1
             and (select difficulty || '/' || threshold_profile from ttt_boards where id = :'x_board') = 'extreme/standard'
  then 'PASS: every fixture board has a one-answer square, so standard can only make it Extreme'
  else 'FAIL: extreme board' end;

update ttt_config set active_profile = 'dev';

create temp table generated (board_id uuid);
insert into generated
select ttt_generate_board(d) from unnest(array['easy', 'medium', 'hard', 'extreme']) d cross join generate_series(1, 10);

select case when count(*) = 40
             and bool_and(axes.n = 6 and axes.distinct_n = 6 and axes.rows = 3 and axes.all_active)
  then 'PASS: 40 generated boards, each with six different switched-on criteria'
  else 'FAIL: generated board shape' end
from generated g
cross join lateral (
  select count(*) as n, count(distinct a.category_id) as distinct_n, count(*) filter (where a.axis = 'row') as rows,
         bool_and(fc.active) as all_active
  from ttt_board_axes a join football_categories fc on fc.id = a.category_id
  where a.board_id = g.board_id) axes;

select case when not exists (
    select 1 from generated g
    join ttt_board_cells c on c.board_id = g.board_id
    join ttt_board_axes r on r.board_id = c.board_id and r.axis = 'row' and r.position = c.cell / 3
    join ttt_board_axes k on k.board_id = c.board_id and k.axis = 'col' and k.position = c.cell % 3
    where c.answer_count < 1 or c.answer_count <> football_intersection_size(r.category_id, k.category_id))
  and (select count(*) from generated g join ttt_board_cells c on c.board_id = g.board_id) = 360
  then 'PASS: every square of every generated board has someone who fits it, counted correctly'
  else 'FAIL: generated squares' end;

select case when count(distinct combo) >= 20
  then 'PASS: generation varies (' || count(distinct combo) || ' different boards out of 40)'
  else 'FAIL: only ' || count(distinct combo) || ' different boards' end
from (select g.board_id, string_agg(a.category_id::text, ',' order by a.axis, a.position) as combo
      from generated g join ttt_board_axes a on a.board_id = g.board_id group by g.board_id) s;

select case when not exists (
    select 1 from generated g join ttt_board_axes a on a.board_id = g.board_id
    where a.label = 'Dunmere Super Cup')
  then 'PASS: the unverified trophy never appears on a board'
  else 'FAIL: an unverified trophy was used' end;

begin;
update football_categories set active = false where type = 'CLUB' and label = 'Harbour City FC';
create temp table generated_without (board_id uuid) on commit drop;
insert into generated_without select ttt_generate_board('medium') from generate_series(1, 30);
select case when not exists (
    select 1 from generated_without g join ttt_board_axes a on a.board_id = g.board_id
    where a.label = 'Harbour City FC')
  then 'PASS: a club that is switched off never appears on a generated board'
  else 'FAIL: a switched-off club was used' end;
rollback;

delete from ttt_boards b where not exists (select 1 from ttt_games g where g.board_id = b.id);

-- ============================================================================
\echo '=== 5. Lobbies and seats ==='
-- ============================================================================

set role authenticated;
select pg_temp.act(null) \gset
select pg_temp.refused('creating a lobby with the signed-in role but no user', 'select ttt_create_session(''Hana'')', 'ttt_no_auth');
select pg_temp.act(:'u_hana') \gset
select * from ttt_create_session('Hana') \gset l_
reset role;

select case when s.game_mode = 'tic_tac_toe' and s.status = 'waiting' and s.host_player_id = :'l_player_id'
             and (select difficulty from ttt_settings where session_id = s.id) = 'medium'
             and not exists (select 1 from player_secrets where player_id = :'l_player_id')
  then 'PASS: ttt_create_session makes a Tic-Tac-Toe lobby with its host and default settings, and no hidden role'
  else 'FAIL: lobby shape' end
from sessions s where s.id = :'l_session_id';

select case when (select string_agg(o.player_id || '/' || o.auth_user_id, ',') from seat_owners o where o.session_id = :'l_session_id')
                 = :'l_player_id' || '/' || :'u_hana'
  then 'PASS: the host''s seat belongs to the user who made the lobby'
  else 'FAIL: host seat owner' end;

set role authenticated;
select pg_temp.act(:'u_jo') \gset
select session_id as hard_session, code as hard_code from ttt_create_session(p_display_name => 'Jo', p_difficulty => 'hard') \gset
select pg_temp.refused_with('an unknown difficulty', 'select ttt_create_session(''Kit'', ''legendary'')', 'Pick a difficulty: easy, medium, hard or extreme');
select pg_temp.refused_with('a blank name', 'select ttt_create_session(''   '')', 'Enter a display name');
select pg_temp.refused_with('a host name over 20 characters', 'select ttt_create_session(''abcdefghijklmnopqrstu'')', 'Display name must be 20 characters or fewer');
select pg_temp.refused('Jo taking the second seat in her own lobby as well',
  format('select join_session(%L, ''Jo again'', ''tic_tac_toe'')', :'hard_code'), 'ttt_already_seated');
reset role;
select case when (select difficulty from ttt_settings where session_id = :'hard_session') = 'hard'
             and (select count(*) from players where session_id = :'hard_session') = 1
  then 'PASS: the host can choose the difficulty up front, and still holds just the one seat'
  else 'FAIL: hard lobby' end;

-- Joining.
select pg_temp.act(null) \gset
set role anon;
select pg_temp.refused('joining a Tic-Tac-Toe lobby signed out',
  format('select join_session(%L, ''Ivo'', ''tic_tac_toe'')', :'l_code'), 'ttt_no_auth');
reset role;
set role authenticated;
select pg_temp.act(null) \gset
select pg_temp.refused('joining with the signed-in role but no user',
  format('select join_session(%L, ''Ivo'', ''tic_tac_toe'')', :'l_code'), 'ttt_no_auth');
select pg_temp.act(:'u_ivo') \gset
select player_id as guest from join_session(:'l_code', 'Ivo', 'tic_tac_toe') \gset l_
select pg_temp.refused('Ivo joining the same lobby a second time',
  format('select join_session(%L, ''Ivo 2'', ''tic_tac_toe'')', :'l_code'), 'ttt_already_seated');
reset role;

select case when (select string_agg(p.display_name || '=' || (o.auth_user_id = case p.is_host when true then :'u_hana'::uuid else :'u_ivo'::uuid end)::text, ',' order by p.is_host desc)
                  from players p join seat_owners o on o.player_id = p.id where p.session_id = :'l_session_id')
                 = 'Hana=true,Ivo=true'
             and (select count(*) from players where session_id = :'l_session_id') = 2
  then 'PASS: each seat belongs to the user who took it, and none of the refused joins left a seat'
  else 'FAIL: seats after joining' end;

-- Settings and starting.
set role authenticated;
select pg_temp.act(:'u_hana') \gset
select ttt_update_settings(:'l_session_id', 'easy');
select pg_temp.refused_with('an unknown difficulty in the lobby',
  format('select ttt_update_settings(%L, ''legendary'')', :'l_session_id'), 'Pick a difficulty: easy, medium, hard or extreme');
select * from create_session(p_display_name => 'Nia') \gset imp_
select pg_temp.refused('Tic-Tac-Toe settings on a Football Imposter lobby',
  format('select ttt_update_settings(%L, ''easy'')', :'imp_session_id'), 'ttt_wrong_game');
select pg_temp.refused('starting a Football Imposter lobby as Tic-Tac-Toe',
  format('select ttt_start_game(%L)', :'imp_session_id'), 'ttt_wrong_game');
select pg_temp.act(:'u_ivo') \gset
select pg_temp.refused_with('the guest changing the settings',
  format('select ttt_update_settings(%L, ''hard'')', :'l_session_id'), 'Only the host can change the settings');
select pg_temp.refused_with('the guest starting the game',
  format('select ttt_start_game(%L)', :'l_session_id'), 'Only the host can start the game');
select pg_temp.act(:'u_kit') \gset
select pg_temp.refused('someone with no seat changing the settings',
  format('select ttt_update_settings(%L, ''hard'')', :'l_session_id'), 'ttt_not_in_game');
select pg_temp.refused('someone with no seat starting the game',
  format('select ttt_start_game(%L)', :'l_session_id'), 'ttt_not_in_game');
reset role;

select case when (select game_mode from sessions where id = :'imp_session_id') = 'imposter'
             and (select difficulty from ttt_settings where session_id = :'l_session_id') = 'easy'
             and not exists (select 1 from seat_owners where session_id = :'imp_session_id')
  then 'PASS: settings saved; a signed-in create_session still makes a Football Imposter lobby, with no seat owner'
  else 'FAIL: settings' end;

set role authenticated;
select pg_temp.act(:'u_jo') \gset
select pg_temp.refused('starting with one player', format('select ttt_start_game(%L)', :'hard_session'), 'ttt_need_two_players');
select pg_temp.act(:'u_hana') \gset
select ttt_start_game(:'l_session_id');
reset role;

select case when g.board_number = 1 and g.status = 'playing' and g.starter_mark = 'X' and g.turn_mark = 'X'
             and array[g.x_player_id, g.o_player_id] @> array[:'l_player_id'::uuid, :'l_guest'::uuid]
             and array[g.x_name, g.o_name] @> array['Hana', 'Ivo']
             and (select difficulty || '/' || threshold_profile from ttt_boards where id = g.board_id) = 'easy/dev'
             and (select status from sessions where id = :'l_session_id') = 'playing'
  then 'PASS: the host starts board 1 at the lobby''s difficulty; X goes first'
  else 'FAIL: start' end
from ttt_games g where g.session_id = :'l_session_id';

set role authenticated;
select pg_temp.act(:'u_late') \gset
select pg_temp.refused_with('joining once the game has started',
  format('select join_session(%L, ''Late'', ''tic_tac_toe'')', :'l_code'), 'That game has already started');
select pg_temp.act(:'u_hana') \gset
select pg_temp.refused('changing the difficulty while a board is in play',
  format('select ttt_update_settings(%L, ''hard'')', :'l_session_id'), 'ttt_board_in_play');
select pg_temp.refused_with('starting it twice',
  format('select ttt_start_game(%L)', :'l_session_id'), 'The game has already started');
reset role;

select case when (select difficulty from ttt_settings where session_id = :'l_session_id') = 'easy'
  then 'PASS: the refused change left the difficulty alone' else 'FAIL: difficulty changed mid-board' end;

-- ============================================================================
\echo '=== 6. Moves ==='
-- ============================================================================

select * from pg_temp.lobby('Ana', 'Ben') \gset m_
select pg_temp.deal(:'m_sid', pg_temp.board_a(), :'m_host', :'m_opp') as game \gset m_
select * from pg_temp.lobby('Stranger', 'Other') \gset z_

set role authenticated;

select pg_temp.act(:'m_opp_uid') \gset
select pg_temp.refused('O moving on X''s turn',
  format('select * from ttt_submit_move(%L, 4, %L)', :'m_sid', pg_temp.fid('Owen Marrick')), 'ttt_not_your_turn');
select case when pg_temp.moves(:'m_sid') = 0 then 'PASS: and nothing was recorded' else 'FAIL: a refused move was recorded' end;

select pg_temp.act(:'m_host_uid') \gset
select case when (select outcome || ' ' || game_status from ttt_submit_move(:'m_sid', 4, pg_temp.fid('Owen Marrick'))) = 'claimed playing'
             and pg_temp.grid(:'m_sid') = '....X....' and pg_temp.state(:'m_sid') = 'playing turn O'
  then 'PASS: a footballer who fits both criteria claims the square, and the turn passes'
  else 'FAIL: valid claim: ' || pg_temp.grid(:'m_sid') || ' ' || pg_temp.state(:'m_sid') end;

select pg_temp.act(:'m_opp_uid') \gset
select pg_temp.refused('O naming someone for the square X has',
  format('select * from ttt_submit_move(%L, 4, %L)', :'m_sid', pg_temp.fid('Stefan Dravek')), 'ttt_square_taken');

select pg_temp.refused('O naming Owen Marrick again, on a square he fits',
  format('select * from ttt_submit_move(%L, 7, %L)', :'m_sid', pg_temp.fid('Owen Marrick')), 'ttt_footballer_used');
select case when pg_temp.moves(:'m_sid') = 1 and pg_temp.state(:'m_sid') = 'playing turn O'
  then 'PASS: neither refusal used up O''s turn' else 'FAIL: a refusal cost a turn' end;

select outcome as o_wrong from ttt_submit_move(:'m_sid', 0, pg_temp.fid('Arlo Venn')) \gset
select case when :'o_wrong' = 'wrong' and pg_temp.grid(:'m_sid') = '....X....' and pg_temp.state(:'m_sid') = 'playing turn X'
  then 'PASS: a footballer who fits only the row is wrong: no square, and the turn passes'
  else 'FAIL: wrong answer' end;

select case when (select string_agg(column_name::text, ',' order by ordinal_position) from information_schema.columns
                  where table_schema = 'public' and table_name = 'ttt_moves' and column_name like '%ok%') is null
             and pg_get_function_result('public.ttt_submit_move(uuid, int, uuid)'::regprocedure)
                 = 'TABLE(outcome text, game_status text, end_reason text, winner_mark text)'
  then 'PASS: the player hears only that it was wrong, never which half failed'
  else 'FAIL: the reason for a wrong answer is exposed' end;

select pg_temp.refused_state('the browser reading why it was wrong', 'select * from public.ttt_move_checks', '42501');

select pg_temp.act(:'m_host_uid') \gset
select outcome as x_wrong from ttt_submit_move(:'m_sid', 1, pg_temp.fid('Bram Olvedo')) \gset
select pg_temp.act(:'m_opp_uid') \gset
select case when (select outcome from ttt_submit_move(:'m_sid', 1, pg_temp.fid('Arlo Venn'))) = 'claimed'
  then 'PASS: a wrong guess does not use a footballer up: Arlo Venn claims square 1 after missing square 0'
  else 'FAIL: a wrong guess burned the footballer' end;

select pg_temp.act(:'m_host_uid') \gset
select pg_temp.refused('a footballer who is not in the database',
  format('select * from ttt_submit_move(%L, 0, %L)', :'m_sid', gen_random_uuid()), 'ttt_unknown_footballer');
select pg_temp.refused('no footballer at all',
  format('select * from ttt_submit_move(%L, 0, null)', :'m_sid'), 'ttt_unknown_footballer');
select pg_temp.refused('square 9', format('select * from ttt_submit_move(%L, 9, %L)', :'m_sid', pg_temp.fid('Pavel Orskin')), 'ttt_bad_square');
select pg_temp.refused('square -1', format('select * from ttt_submit_move(%L, -1, %L)', :'m_sid', pg_temp.fid('Pavel Orskin')), 'ttt_bad_square');
select pg_temp.refused('no square', format('select * from ttt_submit_move(%L, null, %L)', :'m_sid', pg_temp.fid('Pavel Orskin')), 'ttt_bad_square');
select pg_temp.refused('a lobby that does not exist',
  format('select * from ttt_submit_move(%L, 0, %L)', gen_random_uuid(), pg_temp.fid('Pavel Orskin')), 'ttt_no_game');
select pg_temp.refused('a move in a Football Imposter lobby',
  format('select * from ttt_submit_move(%L, 0, %L)', :'imp_session_id', pg_temp.fid('Pavel Orskin')), 'ttt_wrong_game');

select pg_temp.act(:'z_host_uid') \gset
select pg_temp.refused('a player seated in another lobby',
  format('select * from ttt_submit_move(%L, 0, %L)', :'m_sid', pg_temp.fid('Pavel Orskin')), 'ttt_not_in_game');
select pg_temp.act(null) \gset
select pg_temp.refused('the signed-in role with no user',
  format('select * from ttt_submit_move(%L, 0, %L)', :'m_sid', pg_temp.fid('Pavel Orskin')), 'ttt_no_auth');

select pg_temp.act(:'m_host_uid') \gset
select ttt_pass(:'m_sid');
select case when pg_temp.state(:'m_sid') = 'playing turn O' then 'PASS: a pass hands the turn over' else 'FAIL: pass' end;
select pg_temp.refused('passing on the other player''s turn', format('select ttt_pass(%L)', :'m_sid'), 'ttt_not_your_turn');
select pg_temp.act(:'z_opp_uid') \gset
select pg_temp.refused('passing from another lobby', format('select ttt_pass(%L)', :'m_sid'), 'ttt_not_in_game');
select pg_temp.act(null) \gset
select pg_temp.refused('passing with no user', format('select ttt_pass(%L)', :'m_sid'), 'ttt_no_auth');

select pg_temp.act(:'m_host_uid') \gset
select case when (select string_agg(move_number || mark || left(kind, 1) || coalesce(cell::text, '-'), ' ' order by move_number)
                  from ttt_moves where session_id = :'m_sid') = '1Xc4 2Ow0 3Xw1 4Oc1 5Xp-'
  then 'PASS: the history is every used turn, in order: claims, wrong answers and passes'
  else 'FAIL: history ' || (select string_agg(move_number || mark || left(kind, 1) || coalesce(cell::text, '-'), ' ' order by move_number) from ttt_moves where session_id = :'m_sid') end;

reset role;

select case when (select string_agg(m.cell || ':' || c.row_ok || '/' || c.col_ok, ' ' order by m.move_number)
                  from ttt_move_checks c join ttt_moves m on m.id = c.move_id where m.session_id = :'m_sid')
                 = '0:true/false 1:false/false'
  then 'PASS: server-side, each wrong answer records which halves it missed'
  else 'FAIL: diagnostics' end;

select case when not exists (
    select 1 from ttt_moves m
    where m.session_id = :'m_sid'
      and m.player_id is distinct from case m.mark when 'X' then :'m_host'::uuid else :'m_opp'::uuid end)
  then 'PASS: every move is recorded against the seat of the user who made it'
  else 'FAIL: a move was recorded against the wrong seat' end;

-- ============================================================================
\echo '=== 7. Nobody can act for anyone else ==='
-- Bea hosts; Adam is her opponent. None of the Tic-Tac-Toe RPCs take a
-- player id, so there is nowhere to put someone else's: each call acts for
-- the caller's own seat or not at all. leave_session still takes one, for
-- Football Imposter, and refuses any Tic-Tac-Toe seat but the caller's.
-- Every id in the lobby is visible to both players, so Adam knows Bea's.
-- ============================================================================

select * from pg_temp.lobby('Bea', 'Adam') \gset ab_

set role authenticated;
select pg_temp.act(:'ab_opp_uid') \gset
select pg_temp.refused('Adam changing Bea''s settings in the lobby',
  format('select ttt_update_settings(%L, ''extreme'')', :'ab_sid'), 'ttt_not_host');
select pg_temp.refused('Adam starting Bea''s game',
  format('select ttt_start_game(%L)', :'ab_sid'), 'ttt_not_host');
select pg_temp.refused('Adam leaving Bea''s seat in the lobby (which would close it)',
  format('select leave_session(%L, %L)', :'ab_sid', :'ab_host'), 'ttt_not_your_seat');
reset role;

select case when (select status from sessions where id = :'ab_sid') = 'waiting'
             and (select count(*) from players where session_id = :'ab_sid') = 2
             and (select difficulty from ttt_settings where session_id = :'ab_sid') = 'medium'
  then 'PASS: in the lobby, none of that changed anything'
  else 'FAIL: the lobby changed' end;

-- Bea is X, and it is her turn.
select pg_temp.deal(:'ab_sid', pg_temp.board_a(), :'ab_host', :'ab_opp') as game \gset ab_

set role authenticated;
select pg_temp.act(:'ab_opp_uid') \gset
select pg_temp.refused('Adam claiming a square on Bea''s turn',
  format('select * from ttt_submit_move(%L, 4, %L)', :'ab_sid', pg_temp.fid('Owen Marrick')), 'ttt_not_your_turn');
select pg_temp.refused('Adam passing on Bea''s turn',
  format('select ttt_pass(%L)', :'ab_sid'), 'ttt_not_your_turn');
select pg_temp.refused('Adam changing the settings mid-board',
  format('select ttt_update_settings(%L, ''easy'')', :'ab_sid'), 'ttt_not_host');
select pg_temp.refused('Adam calling a rematch mid-board',
  format('select ttt_rematch(%L)', :'ab_sid'), 'ttt_not_host');
select pg_temp.refused('Adam starting the game',
  format('select ttt_start_game(%L)', :'ab_sid'), 'ttt_not_host');
select pg_temp.refused('Adam leaving Bea''s seat mid-board (which would forfeit her board)',
  format('select leave_session(%L, %L)', :'ab_sid', :'ab_host'), 'ttt_not_your_seat');
reset role;

select case when pg_temp.moves(:'ab_sid') = 0 and pg_temp.state(:'ab_sid') = 'playing turn X'
             and (select count(*) from players where session_id = :'ab_sid' and is_active) = 2
             and (select status from sessions where id = :'ab_sid') = 'playing'
             and (select difficulty from ttt_settings where session_id = :'ab_sid') = 'medium'
  then 'PASS: mid-board, nothing Adam tried used Bea''s turn, her seat or her host rights'
  else 'FAIL: Adam changed something: ' || pg_temp.state(:'ab_sid') end;

select pg_temp.run(:'ab_sid', :'ab_host_uid', :'ab_opp_uid', array['X 4 Owen Marrick', 'O 1 Idris Kallow']);
select case when (select string_agg(mark || cell || ':' || (player_id = case mark when 'X' then :'ab_host'::uuid else :'ab_opp'::uuid end)::text, ' ' order by move_number)
                  from ttt_moves where session_id = :'ab_sid') = 'X4:true O1:true'
  then 'PASS: on his own turn, Adam''s move goes down as his own mark and seat'
  else 'FAIL: moves recorded against the wrong seat' end;

-- Someone seated in another lobby, who knows every id in this one; the
-- signed-in role with no user; and anon.
set role authenticated;
select pg_temp.act(:'z_host_uid') \gset
select pg_temp.refused('an outsider claiming a square',   format('select * from ttt_submit_move(%L, 0, %L)', :'ab_sid', pg_temp.fid('Pavel Orskin')), 'ttt_not_in_game');
select pg_temp.refused('an outsider passing',             format('select ttt_pass(%L)', :'ab_sid'), 'ttt_not_in_game');
select pg_temp.refused('an outsider changing settings',   format('select ttt_update_settings(%L, ''easy'')', :'ab_sid'), 'ttt_not_in_game');
select pg_temp.refused('an outsider starting',            format('select ttt_start_game(%L)', :'ab_sid'), 'ttt_not_in_game');
select pg_temp.refused('an outsider calling a rematch',   format('select ttt_rematch(%L)', :'ab_sid'), 'ttt_not_in_game');
select pg_temp.refused('an outsider leaving Bea''s seat', format('select leave_session(%L, %L)', :'ab_sid', :'ab_host'), 'ttt_not_your_seat');
select pg_temp.refused('an outsider leaving Adam''s seat', format('select leave_session(%L, %L)', :'ab_sid', :'ab_opp'), 'ttt_not_your_seat');

select pg_temp.act(null) \gset
select pg_temp.refused('no user claiming a square',   format('select * from ttt_submit_move(%L, 0, %L)', :'ab_sid', pg_temp.fid('Pavel Orskin')), 'ttt_no_auth');
select pg_temp.refused('no user passing',             format('select ttt_pass(%L)', :'ab_sid'), 'ttt_no_auth');
select pg_temp.refused('no user changing settings',   format('select ttt_update_settings(%L, ''easy'')', :'ab_sid'), 'ttt_no_auth');
select pg_temp.refused('no user starting',            format('select ttt_start_game(%L)', :'ab_sid'), 'ttt_no_auth');
select pg_temp.refused('no user calling a rematch',   format('select ttt_rematch(%L)', :'ab_sid'), 'ttt_no_auth');
select pg_temp.refused('no user leaving Bea''s seat', format('select leave_session(%L, %L)', :'ab_sid', :'ab_host'), 'ttt_not_your_seat');

-- Bea herself, in a lobby she holds no seat in.
select pg_temp.act(:'ab_host_uid') \gset
select pg_temp.refused('Bea changing the settings of a lobby she is not in', format('select ttt_update_settings(%L, ''easy'')', :'z_sid'), 'ttt_not_in_game');
select pg_temp.refused('Bea starting a lobby she is not in',                 format('select ttt_start_game(%L)', :'z_sid'), 'ttt_not_in_game');
select pg_temp.refused('Bea leaving a seat in a lobby she is not in',        format('select leave_session(%L, %L)', :'z_sid', :'z_host'), 'ttt_not_your_seat');
reset role;

select pg_temp.act(null) \gset
set role anon;
select pg_temp.refused_state('anon claiming a square',   format('select * from ttt_submit_move(%L, 0, %L)', :'ab_sid', pg_temp.fid('Pavel Orskin')), '42501');
select pg_temp.refused_state('anon passing',             format('select ttt_pass(%L)', :'ab_sid'), '42501');
select pg_temp.refused_state('anon changing settings',   format('select ttt_update_settings(%L, ''easy'')', :'ab_sid'), '42501');
select pg_temp.refused_state('anon starting',            format('select ttt_start_game(%L)', :'ab_sid'), '42501');
select pg_temp.refused_state('anon calling a rematch',   format('select ttt_rematch(%L)', :'ab_sid'), '42501');
select pg_temp.refused('anon leaving Bea''s seat',       format('select leave_session(%L, %L)', :'ab_sid', :'ab_host'), 'ttt_not_your_seat');
reset role;

select case when pg_temp.moves(:'ab_sid') = 2 and pg_temp.state(:'ab_sid') = 'playing turn X'
             and (select count(*) from players where session_id = :'ab_sid' and is_active) = 2
             and (select difficulty from ttt_settings where session_id = :'ab_sid') = 'medium'
             and (select status from sessions where id = :'z_sid') = 'waiting'
             and (select count(*) from players where session_id = :'z_sid') = 2
  then 'PASS: none of the outsiders changed either lobby'
  else 'FAIL: an outsider changed something' end;

-- Between boards.
select pg_temp.run(:'ab_sid', :'ab_host_uid', :'ab_opp_uid', array['X 0 Pavel Orskin', 'O pass', 'X 8 Tomas Quell']);
set role authenticated;
select pg_temp.act(:'ab_opp_uid') \gset
select pg_temp.refused('Adam calling the rematch between boards',
  format('select ttt_rematch(%L)', :'ab_sid'), 'ttt_not_host');
select pg_temp.refused('Adam changing the settings between boards',
  format('select ttt_update_settings(%L, ''easy'')', :'ab_sid'), 'ttt_not_host');
select pg_temp.refused('Adam leaving Bea''s seat between boards (which would close the lobby)',
  format('select leave_session(%L, %L)', :'ab_sid', :'ab_host'), 'ttt_not_your_seat');
reset role;

select case when pg_temp.state(:'ab_sid') = 'won by X on line 6 (line)'
             and (select status from sessions where id = :'ab_sid') = 'playing'
             and (select count(*) from players where session_id = :'ab_sid') = 2
             and (select count(*) from ttt_games where session_id = :'ab_sid') = 1
             and (select difficulty from ttt_settings where session_id = :'ab_sid') = 'medium'
  then 'PASS: between boards, Adam could not start the next one, change it, or close the lobby'
  else 'FAIL: between boards' end;

-- ============================================================================
\echo '=== 8. Who can read a lobby ==='
-- A phone that reloads has nothing but what it can read: that has to be the
-- whole board from a seat, and nothing at all from anywhere else. Realtime
-- sends a change to a subscriber only if that subscriber could read the row
-- under these same policies, so these checks are also what decides who hears
-- about a change. That is checked here at the SQL level only; delivery over
-- a real Realtime connection belongs to the local Supabase gate.
-- ============================================================================

select board_id as m_board from ttt_games where session_id = :'m_sid' and status = 'playing' \gset

set role authenticated;
select pg_temp.act(:'m_host_uid') \gset
select case when (
    select pg_temp.grid(:'m_sid') || ' ' || g.turn_mark || ' X=' || g.x_name || ' O=' || g.o_name
           || ' ' || (select string_agg(m.cell || m.footballer_name, ',' order by m.cell) from ttt_moves m
                       where m.game_id = g.id and m.kind = 'claim')
           || ' ' || (select string_agg(left(a.axis, 1) || a.position || '=' || a.label, ',' order by a.axis desc, a.position)
                       from ttt_board_axes a where a.board_id = g.board_id)
    from ttt_games g where g.session_id = :'m_sid' and g.status = 'playing')
  = '.O..X.... O X=Ana O=Ben 1Arlo Venn,4Owen Marrick r0=Harbour City FC,r1=Port Aldry,r2=Redmoor United,c0=Ironside FC,c1=Veloria,c2=Veloria Premier Division'
  then 'PASS: from a seat, squares, marks, names, whose turn and the criteria all come back from the readable tables'
  else 'FAIL: refetch' end;

select case when pg_temp.sees(:'m_sid', :'m_board') = 'sessions 1, players 2, settings 1, games 1, moves 5, boards 1, axes 6'
  then 'PASS: the host reads the whole lobby' else 'FAIL: host reads ' || pg_temp.sees(:'m_sid', :'m_board') end;
select pg_temp.act(:'m_opp_uid') \gset
select case when pg_temp.sees(:'m_sid', :'m_board') = 'sessions 1, players 2, settings 1, games 1, moves 5, boards 1, axes 6'
  then 'PASS: the opponent reads the whole lobby' else 'FAIL: opponent reads ' || pg_temp.sees(:'m_sid', :'m_board') end;

select pg_temp.act(:'z_host_uid') \gset
select case when pg_temp.sees(:'m_sid', :'m_board') = 'sessions 0, players 0, settings 0, games 0, moves 0, boards 0, axes 0'
  then 'PASS: a player seated in another lobby reads nothing of this one, even knowing its ids'
  else 'FAIL: outsider reads ' || pg_temp.sees(:'m_sid', :'m_board') end;
select case when (select bool_and(id = :'z_sid'::uuid) from sessions where game_mode = 'tic_tac_toe')
             and (select bool_and(session_id = :'z_sid'::uuid) from players p where p.session_id in (select id from sessions where game_mode = 'tic_tac_toe'))
             and (select count(*) from players where session_id = :'z_sid') = 2
             and (select coalesce(bool_and(session_id = :'z_sid'::uuid), true) from ttt_settings)
             and (select count(*) from ttt_games) = 0
             and (select count(*) from ttt_moves) = 0
             and (select count(*) from ttt_boards) = 0
             and (select count(*) from ttt_board_axes) = 0
  then 'PASS: scanning whole tables, that player sees only their own lobby'
  else 'FAIL: a whole-table scan leaked another lobby' end;

select pg_temp.act(:'u_kit') \gset
select case when pg_temp.sees(:'m_sid', :'m_board') = 'sessions 0, players 0, settings 0, games 0, moves 0, boards 0, axes 0'
             and (select count(*) from sessions where game_mode = 'tic_tac_toe') = 0
             and (select count(*) from ttt_settings) + (select count(*) from ttt_games) + (select count(*) from ttt_moves)
                 + (select count(*) from ttt_boards) + (select count(*) from ttt_board_axes) = 0
  then 'PASS: a signed-in user with no seat anywhere reads no Tic-Tac-Toe rows at all'
  else 'FAIL: a user with no seat read something' end;

select pg_temp.act(null) \gset
select case when pg_temp.sees(:'m_sid', :'m_board') = 'sessions 0, players 0, settings 0, games 0, moves 0, boards 0, axes 0'
  then 'PASS: the signed-in role with no user reads nothing' else 'FAIL: no user reads ' || pg_temp.sees(:'m_sid', :'m_board') end;

select pg_temp.act(:'m_host_uid') \gset
select ttt_my_seat(:'m_sid') as my_m_seat, coalesce(ttt_my_seat(:'z_sid')::text, 'none') as my_z_seat \gset
select case when :'my_m_seat' = :'m_host' and :'my_z_seat' = 'none'
  then 'PASS: ttt_my_seat gives back the caller''s own seat, and nothing for a lobby they are not in'
  else 'FAIL: ttt_my_seat' end;

-- Football Imposter reads exactly as before, signed in or not.
select pg_temp.act(:'z_host_uid') \gset
select case when (select count(*) from sessions where id = :'imp_session_id') = 1
             and (select count(*) from players where session_id = :'imp_session_id') = 1
  then 'PASS: a signed-in user reads a Football Imposter lobby they are not in, as before'
  else 'FAIL: signed in, Imposter rows hidden' end;
reset role;

select pg_temp.act(null) \gset
set role anon;
select player_id as quin from join_session(:'imp_code', 'Quin') \gset imp_
select case when (select count(*) from sessions where id = :'imp_session_id') = 1
             and (select count(*) from players where session_id = :'imp_session_id') = 2
             and (select count(*) from sessions where id = :'m_sid') = 0
             and (select count(*) from players where session_id = :'m_sid') = 0
             and (select count(*) from sessions where game_mode = 'tic_tac_toe') = 0
  then 'PASS: signed out, Football Imposter joins and reads as before, and no Tic-Tac-Toe lobby is visible'
  else 'FAIL: anon reads' end;
reset role;

-- ============================================================================
\echo '=== 9. Three in a row ==='
-- ============================================================================

select * from pg_temp.lobby('Row X', 'Row O') \gset w1_
select pg_temp.deal(:'w1_sid', pg_temp.board_a(), :'w1_host', :'w1_opp');
select * from pg_temp.lobby('Col X', 'Col O') \gset w2_
select pg_temp.deal(:'w2_sid', pg_temp.board_a(), :'w2_host', :'w2_opp');
select * from pg_temp.lobby('Diag X', 'Diag O') \gset w3_
select pg_temp.deal(:'w3_sid', pg_temp.board_a(), :'w3_host', :'w3_opp');
select * from pg_temp.lobby('Anti X', 'Anti O') \gset w4_
select pg_temp.deal(:'w4_sid', pg_temp.board_a(), :'w4_host', :'w4_opp');

set role authenticated;

select pg_temp.run(:'w1_sid', :'w1_host_uid', :'w1_opp_uid', array['X 0 Pavel Orskin', 'O pass', 'X 1 Idris Kallow', 'O pass']) as before \gset w1_
select case when :'w1_before' = 'cpcp' and pg_temp.state(:'w1_sid') = 'playing turn X'
  then 'PASS: two in a row is not a win' else 'FAIL: premature win' end;
select pg_temp.act(:'w1_host_uid') \gset
select coalesce(game_status, '-') || ' ' || coalesce(winner_mark, '-') as last from ttt_submit_move(:'w1_sid', 2, pg_temp.fid('Arlo Venn')) \gset w1_
select case when :'w1_last' = 'won X' and pg_temp.state(:'w1_sid') = 'won by X on line 0 (line)' and pg_temp.grid(:'w1_sid') = 'XXX......'
  then 'PASS: a horizontal line wins, and the winning move says so'
  else 'FAIL: horizontal win' end;

select pg_temp.run(:'w2_sid', :'w2_host_uid', :'w2_opp_uid', array['X 0 Pavel Orskin', 'O pass', 'X 3 Stefan Dravek', 'O pass', 'X 6 Teo Vargalo']);
select case when pg_temp.state(:'w2_sid') = 'won by X on line 3 (line)' and pg_temp.grid(:'w2_sid') = 'X..X..X..'
  then 'PASS: a vertical line wins' else 'FAIL: vertical win ' || pg_temp.state(:'w2_sid') end;

select pg_temp.run(:'w3_sid', :'w3_host_uid', :'w3_opp_uid', array['X 0 Pavel Orskin', 'O 1 Idris Kallow', 'X 4 Owen Marrick', 'O 2 Arlo Venn', 'X 8 Tomas Quell']);
select case when pg_temp.state(:'w3_sid') = 'won by X on line 6 (line)' and pg_temp.grid(:'w3_sid') = 'XOO.X...X'
  then 'PASS: a diagonal wins' else 'FAIL: diagonal win ' || pg_temp.state(:'w3_sid') end;

select pg_temp.run(:'w4_sid', :'w4_host_uid', :'w4_opp_uid', array['X pass', 'O 2 Arlo Venn', 'X pass', 'O 4 Owen Marrick', 'X pass', 'O 6 Teo Vargalo']);
select case when pg_temp.state(:'w4_sid') = 'won by O on line 7 (line)' and pg_temp.grid(:'w4_sid') = '..O.O.O..'
  then 'PASS: the other diagonal wins, for O' else 'FAIL: anti-diagonal win ' || pg_temp.state(:'w4_sid') end;

select pg_temp.act(:'w1_opp_uid') \gset
select pg_temp.refused('a move after the board is won',
  format('select * from ttt_submit_move(%L, 5, %L)', :'w1_sid', pg_temp.fid('Samuel Oduvar')), 'ttt_no_board');
select pg_temp.refused('a pass after the board is won', format('select ttt_pass(%L)', :'w1_sid'), 'ttt_no_board');

reset role;

-- ============================================================================
\echo '=== 10. Draws ==='
-- ============================================================================

select * from pg_temp.lobby('Full X', 'Full O') \gset d1_
select pg_temp.deal(:'d1_sid', pg_temp.board_a(), :'d1_host', :'d1_opp');
select * from pg_temp.lobby('Dead X', 'Dead O') \gset d2_
select pg_temp.deal(:'d2_sid', pg_temp.board_b(), :'d2_host', :'d2_opp');

set role authenticated;

select pg_temp.run(:'d1_sid', :'d1_host_uid', :'d1_opp_uid', array[
  'X 0 Pavel Orskin', 'O 1 Idris Kallow', 'X 2 Arlo Venn', 'O 4 Owen Marrick',
  'X 3 Stefan Dravek', 'O 5 Samuel Oduvar', 'X 7 Leon Varrow', 'O 6 Teo Vargalo']) as eight \gset d1_
select case when :'d1_eight' = 'cccccccc' and pg_temp.state(:'d1_sid') = 'playing turn X'
  then 'PASS: eight squares and no line is still a game' else 'FAIL: ended early' end;
select pg_temp.run(:'d1_sid', :'d1_host_uid', :'d1_opp_uid', array['X 8 Tomas Quell']);
select case when pg_temp.state(:'d1_sid') = 'drawn (board_full)' and pg_temp.grid(:'d1_sid') = 'XOXXOOOXX'
  then 'PASS: a full board with no line is a draw' else 'FAIL: full-board draw ' || pg_temp.state(:'d1_sid') end;

select pg_temp.run(:'d2_sid', :'d2_host_uid', :'d2_opp_uid', array['X 0 Kai Brennik', 'O 1 Iker Zalduen', 'X 3 Arlo Venn']);
select case when pg_temp.state(:'d2_sid') = 'playing turn O'
  then 'PASS: while one empty square still has someone left to name, play goes on' else 'FAIL: dead-board draw came early' end;
select pg_temp.run(:'d2_sid', :'d2_host_uid', :'d2_opp_uid', array['O 8 Owen Marrick']);
select case when pg_temp.state(:'d2_sid') = 'drawn (no_answers_left)' and pg_temp.grid(:'d2_sid') = 'XO.X....O'
  then 'PASS: when no empty square has an unused footballer left, it is a draw, five squares early'
  else 'FAIL: dead-board draw ' || pg_temp.state(:'d2_sid') || ' ' || pg_temp.grid(:'d2_sid') end;

reset role;

-- ============================================================================
\echo '=== 11. Rematches, and changing difficulty between boards ==='
-- ============================================================================

select * from pg_temp.lobby('Remy', 'Sol') \gset r_
set role authenticated;
select pg_temp.act(:'r_host_uid') \gset
select ttt_start_game(:'r_sid');
select pg_temp.refused('a rematch while the board is still in play', format('select ttt_rematch(%L)', :'r_sid'), 'ttt_board_in_play');
select pg_temp.refused('changing the difficulty while the board is still in play', format('select ttt_update_settings(%L, ''hard'')', :'r_sid'), 'ttt_board_in_play');
reset role;

select x_player_id as x1, board_id as b1 from ttt_games where session_id = :'r_sid' and board_number = 1 \gset r_
select case when (select difficulty from ttt_boards where id = :'r_b1') = 'medium'
             and (select difficulty from ttt_settings where session_id = :'r_sid') = 'medium'
  then 'PASS: board 1 is at the lobby''s difficulty, and the refused change left it there'
  else 'FAIL: board 1 difficulty' end;

update ttt_games set status = 'won', end_reason = 'line', winner_mark = 'X', winning_line = 0, turn_mark = null, ended_at = now()
where session_id = :'r_sid' and board_number = 1;

set role authenticated;
select pg_temp.act(:'r_opp_uid') \gset
select pg_temp.refused_with('the guest calling a rematch', format('select ttt_rematch(%L)', :'r_sid'), 'Only the host can start another board');
select pg_temp.refused_with('the guest changing the difficulty between boards', format('select ttt_update_settings(%L, ''hard'')', :'r_sid'), 'Only the host can change the settings');
select pg_temp.act(:'r_host_uid') \gset
select ttt_update_settings(:'r_sid', 'hard');
select ttt_rematch(:'r_sid');
reset role;

select case when g.board_number = 2 and g.x_player_id = :'r_x1' and g.starter_mark = 'O' and g.turn_mark = 'O' and g.board_id <> :'r_b1'
  then 'PASS: board 2 has the same X and O, a new board, and O starts'
  else 'FAIL: rematch' end
from ttt_games g where g.session_id = :'r_sid' and g.board_number = 2;

select case when (select b.difficulty from ttt_games g join ttt_boards b on b.id = g.board_id where g.session_id = :'r_sid' and g.board_number = 2) = 'hard'
  then 'PASS: the host changed the difficulty between boards, and the rematch used it'
  else 'FAIL: the rematch ignored the new difficulty' end;

update ttt_games set status = 'drawn', end_reason = 'board_full', turn_mark = null, ended_at = now()
where session_id = :'r_sid' and board_number = 2;
set role authenticated;
select pg_temp.act(:'r_host_uid') \gset
select ttt_update_settings(:'r_sid', 'extreme');
select ttt_rematch(:'r_sid');
reset role;
select case when (select starter_mark || turn_mark || (x_player_id = :'r_x1')::text || b.difficulty
                  from ttt_games g join ttt_boards b on b.id = g.board_id
                  where g.session_id = :'r_sid' and g.board_number = 3) = 'XXtrueextreme'
  then 'PASS: board 3 swaps back, X starts again, at the difficulty chosen after board 2' else 'FAIL: third board' end;

set role authenticated;
select pg_temp.act(:'r_host_uid') \gset
select pg_temp.refused_with('starting a lobby that is already playing', format('select ttt_start_game(%L)', :'r_sid'), 'The game has already started');
reset role;

-- ============================================================================
\echo '=== 12. The coin toss ==='
-- ============================================================================

create temp table tosses (host_is_x boolean, x_starts boolean);
do $$
declare
  v record;
  i int;
begin
  for i in 1..24 loop
    select * into v from pg_temp.lobby('Toss ' || i, 'Caller ' || i);
    -- Both seats were made in this one transaction, so they share a join
    -- time. Put the guest a second later, so "first to join" really is the
    -- host and a toss that always favoured them would show.
    update players set joined_at = joined_at + interval '1 second' where id = v.opp;
    perform pg_temp.act(v.host_uid);
    perform ttt_start_game(v.sid);
    insert into tosses
    select g.x_player_id = v.host, g.starter_mark = 'X' and g.turn_mark = 'X'
    from ttt_games g where g.session_id = v.sid;
  end loop;
  perform pg_temp.act(null);
end $$;

select case when count(*) = 24 and bool_and(x_starts) and bool_or(host_is_x) and bool_or(not host_is_x)
  then 'PASS: the server tosses a coin for X (host was X ' || count(*) filter (where host_is_x) || ' times in 24), and X always starts board 1'
  else 'FAIL: coin toss' end
from tosses;

-- ============================================================================
\echo '=== 13. Leaving ==='
-- ============================================================================

-- Opponent, mid-board.
select * from pg_temp.lobby('Uma', 'Vic') \gset q1_
select pg_temp.deal(:'q1_sid', pg_temp.board_a(), :'q1_host', :'q1_opp') as game \gset q1_
select board_id as board from ttt_games where id = :'q1_game' \gset q1_
set role authenticated;
select pg_temp.run(:'q1_sid', :'q1_host_uid', :'q1_opp_uid', array['X 4 Owen Marrick', 'O 1 Idris Kallow']);
select pg_temp.act(:'q1_opp_uid') \gset
select leave_session(:'q1_sid', :'q1_opp');
reset role;

select case when pg_temp.state(:'q1_sid') = 'forfeited by X (forfeit)'
             and (select status from sessions where id = :'q1_sid') = 'waiting'
             and not exists (select 1 from players where id = :'q1_opp')
             and not exists (select 1 from seat_owners where player_id = :'q1_opp')
             and (select o_player_id is null and o_name = 'Vic' and x_player_id = :'q1_host' from ttt_games where session_id = :'q1_sid')
             and (select count(*) filter (where player_id is null) || '/' || count(*) from ttt_moves where session_id = :'q1_sid') = '1/2'
  then 'PASS: the opponent leaving mid-board: host wins by forfeit, seat and owner removed, lobby back to waiting, record kept'
  else 'FAIL: opponent left mid-board: ' || pg_temp.state(:'q1_sid') end;

set role authenticated;
select pg_temp.act(:'q1_opp_uid') \gset
select case when pg_temp.sees(:'q1_sid', :'q1_board') = 'sessions 0, players 0, settings 0, games 0, moves 0, boards 0, axes 0'
  then 'PASS: once their seat has gone, the old opponent can read nothing of the lobby'
  else 'FAIL: the old opponent still reads ' || pg_temp.sees(:'q1_sid', :'q1_board') end;

select pg_temp.act(:'u_wes') \gset
select player_id as newcomer from join_session(:'q1_code', 'Wes', 'tic_tac_toe') \gset q1_
select pg_temp.act(:'q1_host_uid') \gset
select ttt_start_game(:'q1_sid');
select pg_temp.act(:'u_wes') \gset
select (select count(*) from ttt_games where session_id = :'q1_sid') as wes_games \gset
reset role;
select case when g.board_number = 2 and g.starter_mark = 'X'
             and array[g.x_player_id, g.o_player_id] @> array[:'q1_host'::uuid, :'q1_newcomer'::uuid]
             and :'wes_games' = '2'
  then 'PASS: a new opponent can join the same code; board 2 is a new match with a fresh toss, and the newcomer sees the lobby''s earlier board'
  else 'FAIL: new opponent' end
from ttt_games g where g.session_id = :'q1_sid' and g.status = 'playing';

-- Host, mid-board.
select * from pg_temp.lobby('Xan', 'Yul') \gset q2_
select pg_temp.deal(:'q2_sid', pg_temp.board_a(), :'q2_host', :'q2_opp') as game \gset q2_
select board_id as board from ttt_games where id = :'q2_game' \gset q2_
set role authenticated;
select pg_temp.act(:'q2_host_uid') \gset
select leave_session(:'q2_sid', :'q2_host');
reset role;

select case when pg_temp.state(:'q2_sid') = 'forfeited by O (forfeit)'
             and (select status = 'ended' and ended_at is not null from sessions where id = :'q2_sid')
             and (select not is_active from players where id = :'q2_host')
  then 'PASS: the host leaving mid-board: opponent wins by forfeit, host out but seated, lobby ended'
  else 'FAIL: host left mid-board: ' || pg_temp.state(:'q2_sid') end;

set role authenticated;
select pg_temp.act(:'q2_opp_uid') \gset
select pg_temp.refused('the opponent moving after the host left',
  format('select * from ttt_submit_move(%L, 0, %L)', :'q2_sid', pg_temp.fid('Pavel Orskin')), 'ttt_no_board');
select pg_temp.act(:'u_zed') \gset
select pg_temp.refused_with('joining the ended lobby', format('select join_session(%L, ''Zed'', ''tic_tac_toe'')', :'q2_code'), 'That game has already started');
select pg_temp.act(:'q2_host_uid') \gset
select pg_temp.refused('the host who walked out changing the difficulty of the ended lobby',
  format('select ttt_update_settings(%L, ''easy'')', :'q2_sid'), 'ttt_game_over');
select case when pg_temp.sees(:'q2_sid', :'q2_board') = 'sessions 1, players 2, settings 1, games 1, moves 0, boards 1, axes 6'
  then 'PASS: the host who walked out still holds the seat, so can still see how it ended'
  else 'FAIL: walked-out host reads ' || pg_temp.sees(:'q2_sid', :'q2_board') end;
select pg_temp.act(:'q2_opp_uid') \gset
select leave_session(:'q2_sid', null);
reset role;
select case when not exists (select 1 from players where id = :'q2_opp') and exists (select 1 from sessions where id = :'q2_sid')
  then 'PASS: then the opponent leaving (with no seat named: the RPC finds it) just gives up the seat' else 'FAIL: leaving an ended lobby' end;

-- Opponent, between boards.
select * from pg_temp.lobby('Ada', 'Bo') \gset q3_
select pg_temp.deal(:'q3_sid', pg_temp.board_a(), :'q3_host', :'q3_opp');
set role authenticated;
select pg_temp.run(:'q3_sid', :'q3_host_uid', :'q3_opp_uid', array['X 0 Pavel Orskin', 'O pass', 'X 1 Idris Kallow', 'O pass', 'X 2 Arlo Venn']);
select pg_temp.act(:'q3_opp_uid') \gset
select leave_session(:'q3_sid', null);
reset role;
select case when (select status from sessions where id = :'q3_sid') = 'waiting'
             and not exists (select 1 from players where id = :'q3_opp')
             and pg_temp.state(:'q3_sid') = 'won by X on line 0 (line)'
  then 'PASS: the opponent leaving between boards: seat removed, back to waiting, the result stands'
  else 'FAIL: opponent left between boards' end;

-- Host, between boards.
select * from pg_temp.lobby('Cal', 'Di') \gset q4_
select pg_temp.deal(:'q4_sid', pg_temp.board_a(), :'q4_host', :'q4_opp') as game \gset q4_
select board_id as board from ttt_games where id = :'q4_game' \gset q4_
set role authenticated;
select pg_temp.run(:'q4_sid', :'q4_host_uid', :'q4_opp_uid', array['X 0 Pavel Orskin', 'O pass', 'X 1 Idris Kallow', 'O pass', 'X 2 Arlo Venn']);
select pg_temp.act(:'q4_host_uid') \gset
select leave_session(:'q4_sid', :'q4_host');
reset role;
select case when not exists (select 1 from sessions where id = :'q4_sid')
             and not exists (select 1 from ttt_games where id = :'q4_game')
             and not exists (select 1 from ttt_boards where id = :'q4_board')
             and not exists (select 1 from seat_owners where session_id = :'q4_sid')
  then 'PASS: the host leaving between boards closes the lobby, and its games, boards and seat owners go with it'
  else 'FAIL: host left between boards' end;

-- Nobody can make someone else leave the lobby.
select * from pg_temp.lobby('Eve', 'Fay') \gset q5_
set role authenticated;
select pg_temp.act(:'q5_opp_uid') \gset
select pg_temp.refused('the guest making the host leave (which would close the lobby)',
  format('select leave_session(%L, %L)', :'q5_sid', :'q5_host'), 'ttt_not_your_seat');
select pg_temp.act(:'q5_host_uid') \gset
select pg_temp.refused('the host removing the guest',
  format('select leave_session(%L, %L)', :'q5_sid', :'q5_opp'), 'ttt_not_your_seat');
select pg_temp.act(:'z_host_uid') \gset
select pg_temp.refused('an outsider removing the guest',
  format('select leave_session(%L, %L)', :'q5_sid', :'q5_opp'), 'ttt_not_your_seat');
reset role;
select pg_temp.act(null) \gset
set role anon;
select pg_temp.refused('anon making the host leave',
  format('select leave_session(%L, %L)', :'q5_sid', :'q5_host'), 'ttt_not_your_seat');
reset role;
select case when (select count(*) from players where session_id = :'q5_sid') = 2
             and (select status from sessions where id = :'q5_sid') = 'waiting'
  then 'PASS: the lobby and both seats are still there' else 'FAIL: someone was made to leave' end;

-- Harmless repeats.
set role authenticated;
select pg_temp.act(:'q1_opp_uid') \gset
select leave_session(:'q1_sid', :'q1_opp');
select pg_temp.act(:'z_host_uid') \gset
select leave_session(:'q1_sid', :'z_host');
select leave_session(:'q1_sid', null);
reset role;
select pg_temp.act(null) \gset
set role anon;
select leave_session(:'q1_sid', null);
reset role;
select case when (select count(*) from players where session_id = :'q1_sid') = 2 and pg_temp.state(:'q1_sid') = 'playing turn X'
  then 'PASS: leaving twice, or leaving a lobby you are not in, changes nothing' else 'FAIL: repeat leave' end;

-- ============================================================================
\echo '=== 14. The schema holds its own invariants ==='
-- Written as the owner, straight into the tables, past every RPC.
-- ============================================================================

select * from pg_temp.lobby('Inv', 'Ari') \gset i_
select pg_temp.deal(:'i_sid', pg_temp.board_a(), :'i_host', :'i_opp') as game \gset i_
select board_id as board from ttt_games where id = :'i_game' \gset i_

select pg_temp.refused_by('a second board in play in one lobby',
  format('select pg_temp.deal(%L, pg_temp.board_a(), %L, %L)', :'i_sid', :'i_host', :'i_opp'), 'ttt_games_one_in_play');
select pg_temp.refused_by('two games on one board',
  format('insert into ttt_games (session_id, board_number, board_id, x_player_id, o_player_id, x_name, o_name, starter_mark, status, end_reason, ended_at) values (%L, 9, %L, %L, %L, ''a'', ''b'', ''X'', ''drawn'', ''board_full'', now())',
         :'i_sid', :'i_board', :'i_host', :'i_opp'), 'ttt_games_board_id_key');
select pg_temp.refused_by('one person as both X and O',
  format('update ttt_games set o_player_id = x_player_id where id = %L', :'i_game'), 'ttt_games_two_people');
select pg_temp.refused_by('a board in play with nobody''s turn', format('update ttt_games set turn_mark = null where id = %L', :'i_game'), 'ttt_games_turn');
select pg_temp.refused_by('a win without its line',
  format('update ttt_games set status = ''won'', end_reason = ''line'', winner_mark = ''X'', turn_mark = null, ended_at = now() where id = %L', :'i_game'), 'ttt_games_ending');
select pg_temp.refused_by('a draw with a winner',
  format('update ttt_games set status = ''drawn'', end_reason = ''board_full'', winner_mark = ''X'', turn_mark = null, ended_at = now() where id = %L', :'i_game'), 'ttt_games_ending');
select pg_temp.refused_by('a forfeit with a winning line',
  format('update ttt_games set status = ''forfeited'', end_reason = ''forfeit'', winner_mark = ''X'', winning_line = 0, turn_mark = null, ended_at = now() where id = %L', :'i_game'), 'ttt_games_ending');
select pg_temp.refused_by('a draw for the wrong reason',
  format('update ttt_games set status = ''drawn'', end_reason = ''line'', turn_mark = null, ended_at = now() where id = %L', :'i_game'), 'ttt_games_ending');
select pg_temp.refused_by('a line that does not exist',
  format('update ttt_games set status = ''won'', end_reason = ''line'', winner_mark = ''X'', winning_line = 9, turn_mark = null, ended_at = now() where id = %L', :'i_game'), 'ttt_games_winning_line_fkey');
select pg_temp.refused_by('a seat from another lobby',
  format('update ttt_games set x_player_id = %L where id = %L', :'z_host', :'i_game'), 'ttt_games_x_seat_fk');
select pg_temp.refused_by('a Tic-Tac-Toe game in a Football Imposter lobby',
  format('insert into ttt_games (session_id, board_number, board_id, x_name, o_name, starter_mark, status, end_reason, ended_at) values (%L, 1, pg_temp.board_a(), ''a'', ''b'', ''X'', ''drawn'', ''board_full'', now())',
         :'imp_session_id'), 'ttt_games_session_fk');
select pg_temp.refused_by('Tic-Tac-Toe settings on a Football Imposter lobby', format('insert into ttt_settings (session_id) values (%L)', :'imp_session_id'), 'ttt_settings_session_fk');

select set_config('fn.i_game', :'i_game', false) \gset
do $$
begin
  update ttt_games set o_player_id = null where id = current_setting('fn.i_game')::uuid;
  set constraints ttt_games_seated immediate;
  raise notice 'FAIL: a board in play lost a player';
exception when check_violation then raise notice 'PASS: a board in play cannot lose one of its players';
end $$;

-- Moves.
select pg_temp.refused_by('a claim without a footballer',
  format('insert into ttt_moves (game_id, session_id, move_number, mark, kind, cell) values (%L, %L, 1, ''X'', ''claim'', 0)', :'i_game', :'i_sid'), 'ttt_moves_shape');
select pg_temp.refused_by('a pass that names a square',
  format('insert into ttt_moves (game_id, session_id, move_number, mark, kind, cell) values (%L, %L, 1, ''X'', ''pass'', 0)', :'i_game', :'i_sid'), 'ttt_moves_shape');
select pg_temp.refused_by('a move for a game in another lobby',
  format('insert into ttt_moves (game_id, session_id, move_number, mark, kind) values (%L, %L, 1, ''X'', ''pass'')', :'i_game', :'z_sid'), 'ttt_moves_game_fk');
select pg_temp.refused_by('a mark that is not X or O',
  format('insert into ttt_moves (game_id, session_id, move_number, mark, kind) values (%L, %L, 1, ''Z'', ''pass'')', :'i_game', :'i_sid'), 'ttt_moves_mark_valid');

insert into ttt_moves (game_id, session_id, move_number, mark, kind, cell, football_player_id, footballer_name)
values (:'i_game', :'i_sid', 1, 'X', 'claim', 4, pg_temp.fid('Owen Marrick'), 'Owen Marrick');
select pg_temp.refused_by('a second claim on the same square',
  format('insert into ttt_moves (game_id, session_id, move_number, mark, kind, cell, football_player_id, footballer_name) values (%L, %L, 2, ''O'', ''claim'', 4, %L, ''x'')',
         :'i_game', :'i_sid', pg_temp.fid('Stefan Dravek')), 'ttt_moves_one_claim_per_square');
select pg_temp.refused_by('the same footballer claiming twice on one board',
  format('insert into ttt_moves (game_id, session_id, move_number, mark, kind, cell, football_player_id, footballer_name) values (%L, %L, 2, ''O'', ''claim'', 5, %L, ''x'')',
         :'i_game', :'i_sid', pg_temp.fid('Owen Marrick')), 'ttt_moves_footballer_once');
select pg_temp.refused_by('two moves with the same number',
  format('insert into ttt_moves (game_id, session_id, move_number, mark, kind) values (%L, %L, 1, ''O'', ''pass'')', :'i_game', :'i_sid'), 'ttt_moves_number');
select pg_temp.refused_state('rewriting a move', format('update ttt_moves set cell = 5 where game_id = %L', :'i_game'), '23001');
select pg_temp.refused_by('a "why it was wrong" record on a right answer',
  format('insert into ttt_move_checks (move_id, row_ok, col_ok) select id, true, false from ttt_moves where game_id = %L', :'i_game'), 'ttt_move_checks_move_fk');

insert into ttt_moves (game_id, session_id, move_number, mark, kind, cell, football_player_id, footballer_name)
values (:'i_game', :'i_sid', 2, 'O', 'wrong', 0, pg_temp.fid('Arlo Venn'), 'Arlo Venn');
select pg_temp.refused_by('a wrong answer recorded as fitting both halves',
  format('insert into ttt_move_checks (move_id, row_ok, col_ok) select id, true, true from ttt_moves where game_id = %L and kind = ''wrong''', :'i_game'), 'ttt_move_checks_was_wrong');

-- Seat owners.
select set_config('fn.i_sid', :'i_sid', false), set_config('fn.i_opp', :'i_opp', false), set_config('fn.i_host_uid', :'i_host_uid', false) \gset

do $$
declare v_seat uuid; v_con text;
begin
  insert into players (session_id, display_name) values (current_setting('fn.i_sid')::uuid, 'Twin') returning id into v_seat;
  insert into seat_owners (player_id, session_id, auth_user_id)
  values (v_seat, current_setting('fn.i_sid')::uuid, current_setting('fn.i_host_uid')::uuid);
  raise notice 'FAIL: one user got two seats in one lobby';
exception when unique_violation then
  get stacked diagnostics v_con = constraint_name;
  if v_con = 'seat_owners_one_seat_each' then raise notice 'PASS: one user cannot hold two seats in one lobby (seat_owners_one_seat_each)';
  else raise notice 'FAIL: two seats refused by % instead', v_con; end if;
end $$;

do $$
declare v_msg text;
begin
  insert into players (session_id, display_name) values (current_setting('fn.i_sid')::uuid, 'Ghost');
  set constraints players_ttt_seat_owned immediate;
  raise notice 'FAIL: a Tic-Tac-Toe seat with no owner was saved';
exception when check_violation then
  get stacked diagnostics v_msg = message_text;
  if v_msg = 'A Football Tic-Tac-Toe seat needs an owner' then raise notice 'PASS: a Tic-Tac-Toe seat without an owner cannot be committed';
  else raise notice 'FAIL: ownerless seat: %', v_msg; end if;
end $$;

do $$
declare v_msg text;
begin
  delete from seat_owners where player_id = current_setting('fn.i_opp')::uuid;
  set constraints seat_owners_kept immediate;
  raise notice 'FAIL: a seat lost its owner and stayed';
exception when check_violation then
  get stacked diagnostics v_msg = message_text;
  if v_msg = 'A Football Tic-Tac-Toe seat needs an owner' then raise notice 'PASS: an owner cannot be taken away from a seat that stays';
  else raise notice 'FAIL: owner removal: %', v_msg; end if;
end $$;

select pg_temp.refused_by('an owner row for a seat in another lobby',
  format('insert into seat_owners (player_id, session_id, auth_user_id) values (%L, %L, %L)', :'imp_player_id', :'i_sid', gen_random_uuid()), 'seat_owners_seat_fk');
select pg_temp.refused_state('handing a seat to a different user',
  format('update seat_owners set auth_user_id = %L where player_id = %L', gen_random_uuid(), :'i_host'), '23001');

select case when not exists (
    select 1 from players p join sessions s on s.id = p.session_id
    where s.game_mode = 'tic_tac_toe' and not exists (select 1 from seat_owners o where o.player_id = p.id))
  and not exists (
    select 1 from seat_owners o join sessions s on s.id = o.session_id where s.game_mode <> 'tic_tac_toe')
  and (select count(*) from players p join sessions s on s.id = p.session_id where s.game_mode = 'imposter') > 0
  then 'PASS: every Tic-Tac-Toe seat has an owner; Football Imposter seats have none and need none'
  else 'FAIL: seat owners across the database' end;

-- ============================================================================
\echo '=== 15. A whole lobby can still be deleted mid-board ==='
-- ============================================================================

delete from sessions where id = :'i_sid';
select case when not exists (select 1 from ttt_games where id = :'i_game')
             and not exists (select 1 from ttt_moves where session_id = :'i_sid')
             and not exists (select 1 from ttt_boards where id = :'i_board')
             and not exists (select 1 from seat_owners where session_id = :'i_sid')
  then 'PASS: deleting a lobby with a board in play removes its games, moves, board and seat owners'
  else 'FAIL: lobby delete' end;

update ttt_config set active_profile = 'standard';
select set_config('request.jwt.claims', '', false) \gset

\echo '=== 0010 done ==='
