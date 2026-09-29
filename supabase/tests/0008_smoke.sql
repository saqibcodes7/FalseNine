-- ============================================================================
-- Smoke tests for migration 0008 (more than one game).
--
-- Run against a THROWAWAY database, after all the migrations. The easy way is
-- `npm run test:db`, which builds one, runs every smoke file and drops it.
--
-- These tests make Tic-Tac-Toe lobbies directly rather than through that
-- game's own create RPC, so they stay about what 0008 changed. Once 0010 is
-- applied, a Tic-Tac-Toe seat must belong to a signed-in user, so the tests
-- sign in the way the SQL sees it: by setting request.jwt.claims, the setting
-- Supabase fills from the caller's JWT, and switching to the authenticated
-- role. That mocks Supabase Auth for the SQL only; it is not an Auth test.
--
-- Every check prints PASS or FAIL.
-- ============================================================================

\pset pager off
\set ON_ERROR_STOP on

delete from sessions;

-- A Tic-Tac-Toe lobby and its host. Runs as the owner, not as anon. When 0010
-- is applied, the host's seat also gets an owner, a made-up signed-in user
-- returned as owner_id.
create or replace function pg_temp.ttt_lobby(p_host text)
returns table (session_id uuid, code text, player_id uuid, owner_id uuid)
language plpgsql as $$
declare
  v_session uuid;
  v_code    text := public.generate_session_code();
  v_player  uuid;
  v_owner   uuid := gen_random_uuid();
begin
  insert into public.sessions (code, game_mode) values (v_code, 'tic_tac_toe') returning id into v_session;
  insert into public.players (session_id, display_name, is_host) values (v_session, p_host, true) returning id into v_player;
  update public.sessions set host_player_id = v_player where id = v_session;
  if to_regclass('public.seat_owners') is not null then
    execute 'insert into public.seat_owners (player_id, session_id, auth_user_id) values ($1, $2, $3)'
      using v_player, v_session, v_owner;
  end if;
  return query select v_session, v_code, v_player, v_owner;
end $$;

-- Three more made-up signed-in users, for the Tic-Tac-Toe seats joined below.
select gen_random_uuid() as ivo_uid, gen_random_uuid() as jo_uid, gen_random_uuid() as oli_uid \gset

-- ============================================================================
\echo '=== 1. The registry ==='
-- ============================================================================

select case
  when count(*) = 2
   and bool_and((id = 'imposter'    and min_players = 3 and max_players = 12)
             or (id = 'tic_tac_toe' and min_players = 2 and max_players = 2))
  then 'PASS: two games registered, with their seat limits'
  else 'FAIL: ' || string_agg(id || ' ' || min_players || '-' || max_players, ', ')
end from game_modes;

set role anon;
select case when count(*) = 2 then 'PASS: anon can read the registry' else 'FAIL: anon sees ' || count(*) end
from game_modes;
do $$ begin
  insert into game_modes values ('draft', 'Draft', 2, 8);
  raise notice 'FAIL: anon added a game';
exception when insufficient_privilege then raise notice 'PASS: anon cannot add a game';
end $$;
reset role;

-- ============================================================================
\echo '=== 2. Football Imposter joins exactly as before ==='
-- ============================================================================

set role anon;
select * from create_session(p_display_name => 'Saqib') \gset imp_
reset role;
select set_config('fn.imp_code', :'imp_code', false) \gset

select case when game_mode = 'imposter' then 'PASS: create_session still makes an Imposter game'
       else 'FAIL: ' || game_mode end
from sessions where id = :'imp_session_id';

set role anon;
-- The two-argument call every app before this migration makes.
select player_id from join_session(:'imp_code', 'Amir') \gset imp_a_
select player_id from join_session(p_code => :'imp_code', p_display_name => 'Bea', p_game_mode => 'imposter') \gset imp_b_
select player_id from join_session(p_code => :'imp_code', p_display_name => 'Cal', p_game_mode => null) \gset imp_c_
select player_id from join_session(p_code => lower(:'imp_code'), p_display_name => 'Dee', p_game_mode => '  ') \gset imp_d_
reset role;

select case when count(*) = 5
  then 'PASS: the old call, an explicit imposter, null and blank all join an Imposter game'
  else 'FAIL: ' || count(*) || ' seats' end
from players where session_id = :'imp_session_id';

select case when count(*) = 5 then 'PASS: every Imposter seat still gets its hidden role row'
       else 'FAIL: ' || count(*) || ' role rows' end
from player_secrets s join players p on p.id = s.player_id
where p.session_id = :'imp_session_id';

set role anon;
do $$
declare i int;
begin
  for i in 6..12 loop
    perform join_session(current_setting('fn.imp_code'), 'Player ' || i);
  end loop;
  begin
    perform join_session(current_setting('fn.imp_code'), 'Player 13');
    raise notice 'FAIL: a 13th player got into an Imposter game';
  exception when check_violation then
    if sqlerrm = 'That game is full (12 players max)' then
      raise notice 'PASS: Imposter still seats 12, with the same message';
    else
      raise notice 'FAIL: %', sqlerrm;
    end if;
  end;
end $$;
reset role;

-- ============================================================================
\echo '=== 3. A Tic-Tac-Toe code only opens for Tic-Tac-Toe ==='
-- ============================================================================

select * from pg_temp.ttt_lobby('Hana') \gset ttt_
select set_config('fn.ttt_code', :'ttt_code', false) \gset
select set_config('fn.ttt_session', :'ttt_session_id', false) \gset
select set_config('fn.ttt_host', :'ttt_player_id', false) \gset

set role anon;
do $$
declare v_how text;
begin
  foreach v_how in array array['left out', 'imposter', 'null', 'blank'] loop
    begin
      case v_how
        when 'left out' then perform join_session(current_setting('fn.ttt_code'), 'Ivo');
        when 'imposter' then perform join_session(current_setting('fn.ttt_code'), 'Ivo', 'imposter');
        when 'null'     then perform join_session(current_setting('fn.ttt_code'), 'Ivo', null);
        else                 perform join_session(current_setting('fn.ttt_code'), 'Ivo', '');
      end case;
      raise notice 'FAIL: mode % joined a Tic-Tac-Toe game', v_how;
    exception when check_violation then
      if sqlerrm = 'That code is for Football Tic-Tac-Toe. Join it from there.' then
        raise notice 'PASS: mode % refused, naming the right game', v_how;
      else
        raise notice 'FAIL: mode %: %', v_how, sqlerrm;
      end if;
    end;
  end loop;
end $$;
reset role;

select case when count(*) = 1 then 'PASS: none of those refusals left a seat behind'
       else 'FAIL: ' || count(*) || ' seats' end
from players where session_id = :'ttt_session_id';

select set_config('request.jwt.claims', json_build_object('sub', :'ivo_uid', 'role', 'authenticated')::text, false) \gset
set role authenticated;
select player_id from join_session(p_code => :'ttt_code', p_display_name => 'Ivo', p_game_mode => 'tic_tac_toe') \gset ttt_opp_
reset role;

select case when count(*) = 2 then 'PASS: joined when the right game was named'
       else 'FAIL: ' || count(*) || ' seats' end
from players where session_id = :'ttt_session_id';

select case when not exists (select 1 from player_secrets where player_id = :'ttt_opp_player_id')
  then 'PASS: a Tic-Tac-Toe seat gets no hidden role row'
  else 'FAIL: a role row was created for Tic-Tac-Toe' end;

select set_config('request.jwt.claims', json_build_object('sub', :'jo_uid', 'role', 'authenticated')::text, false) \gset
set role authenticated;
do $$ begin
  perform join_session(current_setting('fn.ttt_code'), 'Jo', 'tic_tac_toe');
  raise notice 'FAIL: a third player got into Tic-Tac-Toe';
exception when check_violation then
  if sqlerrm = 'That game is full (2 players max)' then raise notice 'PASS: Tic-Tac-Toe seats two';
  else raise notice 'FAIL: %', sqlerrm; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '', false) \gset

set role anon;
do $$ begin
  perform join_session(current_setting('fn.imp_code'), 'Kit', 'tic_tac_toe');
  raise notice 'FAIL: an Imposter code opened for Tic-Tac-Toe';
exception when check_violation then
  if sqlerrm = 'That code is for Football Imposter. Join it from there.' then
    raise notice 'PASS: an Imposter code is refused to Tic-Tac-Toe, naming the right game';
  else raise notice 'FAIL: %', sqlerrm; end if;
end $$;

do $$ begin
  perform join_session(current_setting('fn.ttt_code'), 'Lu', 'draft');
  raise notice 'FAIL: an unknown game was accepted';
exception when invalid_parameter_value then raise notice 'PASS: an unknown game is refused';
end $$;

do $$ begin
  perform join_session('ZZZZZ', 'Mo', 'tic_tac_toe');
  raise notice 'FAIL: an unknown code was accepted';
exception when no_data_found then raise notice 'PASS: an unknown code is still "No game found"';
end $$;
reset role;

-- ============================================================================
\echo '=== 4. Each game has its own statuses ==='
-- ============================================================================

do $$ begin
  update sessions set status = 'peeking' where code = current_setting('fn.ttt_code');
  raise notice 'FAIL: a Tic-Tac-Toe game was put in an Imposter phase';
exception when check_violation then raise notice 'PASS: Tic-Tac-Toe cannot enter an Imposter phase';
end $$;

do $$ begin
  update sessions set status = 'playing' where code = current_setting('fn.imp_code');
  raise notice 'FAIL: an Imposter game was put in a Tic-Tac-Toe status';
exception when check_violation then raise notice 'PASS: Imposter cannot enter a Tic-Tac-Toe status';
end $$;

update sessions set status = 'playing' where id = :'ttt_session_id';
update sessions set status = 'ended'   where id = :'ttt_session_id';
select case when status = 'ended' then 'PASS: Tic-Tac-Toe moves through its own statuses'
       else 'FAIL: ' || status end
from sessions where id = :'ttt_session_id';
update sessions set status = 'waiting' where id = :'ttt_session_id';

-- ============================================================================
\echo '=== 5. Imposter RPCs leave a Tic-Tac-Toe game alone ==='
-- ============================================================================

set role anon;
do $$ begin
  perform start_game(current_setting('fn.ttt_session')::uuid, current_setting('fn.ttt_host')::uuid,
                     array['Pelé', 'Zico', 'Sócrates']);
  raise notice 'FAIL: start_game dealt Imposter roles in a Tic-Tac-Toe game';
exception when check_violation then
  if sqlerrm = 'That is not a Football Imposter game' then raise notice 'PASS: start_game refuses it';
  else raise notice 'FAIL: start_game: %', sqlerrm; end if;
end $$;

do $$ begin
  perform update_session_settings(current_setting('fn.ttt_session')::uuid, current_setting('fn.ttt_host')::uuid,
                                  'world_cup', 'you_know_ball', 2, true, true, 60, 30);
  raise notice 'FAIL: update_session_settings changed a Tic-Tac-Toe game';
exception when check_violation then
  if sqlerrm = 'That is not a Football Imposter game' then raise notice 'PASS: update_session_settings refuses it';
  else raise notice 'FAIL: update_session_settings: %', sqlerrm; end if;
end $$;
reset role;

update sessions set status = 'ended' where id = :'ttt_session_id';
set role anon;
do $$ begin
  perform play_again(current_setting('fn.ttt_session')::uuid, current_setting('fn.ttt_host')::uuid);
  raise notice 'FAIL: play_again reset a Tic-Tac-Toe game';
exception when check_violation then
  if sqlerrm = 'That is not a Football Imposter game' then raise notice 'PASS: play_again refuses it';
  else raise notice 'FAIL: play_again: %', sqlerrm; end if;
end $$;
reset role;

select case when s.status = 'ended' and s.player_pack = 'premier_league' and s.num_imposters = 1
            and not exists (select 1 from session_secrets x where x.session_id = s.id)
  then 'PASS: nothing about the Tic-Tac-Toe session moved'
  else 'FAIL: ' || s.status || ' ' || s.player_pack || ' ' || s.num_imposters end
from sessions s where s.id = :'ttt_session_id';

-- The rest only ever act in Imposter's own phases, which this game cannot be in.
update sessions set status = 'playing' where id = :'ttt_session_id';
set role anon;
select tick(:'ttt_session_id') as tick_result \gset
-- \gset leaves a variable unset on NULL, so hand it an empty string instead.
select coalesce(role, '') as card_role from get_my_card(:'ttt_session_id', :'ttt_player_id') \gset
do $$
declare
  s uuid := current_setting('fn.ttt_session')::uuid;
  h uuid := current_setting('fn.ttt_host')::uuid;
begin
  perform advance_peeking(s, h);
  perform ready_to_vote(s, h);
  perform continue_round(s, h);
  perform host_advance(s, h);
  begin perform cast_vote(s, h, null, true); exception when check_violation then null; end;
  begin perform salvage_guess(s, h, 'Pelé');  exception when check_violation then null; end;
end $$;
reset role;

select case when :'tick_result' = 'playing' then 'PASS: tick just reports the status'
       else 'FAIL: tick returned ' || :'tick_result' end;
select case when :'card_role' = '' then 'PASS: get_my_card has no card to hand out'
       else 'FAIL: got a role' end;
select case when s.status = 'playing'
            and not exists (select 1 from rounds r where r.session_id = s.id)
            and not exists (select 1 from votes v where v.session_id = s.id)
            and (select count(*) from players p where p.session_id = s.id and p.is_active) = 2
  then 'PASS: the other Imposter RPCs changed nothing'
  else 'FAIL: the session moved' end
from sessions s where s.id = :'ttt_session_id';

-- ============================================================================
\echo '=== 6. Leaving before kick-off works the same for every game ==='
-- ============================================================================

select * from pg_temp.ttt_lobby('Nia') \gset w_
select set_config('request.jwt.claims', json_build_object('sub', :'oli_uid', 'role', 'authenticated')::text, false) \gset
set role authenticated;
select player_id from join_session(p_code => :'w_code', p_display_name => 'Oli', p_game_mode => 'tic_tac_toe') \gset w_opp_
select leave_session(:'w_session_id', :'w_opp_player_id');
reset role;
select case when count(*) = 1 then 'PASS: Tic-Tac-Toe opponent leaving the lobby gives up the seat'
       else 'FAIL: ' || count(*) || ' seats' end
from players where session_id = :'w_session_id';

select set_config('request.jwt.claims', json_build_object('sub', :'w_owner_id', 'role', 'authenticated')::text, false) \gset
set role authenticated;
select leave_session(:'w_session_id', :'w_player_id');
reset role;
select set_config('request.jwt.claims', '', false) \gset
select case when not exists (select 1 from sessions where id = :'w_session_id')
  then 'PASS: Tic-Tac-Toe host leaving the lobby closes it' else 'FAIL: the lobby is still there' end;

set role anon;
select * from create_session(p_display_name => 'Pia') \gset iw_
select player_id from join_session(:'iw_code', 'Quin') \gset iw_q_
select leave_session(:'iw_session_id', :'iw_q_player_id');
reset role;
select case when count(*) = 1 then 'PASS: Imposter player leaving the lobby gives up the seat'
       else 'FAIL: ' || count(*) || ' seats' end
from players where session_id = :'iw_session_id';

set role anon;
select leave_session(:'iw_session_id', :'iw_player_id');
reset role;
select case when not exists (select 1 from sessions where id = :'iw_session_id')
  then 'PASS: Imposter host leaving the lobby closes it' else 'FAIL: the lobby is still there' end;

set role anon;
do $$ begin
  perform give_up_seat(gen_random_uuid(), gen_random_uuid());
  raise notice 'FAIL: anon called give_up_seat';
exception when insufficient_privilege then raise notice 'PASS: give_up_seat is internal';
end $$;
do $$ begin
  perform imposter_leave_in_play(gen_random_uuid(), gen_random_uuid());
  raise notice 'FAIL: anon called imposter_leave_in_play';
exception when insufficient_privilege then raise notice 'PASS: imposter_leave_in_play is internal';
end $$;
reset role;

\echo '=== 0008 done ==='
