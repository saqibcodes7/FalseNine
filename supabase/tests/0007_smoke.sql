-- ============================================================================
-- Smoke tests for migration 0007 (tie announcement, no host-opened vote).
--
-- Run against a THROWAWAY database, after all seven migrations:
--
--   psql "$DATABASE_URL" -f supabase/tests/0007_smoke.sql
--
-- Every check prints PASS or FAIL. Scan for FAIL.
-- ============================================================================

\pset pager off
\set ON_ERROR_STOP on

delete from sessions;

create or replace function pg_temp.open_vote(p_session uuid)
returns void language plpgsql as $$
declare v_p uuid;
begin
  for v_p in select id from players where session_id = p_session and is_active loop
    perform ready_to_vote(p_session, v_p);
  end loop;
end $$;

-- ============================================================================
\echo '=== A drawn vote is announced, then clears itself ==='
-- ============================================================================
set role anon;
select * from create_session(
  p_display_name => 'Saqib', p_num_imposters => 1, p_discussion_seconds => 60) \gset g1_
select player_id as b from join_session(:'g1_code', 'Bea') \gset g1_
select player_id as c from join_session(:'g1_code', 'Cal') \gset g1_
select player_id as d from join_session(:'g1_code', 'Dee') \gset g1_
select start_game(:'g1_session_id', :'g1_player_id', array['Pelé','Zico','Sócrates']);
select advance_peeking(:'g1_session_id', :'g1_player_id');
select pg_temp.open_vote(:'g1_session_id');
reset role;

\echo '--- 1. two votes each for two players is a draw ---'
set role anon;
select cast_vote(:'g1_session_id', :'g1_player_id', :'g1_b', false);
select cast_vote(:'g1_session_id', :'g1_c',         :'g1_b', false);
select cast_vote(:'g1_session_id', :'g1_b',         :'g1_c', false);
select cast_vote(:'g1_session_id', :'g1_d',         :'g1_c', false);
reset role;
select case when status = 'reveal' then 'PASS: the draw stopped at the reveal' else 'FAIL: ' || status end
from sessions where id = :'g1_session_id';
select case when result = 'tied' then 'PASS: recorded as a tie' else 'FAIL: ' || coalesce(result, 'null') end
from rounds where session_id = :'g1_session_id' and round_number = 1 and phase = 'voting';

\echo '--- 2. nobody was eliminated by it ---'
select case when count(*) = 4 then 'PASS: everyone is still in' else 'FAIL: ' || count(*) end
from players where session_id = :'g1_session_id' and is_active;
select case when eliminated_player_id is null then 'PASS: nobody out' else 'FAIL' end
from rounds where session_id = :'g1_session_id' and round_number = 1 and phase = 'voting';

\echo '--- 3. the reveal carries a short clock of its own ---'
select case when reveal_ends_at between now() + interval '3 seconds' and now() + interval '7 seconds'
  then 'PASS: a few seconds to read it' else 'FAIL: ' || coalesce(reveal_ends_at::text, 'null') end
from sessions where id = :'g1_session_id';
set role anon;
select case when tick(:'g1_session_id') = 'reveal' then 'PASS: an early tick is ignored' else 'FAIL' end;
reset role;

\echo '--- 4. and the next round opens when it runs out, with nobody pressing ---'
update sessions set reveal_ends_at = now() - interval '1 second' where id = :'g1_session_id';
set role anon;
select case when tick(:'g1_session_id') = 'discussion' then 'PASS: round 2 opened by itself' else 'FAIL' end;
reset role;
select case when current_round = 2 and reveal_ends_at is null
  then 'PASS: round 2, clock cleared' else 'FAIL: round ' || current_round end
from sessions where id = :'g1_session_id';
select case when ends_at is not null then 'PASS: round 2 has its own discussion clock' else 'FAIL' end
from rounds where session_id = :'g1_session_id' and round_number = 2 and phase = 'discussion';

-- ============================================================================
\echo '=== The skips winning is announced the same way ==='
-- ============================================================================
set role anon;
select pg_temp.open_vote(:'g1_session_id');
select cast_vote(:'g1_session_id', :'g1_player_id', null, true);
select cast_vote(:'g1_session_id', :'g1_b',         null, true);
select cast_vote(:'g1_session_id', :'g1_c',         null, true);
reset role;

\echo '--- 5. three skips of four stops at the reveal too ---'
select case when status = 'reveal' and reveal_ends_at is not null
  then 'PASS: the skip was announced' else 'FAIL: ' || status end
from sessions where id = :'g1_session_id';
select case when result = 'skipped' then 'PASS: recorded as a skip' else 'FAIL: ' || coalesce(result, 'null') end
from rounds where session_id = :'g1_session_id' and round_number = 2 and phase = 'voting';

\echo '--- 6. it clears itself into round 3 ---'
update sessions set reveal_ends_at = now() - interval '1 second' where id = :'g1_session_id';
set role anon;
select case when tick(:'g1_session_id') = 'discussion' then 'PASS: round 3 opened by itself' else 'FAIL' end;
reset role;
select case when current_round = 3 then 'PASS: round 3' else 'FAIL: round ' || current_round end
from sessions where id = :'g1_session_id';

\echo '--- 7. an ordinary elimination still waits for the host, as before ---'
set role anon;
select pg_temp.open_vote(:'g1_session_id');
select cast_vote(:'g1_session_id', :'g1_player_id', :'g1_b', false);
select cast_vote(:'g1_session_id', :'g1_c',         :'g1_b', false);
select cast_vote(:'g1_session_id', :'g1_d',         :'g1_b', false);
reset role;
select case when status = 'reveal' then 'PASS: somebody was voted out' else 'FAIL: ' || status end
from sessions where id = :'g1_session_id';
select case when (select role from player_secrets where player_id = :'g1_b') = 'civilian'
  then (case when reveal_ends_at is null
             then 'PASS: a civilian out still waits for the host'
             else 'FAIL: armed a clock' end)
  else 'PASS: the imposter was out, so the salvage clock is right'
  end
from sessions where id = :'g1_session_id';

-- ============================================================================
\echo '=== The host can no longer open the vote ==='
-- ============================================================================
set role anon;
select * from create_session(
  p_display_name => 'Chair', p_num_imposters => 1,
  p_discussion_seconds => 0, p_voting_seconds => 0) \gset g2_
select player_id as b from join_session(:'g2_code', 'Fay') \gset g2_
select player_id as c from join_session(:'g2_code', 'Gus') \gset g2_
select start_game(:'g2_session_id', :'g2_player_id', array['Pelé','Zico','Sócrates']);
select advance_peeking(:'g2_session_id', :'g2_player_id');
reset role;

\echo '--- 8. even with no clock, the host cannot open the vote ---'
set role anon;
do $$ begin
  perform host_advance(
    (select id from sessions order by created_at desc limit 1),
    (select host_player_id from sessions order by created_at desc limit 1));
  raise notice 'FAIL: the host opened the vote';
exception when check_violation then raise notice 'PASS: %', sqlerrm;
end $$;
reset role;
select case when status = 'discussion' then 'PASS: still discussing' else 'FAIL: ' || status end
from sessions where id = :'g2_session_id';

\echo '--- 9. the table opens it by everyone being ready ---'
set role anon;
select ready_to_vote(:'g2_session_id', :'g2_player_id');
select ready_to_vote(:'g2_session_id', :'g2_b');
reset role;
select case when status = 'discussion' then 'PASS: two of three is not enough' else 'FAIL: ' || status end
from sessions where id = :'g2_session_id';
set role anon;
select ready_to_vote(:'g2_session_id', :'g2_c');
reset role;
select case when status = 'voting' then 'PASS: the last one ready opened it' else 'FAIL: ' || status end
from sessions where id = :'g2_session_id';

\echo '--- 10. and the host can still close an unlimited vote ---'
set role anon;
select host_advance(:'g2_session_id', :'g2_player_id');
reset role;
select case when status <> 'voting' then 'PASS: closed with no votes, counted as a skip' else 'FAIL' end
from sessions where id = :'g2_session_id';

\echo '=== done. Scan the output above for FAIL. ==='
