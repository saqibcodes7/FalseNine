-- ============================================================================
-- Smoke tests for migration 0002 (difficulty).
--
-- Run against a THROWAWAY database, after 0001_init, 0002_difficulty and
-- 0001_smoke (which leaves the database empty again):
--
--   psql "$DATABASE_URL" -f supabase/tests/0002_smoke.sql
--
-- Every check prints PASS or FAIL. Scan for FAIL.
-- ============================================================================

\pset pager off

\echo '=== 1. a new lobby defaults to casual ==='
set role anon;
select * from create_session('Saqib') \gset host_
reset role;
select case when difficulty = 'casual' then 'PASS: default is casual' else 'FAIL: default is ' || difficulty end
from sessions where id = :'host_session_id';

\echo '=== 2. the host can pick a harder mode, and the pack with it ==='
set role anon;
select update_session_settings(:'host_session_id', :'host_player_id', 'world_cup', 'you_know_ball', null, null, null, null);
reset role;
select case when (player_pack, difficulty) = ('world_cup', 'you_know_ball')
  then 'PASS: pack and difficulty saved together'
  else 'FAIL: got ' || player_pack || ' / ' || difficulty end
from sessions where id = :'host_session_id';

\echo '=== 3. nulls leave the difficulty alone (partial saves are fine) ==='
set role anon;
select update_session_settings(:'host_session_id', :'host_player_id', null, null, 2, null, null, null);
reset role;
select case when difficulty = 'you_know_ball' and num_imposters = 2
  then 'PASS: difficulty untouched by an unrelated change'
  else 'FAIL: difficulty became ' || difficulty end
from sessions where id = :'host_session_id';

\echo '=== 4. a made-up mode is rejected by the constraint ==='
set role anon;
do $$ begin
  perform update_session_settings(
    (select id from sessions limit 1),
    (select host_player_id from sessions limit 1),
    null, 'impossible', null, null, null, null);
  raise notice 'FAIL: unknown difficulty accepted';
exception when check_violation then raise notice 'PASS: %', sqlerrm;
end $$;
reset role;

\echo '=== 5. create_session rejects a made-up mode too ==='
set role anon;
do $$ begin
  perform create_session('Amir', 'premier_league', 'legend');
  raise notice 'FAIL: unknown difficulty accepted on create';
exception when check_violation then raise notice 'PASS: %', sqlerrm;
end $$;
reset role;

\echo '=== 6. anon can read the difficulty (the waiting room shows it) ==='
set role anon;
select code, player_pack, difficulty from sessions;
reset role;

\echo '=== 7. only one overload of each RPC exists (supabase-js needs this) ==='
select proname, count(*) as overloads,
       case when count(*) = 1 then 'PASS' else 'FAIL: ambiguous' end as verdict
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('create_session', 'update_session_settings')
group by proname order by proname;

\echo '=== cleanup ==='
set role anon;
select leave_session(:'host_session_id', :'host_player_id');
reset role;
select count(*) as sessions_left from sessions;
