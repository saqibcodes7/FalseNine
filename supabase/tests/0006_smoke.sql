-- ============================================================================
-- Smoke tests for migration 0006 (clocks the host can turn off).
--
-- Run against a THROWAWAY database, after all six migrations:
--
--   psql "$DATABASE_URL" -f supabase/tests/0006_smoke.sql
--
-- Every check prints PASS or FAIL. Scan for FAIL.
-- ============================================================================

\pset pager off
\set ON_ERROR_STOP on

delete from sessions;

-- ============================================================================
\echo '=== Settings: zero is allowed, the old range still is, nonsense is not ==='
-- ============================================================================
set role anon;
select * from create_session(
  p_display_name => 'Saqib', p_num_imposters => 1,
  p_discussion_seconds => 0, p_voting_seconds => 0) \gset g1_
reset role;

\echo '--- 1. a lobby can be created with both clocks off ---'
select case when discussion_seconds = 0 and voting_seconds = 0
  then 'PASS: both clocks off' else 'FAIL: ' || discussion_seconds || '/' || voting_seconds end
from sessions where id = :'g1_session_id';

\echo '--- 2. the old range is still allowed ---'
set role anon;
select update_session_settings(:'g1_session_id', :'g1_player_id', null, null, null, null, null, 180, 60);
reset role;
select case when discussion_seconds = 180 and voting_seconds = 60
  then 'PASS: a timed lobby still works' else 'FAIL' end
from sessions where id = :'g1_session_id';

\echo '--- 3. values between zero and the minimum are still refused ---'
set role anon;
do $$ begin
  perform update_session_settings(
    (select id from sessions limit 1), (select host_player_id from sessions limit 1),
    null, null, null, null, null, 30, null);
  raise notice 'FAIL: a 30 second discussion was allowed';
exception when check_violation then raise notice 'PASS: %', sqlerrm;
end $$;
do $$ begin
  perform update_session_settings(
    (select id from sessions limit 1), (select host_player_id from sessions limit 1),
    null, null, null, null, null, null, 15);
  raise notice 'FAIL: a 15 second vote was allowed';
exception when check_violation then raise notice 'PASS: %', sqlerrm;
end $$;

\echo '--- 4. back to no limit for the rest of this file ---'
select update_session_settings(:'g1_session_id', :'g1_player_id', null, null, null, null, null, 0, 0);
select player_id as b from join_session(:'g1_code', 'Bea') \gset g1_
select player_id as c from join_session(:'g1_code', 'Cal') \gset g1_
select start_game(:'g1_session_id', :'g1_player_id', array['Pelé','Zico','Sócrates']);
select advance_peeking(:'g1_session_id', :'g1_player_id');
reset role;

-- ============================================================================
\echo '=== An unlimited discussion has no deadline and never expires ==='
-- ============================================================================
\echo '--- 5. the round opens with no ends_at ---'
select case when ends_at is null and started_at is not null
  then 'PASS: no deadline on the round' else 'FAIL: ends_at ' || coalesce(ends_at::text, 'null') end
from rounds where session_id = :'g1_session_id' and round_number = 1 and phase = 'discussion';

\echo '--- 6. tick() cannot end it, however long anyone waits ---'
set role anon;
select case when tick(:'g1_session_id') = 'discussion' then 'PASS: tick leaves it alone' else 'FAIL' end;
reset role;
-- Even with the clock wound far into the past, there is no clock to wind.
update rounds set started_at = now() - interval '2 hours'
where session_id = :'g1_session_id' and round_number = 1 and phase = 'discussion';
set role anon;
select case when tick(:'g1_session_id') = 'discussion' then 'PASS: still going two hours later' else 'FAIL' end;

\echo '--- 7. a non-host cannot force it on ---'
do $$ begin
  perform host_advance((select id from sessions limit 1), (select id from players where display_name = 'Bea'));
  raise notice 'FAIL: a non-host forced the phase on';
exception when insufficient_privilege then raise notice 'PASS: %', sqlerrm;
end $$;

\echo '--- 8. and since 0007, neither can the host: the table opens its own vote ---'
do $$ begin
  perform host_advance((select id from sessions limit 1), (select host_player_id from sessions limit 1));
  raise notice 'FAIL: the host opened the vote';
exception when check_violation then raise notice 'PASS: %', sqlerrm;
end $$;
select ready_to_vote(:'g1_session_id', :'g1_player_id');
select ready_to_vote(:'g1_session_id', :'g1_b');
select ready_to_vote(:'g1_session_id', :'g1_c');
reset role;
select case when status = 'voting' then 'PASS: the vote is open' else 'FAIL: ' || status end
from sessions where id = :'g1_session_id';
select case when ends_at is null
  then 'PASS: the vote has no deadline either' else 'FAIL: ' || ends_at end
from rounds where session_id = :'g1_session_id' and round_number = 1 and phase = 'voting';

\echo '--- 9. everyone pressing Vote now is still the normal way out ---'
-- (proved on the next round, below)

\echo '--- 10. the host closes the vote and what is there is counted ---'
select p.id as civ from players p join player_secrets s on s.player_id = p.id
where p.session_id = :'g1_session_id' and s.role = 'civilian' and not p.is_host limit 1 \gset g1_
set role anon;
select cast_vote(:'g1_session_id', :'g1_player_id', :'g1_civ', false);
select host_advance(:'g1_session_id', :'g1_player_id');
reset role;
select case when status in ('reveal', 'discussion', 'salvage', 'ended')
  then 'PASS: one vote was enough once the host closed it (' || status || ')' else 'FAIL: ' || status end
from sessions where id = :'g1_session_id';

-- ============================================================================
\echo '=== A timed phase is nobody''s to cut short ==='
-- ============================================================================
set role anon;
select * from create_session(
  p_display_name => 'Host', p_num_imposters => 1,
  p_discussion_seconds => 180, p_voting_seconds => 60) \gset g2_
select player_id as b from join_session(:'g2_code', 'Dee') \gset g2_
select player_id as c from join_session(:'g2_code', 'Eli') \gset g2_
select start_game(:'g2_session_id', :'g2_player_id', array['Pelé','Zico','Sócrates']);
select advance_peeking(:'g2_session_id', :'g2_player_id');
reset role;

\echo '--- 11. a timed discussion has a deadline ---'
select case when ends_at is not null then 'PASS: deadline set' else 'FAIL' end
from rounds where session_id = :'g2_session_id' and round_number = 1 and phase = 'discussion';

\echo '--- 12. and the host cannot skip it ---'
set role anon;
do $$ begin
  perform host_advance(
    (select id from sessions where code = (select code from sessions order by created_at desc limit 1)),
    (select host_player_id from sessions order by created_at desc limit 1));
  raise notice 'FAIL: the host cut a timed phase short';
exception when check_violation then raise notice 'PASS: %', sqlerrm;
end $$;
reset role;
select case when status = 'discussion' then 'PASS: still discussing' else 'FAIL: ' || status end
from sessions where id = :'g2_session_id';

\echo '--- 13. everyone pressing Vote now still opens it early ---'
set role anon;
select ready_to_vote(:'g2_session_id', :'g2_player_id');
select ready_to_vote(:'g2_session_id', :'g2_b');
select ready_to_vote(:'g2_session_id', :'g2_c');
reset role;
select case when status = 'voting' then 'PASS: the table opened the vote itself' else 'FAIL: ' || status end
from sessions where id = :'g2_session_id';

\echo '--- 14. and the clock still closes a timed vote ---'
update rounds set ends_at = now() - interval '1 second'
where session_id = :'g2_session_id' and round_number = 1 and phase = 'voting';
set role anon;
select case when tick(:'g2_session_id') <> 'voting' then 'PASS: the deadline closed it' else 'FAIL' end;
reset role;

\echo '=== done. Scan the output above for FAIL. ==='
