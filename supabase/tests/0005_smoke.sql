-- ============================================================================
-- Smoke tests for migration 0005 (play again, automatic salvage).
--
-- Run against a THROWAWAY database, after all five migrations:
--
--   psql "$DATABASE_URL" -f supabase/tests/0005_smoke.sql
--
-- Every check prints PASS or FAIL. Scan for FAIL.
-- ============================================================================

\pset pager off
\set ON_ERROR_STOP on

delete from sessions;

create or replace function pg_temp.role_of(p_player uuid)
returns text language sql as $$
  select role from player_secrets where player_id = p_player
$$;

-- Wind the discussion clock down. Owner only: the browser cannot write rows.
create or replace function pg_temp.end_discussion(p_session uuid)
returns void language sql as $$
  update rounds set ends_at = now() - interval '1 second'
  where session_id = p_session and phase = 'discussion'
    and round_number = (select current_round from sessions where id = p_session);
$$;

-- Everyone still in votes for one player. Run as anon, the way phones do.
create or replace function pg_temp.vote_out(p_session uuid, p_target uuid)
returns void language plpgsql as $$
declare v_voter uuid;
begin
  perform tick(p_session);
  for v_voter in
    select id from players where session_id = p_session and is_active and id <> p_target
  loop
    exit when (select status from sessions where id = p_session) <> 'voting';
    perform cast_vote(p_session, v_voter, p_target, false);
  end loop;
end $$;

-- ============================================================================
\echo '=== GAME 1: the last imposter out opens the salvage without the host ==='
-- ============================================================================
set role anon;
select * from create_session(p_display_name => 'Saqib', p_num_imposters => 1, p_discussion_seconds => 60) \gset g1_
select player_id as b from join_session(:'g1_code', 'Bea') \gset g1_
select player_id as c from join_session(:'g1_code', 'Cal') \gset g1_
select start_game(:'g1_session_id', :'g1_player_id', array['Pelé','Zico','Sócrates']);
select advance_peeking(:'g1_session_id', :'g1_player_id');
reset role;

-- Find the imposter and have the other two vote them out.
select p.id as imp from players p join player_secrets s on s.player_id = p.id
where p.session_id = :'g1_session_id' and s.role = 'imposter' limit 1 \gset g1_
select pg_temp.end_discussion(:'g1_session_id');
set role anon;
select pg_temp.vote_out(:'g1_session_id', :'g1_imp');
reset role;

\echo '--- 1. the reveal still happens, and now it carries its own clock ---'
select case when status = 'reveal' and reveal_ends_at is not null
  then 'PASS: reveal armed, table gets to see it' else 'FAIL: ' || status || ' ' || coalesce(reveal_ends_at::text,'null') end
from sessions where id = :'g1_session_id';
select case when reveal_ends_at between now() + interval '7 seconds' and now() + interval '11 seconds'
  then 'PASS: about ten seconds' else 'FAIL: ' || reveal_ends_at end
from sessions where id = :'g1_session_id';

\echo '--- 2. nobody has to press anything; an early tick does nothing ---'
set role anon;
select case when tick(:'g1_session_id') = 'reveal' then 'PASS: an early tick is ignored' else 'FAIL' end;
reset role;

\echo '--- 3. when the clock runs out the imposter gets the guess ---'
update sessions set reveal_ends_at = now() - interval '1 second' where id = :'g1_session_id';
set role anon;
select case when tick(:'g1_session_id') = 'salvage' then 'PASS: salvage opened by itself' else 'FAIL' end;
reset role;
select case when salvage_player_id = :'g1_imp' and reveal_ends_at is null
  then 'PASS: the guess belongs to the imposter who was caught' else 'FAIL' end
from sessions where id = :'g1_session_id';

\echo '--- 4. the guess still works, and still ends the game ---'
set role anon;
select case when salvage_guess(:'g1_session_id', :'g1_imp', 'Nobody Atall') = false then 'PASS: wrong guess rejected' else 'FAIL' end;
reset role;
select case when status = 'ended' and winner = 'civilians' then 'PASS: civilians win' else 'FAIL: ' || status end
from sessions where id = :'g1_session_id';

-- ============================================================================
\echo '=== GAME 1 continued: play again ==='
-- ============================================================================
\echo '--- 5. a non-host cannot restart ---'
set role anon;
do $$ begin
  perform play_again((select id from sessions limit 1), (select id from players where display_name = 'Bea'));
  raise notice 'FAIL: a non-host restarted the game';
exception when insufficient_privilege then raise notice 'PASS: %', sqlerrm;
end $$;

\echo '--- 6. the host restarts into the same lobby ---'
select play_again(:'g1_session_id', :'g1_player_id');
reset role;
select case when status = 'waiting' and current_round = 1 and code = :'g1_code'
  then 'PASS: back in the lobby, same code' else 'FAIL: ' || status || ' ' || code end
from sessions where id = :'g1_session_id';
select case when winner is null and revealed_target is null and salvage_player_id is null
  and salvage_guess is null and salvage_correct is null and started_at is null and ended_at is null
  then 'PASS: last game''s result wiped' else 'FAIL' end
from sessions where id = :'g1_session_id';
select case when count(*) = 3 then 'PASS: all three players back and active' else 'FAIL: ' || count(*) end
from players where session_id = :'g1_session_id' and is_active
  and not has_peeked and not vote_ready and revealed_role is null and eliminated_in_round is null;
select case when (select count(*) from rounds where session_id = :'g1_session_id') = 0
  and (select count(*) from votes where session_id = :'g1_session_id') = 0
  and (select count(*) from session_secrets where session_id = :'g1_session_id') = 0
  and (select count(*) from player_secrets s join players p on p.id = s.player_id
       where p.session_id = :'g1_session_id' and s.role is not null) = 0
  then 'PASS: rounds, votes and every secret cleared' else 'FAIL' end;

\echo '--- 7. a new player can join the restarted lobby ---'
set role anon;
select player_id as d from join_session(:'g1_code', 'Dee') \gset g1_
reset role;
select case when count(*) = 4 then 'PASS: four in the lobby now' else 'FAIL: ' || count(*) end
from players where session_id = :'g1_session_id';

\echo '--- 8. and the whole game plays again from the same lobby ---'
set role anon;
select start_game(:'g1_session_id', :'g1_player_id', array['Pelé','Zico','Sócrates','Garrincha']);
select advance_peeking(:'g1_session_id', :'g1_player_id');
reset role;
select case when status = 'discussion' and current_round = 1
  then 'PASS: second game running in the same lobby' else 'FAIL: ' || status end
from sessions where id = :'g1_session_id';
select case when count(*) = 1 then 'PASS: roles dealt again' else 'FAIL: ' || count(*) || ' imposters' end
from players p join player_secrets s on s.player_id = p.id
where p.session_id = :'g1_session_id' and s.role = 'imposter';

\echo '--- 9. you cannot restart a game that is still going ---'
set role anon;
do $$ begin
  perform play_again((select id from sessions limit 1), (select host_player_id from sessions limit 1));
  raise notice 'FAIL: restarted a running game';
exception when check_violation then raise notice 'PASS: %', sqlerrm;
end $$;
reset role;

-- ============================================================================
\echo '=== GAME 2: a civilian voted out still waits for the host ==='
-- ============================================================================
set role anon;
select * from create_session(p_display_name => 'Host', p_num_imposters => 1, p_discussion_seconds => 60) \gset g2_
select player_id as b from join_session(:'g2_code', 'Eve') \gset g2_
select player_id as c from join_session(:'g2_code', 'Fay') \gset g2_
select player_id as d from join_session(:'g2_code', 'Gil') \gset g2_
select player_id as e from join_session(:'g2_code', 'Hal') \gset g2_
select start_game(:'g2_session_id', :'g2_player_id', array['Pelé','Zico','Sócrates']);
select advance_peeking(:'g2_session_id', :'g2_player_id');
reset role;

select p.id as civ from players p join player_secrets s on s.player_id = p.id
where p.session_id = :'g2_session_id' and s.role = 'civilian' limit 1 \gset g2_
select pg_temp.end_discussion(:'g2_session_id');
set role anon;
select pg_temp.vote_out(:'g2_session_id', :'g2_civ');
reset role;

\echo '--- 10. no clock on an ordinary reveal ---'
select case when status = 'reveal' and reveal_ends_at is null
  then 'PASS: the host still sets the pace between rounds' else 'FAIL: ' || status || ' ' || coalesce(reveal_ends_at::text,'null') end
from sessions where id = :'g2_session_id';
set role anon;
select case when tick(:'g2_session_id') = 'reveal' then 'PASS: tick leaves it alone' else 'FAIL' end;

\echo '--- 11. the host still moves it on, as before ---'
select continue_round(:'g2_session_id', :'g2_player_id');
reset role;
select case when status = 'discussion' and current_round = 2
  then 'PASS: round 2 under way' else 'FAIL: ' || status end
from sessions where id = :'g2_session_id';

\echo '--- 12. the host can still cut the salvage wait short ---'
select p.id as imp from players p join player_secrets s on s.player_id = p.id
where p.session_id = :'g2_session_id' and s.role = 'imposter' limit 1 \gset g2_
select pg_temp.end_discussion(:'g2_session_id');
set role anon;
select pg_temp.vote_out(:'g2_session_id', :'g2_imp');
reset role;
select case when status = 'reveal' and reveal_ends_at is not null then 'PASS: armed again' else 'FAIL: ' || status end
from sessions where id = :'g2_session_id';
set role anon;
select continue_round(:'g2_session_id', :'g2_player_id');
reset role;
select case when status = 'salvage' and reveal_ends_at is null
  then 'PASS: host went early, clock cleared' else 'FAIL: ' || status end
from sessions where id = :'g2_session_id';

\echo '--- 13. resolve_reveal is not reachable from the browser ---'
set role anon;
do $$ begin
  perform resolve_reveal((select id from sessions limit 1));
  raise notice 'FAIL: anon called resolve_reveal';
exception when insufficient_privilege then raise notice 'PASS: %', sqlerrm;
end $$;
reset role;

-- ============================================================================
\echo '=== GAME 3: leaving after full time gives up the seat ==='
-- ============================================================================
set role anon;
select * from create_session(p_display_name => 'Owner') \gset g3_
select player_id as b from join_session(:'g3_code', 'Ida') \gset g3_
select player_id as c from join_session(:'g3_code', 'Jon') \gset g3_
select start_game(:'g3_session_id', :'g3_player_id', array['Pelé','Zico','Sócrates']);
reset role;
select end_game(:'g3_session_id', 'civilians');

\echo '--- 14. a player leaving at full time is not carried into the next game ---'
set role anon;
select leave_session(:'g3_session_id', :'g3_b');
reset role;
select case when count(*) = 2 then 'PASS: Ida gave up her seat' else 'FAIL: ' || count(*) || ' players left' end
from players where session_id = :'g3_session_id';
set role anon;
select play_again(:'g3_session_id', :'g3_player_id');
reset role;
select case when (select count(*) from players where session_id = :'g3_session_id') = 2
  and (select status from sessions where id = :'g3_session_id') = 'waiting'
  then 'PASS: the restarted lobby holds only who is still there' else 'FAIL' end;

\echo '--- 15. the host closing the lobby at full time really closes it ---'
select end_game(:'g3_session_id', 'civilians');
set role anon;
select leave_session(:'g3_session_id', :'g3_player_id');
reset role;
select case when count(*) = 0 then 'PASS: lobby gone' else 'FAIL: it is still there' end
from sessions where id = :'g3_session_id';
select case when count(*) = 0 then 'PASS: its players went with it' else 'FAIL: ' || count(*) || ' orphans' end
from players where session_id = :'g3_session_id';

\echo '=== done. Scan the output above for FAIL. ==='
