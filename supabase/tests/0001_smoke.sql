-- ============================================================================
-- Smoke tests for migration 0001.
--
-- Run against a THROWAWAY database, never your real project — it creates and
-- deletes lobbies and pokes at the secret tables directly.
--
--   psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
--   psql "$DATABASE_URL" -f supabase/migrations/0002_difficulty.sql
--   psql "$DATABASE_URL" -f supabase/migrations/0003_round_engine.sql
--   psql "$DATABASE_URL" -f supabase/tests/0001_smoke.sql
--
-- Runs against the full migration set. The settings RPCs have grown a
-- parameter per migration, so the calls below use named arguments.
--
-- Every check prints PASS or FAIL. Scan for FAIL.
-- ============================================================================

\pset pager off

-- Throwaway database: start clean, so the lookups below are unambiguous
-- however many of these files have already run.
delete from sessions;

\echo '=== 1. create_session as anon ==='
set role anon;
select * from create_session(p_display_name => 'Saqib', p_player_pack => 'premier_league', p_difficulty => 'casual',
  p_num_imposters => 1, p_ai_hints_enabled => true, p_discussion_seconds => 180, p_voting_seconds => 60) \gset host_
\echo 'session code:' :'host_code'
reset role;

\echo '=== 2. players join (code is case-insensitive, names are trimmed) ==='
set role anon;
select player_id from join_session(lower(:'host_code'), 'Amir')  \gset a_
select player_id from join_session(:'host_code', '  Priya  ')    \gset b_
select player_id from join_session(:'host_code', 'Tom')          \gset c_
reset role;
select display_name, is_host from players where session_id = :'host_session_id' order by joined_at;

\echo '=== 3. duplicate name rejected, case-insensitively ==='
set role anon;
do $$ begin
  perform join_session((select code from sessions limit 1), 'AMIR');
  raise notice 'FAIL: duplicate name was allowed';
exception when unique_violation then raise notice 'PASS: %', sqlerrm;
end $$;

\echo '=== 4. unknown code rejected ==='
do $$ begin
  perform join_session('ZZZZZ', 'Nobody');
  raise notice 'FAIL: unknown code was allowed';
exception when no_data_found then raise notice 'PASS: %', sqlerrm;
end $$;

\echo '=== 5. blank display name rejected ==='
do $$ begin
  perform join_session((select code from sessions limit 1), '   ');
  raise notice 'FAIL: blank name was allowed';
exception when check_violation then raise notice 'PASS: %', sqlerrm;
end $$;
reset role;

-- Plant secrets the way the game engine will in step 4.
insert into session_secrets (session_id, target_player_name)
  select id, 'Bukayo Saka' from sessions limit 1;
update player_secrets set role = 'imposter'
  where player_id = (select id from players where display_name = 'Amir');

\echo '=== 6. anon cannot read the target footballer ==='
set role anon;
do $$ begin
  perform * from session_secrets;
  raise notice 'FAIL: anon read session_secrets';
exception when insufficient_privilege then raise notice 'PASS: %', sqlerrm;
end $$;

\echo '=== 7. anon cannot read roles ==='
do $$ begin
  perform * from player_secrets;
  raise notice 'FAIL: anon read player_secrets';
exception when insufficient_privilege then raise notice 'PASS: %', sqlerrm;
end $$;

\echo '=== 8. anon cannot insert a player directly ==='
do $$ begin
  insert into players (session_id, display_name) values ((select id from sessions limit 1), 'Ghost');
  raise notice 'FAIL: anon inserted a player directly';
exception when insufficient_privilege then raise notice 'PASS: %', sqlerrm;
end $$;

\echo '=== 9. anon cannot change the session status by hand ==='
do $$ begin
  update sessions set status = 'ended';
  raise notice 'FAIL: anon updated sessions';
exception when insufficient_privilege then raise notice 'PASS: %', sqlerrm;
end $$;

\echo '=== 10. anon can read the lobby (the waiting room needs this) ==='
select code, status, num_imposters, discussion_seconds from sessions;
select display_name, is_host, is_active from players order by joined_at;
reset role;

select id from sessions limit 1 \gset s_
select id from players where is_host \gset h_

\echo '=== 11. host can change settings ==='
set role anon;
select update_session_settings(p_session_id => :'s_id', p_player_id => :'h_id', p_player_pack => 'world_cup',
  p_difficulty => 'ball_aware', p_num_imposters => 2, p_ai_hints_enabled => false, p_votes_visible => null,
  p_discussion_seconds => 240, p_voting_seconds => 45);
reset role;
select player_pack, difficulty, num_imposters, ai_hints_enabled, discussion_seconds, voting_seconds from sessions;

\echo '=== 12. a non-host cannot change settings ==='
set role anon;
do $$ begin
  perform update_session_settings(
    p_session_id => (select id from sessions limit 1),
    p_player_id => (select id from players where display_name = 'Amir'),
    p_player_pack => 'premier_league', p_difficulty => 'casual', p_num_imposters => 1,
    p_ai_hints_enabled => true, p_votes_visible => null, p_discussion_seconds => 300, p_voting_seconds => 90);
  raise notice 'FAIL: non-host changed settings';
exception when insufficient_privilege then raise notice 'PASS: %', sqlerrm;
end $$;

\echo '=== 13. out-of-range timers rejected ==='
do $$ begin
  perform update_session_settings(
    p_session_id => (select id from sessions limit 1), p_player_id => (select id from players where is_host),
    p_player_pack => 'world_cup', p_difficulty => 'ball_aware', p_num_imposters => 2,
    p_ai_hints_enabled => false, p_votes_visible => null, p_discussion_seconds => 30, p_voting_seconds => 45);
  raise notice 'FAIL: 30s discussion accepted';
exception when check_violation then raise notice 'PASS: discussion_seconds range enforced';
end $$;

\echo '=== 14. a player can leave and the seat frees up ==='
select leave_session((select id from sessions limit 1), (select id from players where display_name = 'Tom'));
reset role;
select display_name from players order by joined_at;

\echo '=== 15. nobody joins once the game is under way ==='
update sessions set status = 'peeking';
set role anon;
do $$ begin
  perform join_session((select code from sessions limit 1), 'Latecomer');
  raise notice 'FAIL: joined a running game';
exception when check_violation then raise notice 'PASS: %', sqlerrm;
end $$;
reset role;
update sessions set status = 'waiting';

\echo '=== 16. host leaving tears the lobby down, secrets cascade ==='
set role anon;
select leave_session((select id from sessions limit 1), (select id from players where is_host));
reset role;
select count(*) as sessions_left    from sessions;
select count(*) as players_left     from players;
select count(*) as orphan_secrets   from session_secrets;

\echo '=== 17. tables published to Realtime ==='
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' order by tablename;
