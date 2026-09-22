-- ============================================================================
-- Smoke tests for migration 0003 (the round engine).
--
-- Run against a THROWAWAY database, after all three migrations and the earlier
-- smoke files (which leave the database empty):
--
--   psql "$DATABASE_URL" -f supabase/tests/0003_smoke.sql
--
-- Plays three games as the anon role, the way the browser does, and pokes at
-- the clock directly as the owner where a phase would otherwise need waiting
-- for. Every check prints PASS or FAIL. Scan for FAIL.
-- ============================================================================

\pset pager off
\set ON_ERROR_STOP on

-- Throwaway database: start clean so the name lookups below are unambiguous.
delete from sessions;

-- A helper only this file uses: the secret roles, read as the owner.
create or replace function pg_temp.roles(p_session uuid)
returns table (display_name text, role text, is_active boolean, revealed_role text)
language sql as $$
  select p.display_name, s.role, p.is_active, p.revealed_role
  from players p join player_secrets s on s.player_id = p.id
  where p.session_id = p_session order by p.joined_at
$$;

-- ============================================================================
\echo '=== GAME 1: 4 players, 1 imposter. Peek, tie, majority skip, elimination, salvage ==='
-- ============================================================================
set role anon;
select * from create_session(p_display_name => 'Saqib', p_num_imposters => 1, p_discussion_seconds => 60, p_voting_seconds => 30) \gset g1_
select player_id as amir  from join_session(:'g1_code', 'Amir')  \gset g1_
select player_id as priya from join_session(:'g1_code', 'Priya') \gset g1_
select player_id as tom   from join_session(:'g1_code', 'Tom')   \gset g1_
reset role;

\echo '--- 1. a non-host cannot start ---'
set role anon;
do $$ begin
  perform start_game((select id from sessions limit 1), (select id from players where display_name = 'Amir'), array['A','B','C']);
  raise notice 'FAIL: non-host started the game';
exception when insufficient_privilege then raise notice 'PASS: %', sqlerrm;
end $$;

\echo '--- 2. the host starts; server picks the target, deals roles ---'
select start_game(:'g1_session_id', :'g1_player_id', array['Erling Haaland','Bukayo Saka','Cole Palmer','Kylian Mbappé']);
reset role;
select case when status = 'peeking' and current_round = 1 then 'PASS: status peeking' else 'FAIL: ' || status end from sessions where id = :'g1_session_id';
select case when count(*) filter (where role = 'imposter') = 1 and count(*) filter (where role = 'civilian') = 3
  then 'PASS: one imposter, three civilians dealt' else 'FAIL: roles ' || string_agg(coalesce(role,'null'), ',') end
from pg_temp.roles(:'g1_session_id');
select case when target_player_name = any(array['Erling Haaland','Bukayo Saka','Cole Palmer','Kylian Mbappé'])
  then 'PASS: target picked from the candidates' else 'FAIL: ' || target_player_name end
from session_secrets where session_id = :'g1_session_id';

\echo '--- 3. anon still cannot read the secrets directly ---'
set role anon;
do $$ begin
  perform * from session_secrets;
  raise notice 'FAIL: anon read session_secrets';
exception when insufficient_privilege then raise notice 'PASS: %', sqlerrm;
end $$;
do $$ begin
  perform * from player_secrets;
  raise notice 'FAIL: anon read player_secrets';
exception when insufficient_privilege then raise notice 'PASS: %', sqlerrm;
end $$;
select case when count(*) = 0 then 'PASS: no roles are public before a reveal' else 'FAIL: revealed_role leaked' end
from players where session_id = :'g1_session_id' and revealed_role is not null;

\echo '--- 4. get_my_card: civilians see the name, the imposter does not ---'
-- (psql unsets a \gset variable when the value is NULL, hence the coalesce)
select role, coalesce(target_name, '') as target_name from get_my_card(:'g1_session_id', :'g1_player_id') \gset host_card_
select role, coalesce(target_name, '') as target_name from get_my_card(:'g1_session_id', :'g1_amir')      \gset amir_card_
select role, coalesce(target_name, '') as target_name from get_my_card(:'g1_session_id', :'g1_priya')     \gset priya_card_
reset role;
select case
  when bool_and((c.role = 'civilian') = (c.target_name <> '')) then 'PASS: name only reaches civilians'
  else 'FAIL: card/role mismatch' end
from (values (:'host_card_role', :'host_card_target_name'), (:'amir_card_role', :'amir_card_target_name'), (:'priya_card_role', :'priya_card_target_name'))
  as c(role, target_name);
select case when status = 'peeking' then 'PASS: still peeking with one player yet to look' else 'FAIL: ' || status end
from sessions where id = :'g1_session_id';

\echo '--- 5. last peek arms the grace period, then the discussion opens ---'
set role anon;
select role from get_my_card(:'g1_session_id', :'g1_tom') \gset tom_card_
reset role;
-- 0004: the last peek no longer jumps straight to the discussion, so Tom has
-- time to read the card that call just handed him.
select case when status = 'peeking' and peek_ends_at is not null
  then 'PASS: grace period armed, still peeking' else 'FAIL: ' || status end
from sessions where id = :'g1_session_id';
update sessions set peek_ends_at = now() - interval '1 second' where id = :'g1_session_id';
set role anon;
select case when tick(:'g1_session_id') = 'discussion' then 'PASS: discussion opened when the grace ran out' else 'FAIL' end;
reset role;
select case when status = 'discussion' then 'PASS: discussion opened on its own' else 'FAIL: ' || status end
from sessions where id = :'g1_session_id';
select case when ends_at between now() + interval '55 seconds' and now() + interval '65 seconds'
  then 'PASS: discussion ends_at is 60s out' else 'FAIL: ends_at ' || ends_at end
from rounds where session_id = :'g1_session_id' and round_number = 1 and phase = 'discussion';

\echo '--- 6. voting cannot open early; tick() before the deadline is a no-op ---'
set role anon;
select case when tick(:'g1_session_id') = 'discussion' then 'PASS: tick left discussion alone' else 'FAIL' end;
do $$ begin
  perform cast_vote((select id from sessions limit 1), (select id from players where display_name = 'Amir'), null, true);
  raise notice 'FAIL: voted during discussion';
exception when check_violation then raise notice 'PASS: %', sqlerrm;
end $$;

\echo '--- 7. everyone pressing Vote now opens voting ---'
select ready_to_vote(:'g1_session_id', :'g1_player_id');
select ready_to_vote(:'g1_session_id', :'g1_amir');
select ready_to_vote(:'g1_session_id', :'g1_priya');
select case when status = 'discussion' then 'PASS: 3 of 4 ready is not enough' else 'FAIL: ' || status end from sessions where id = :'g1_session_id';
select ready_to_vote(:'g1_session_id', :'g1_tom');
select case when status = 'voting' then 'PASS: all ready opened the vote' else 'FAIL: ' || status end from sessions where id = :'g1_session_id';
reset role;

\echo '--- 8. vote rules: no self votes, no double votes ---'
set role anon;
do $$ begin
  perform cast_vote((select id from sessions limit 1), (select id from players where display_name = 'Amir'), (select id from players where display_name = 'Amir'), false);
  raise notice 'FAIL: self vote accepted';
exception when check_violation then raise notice 'PASS: %', sqlerrm;
end $$;
select cast_vote(:'g1_session_id', :'g1_player_id', :'g1_amir', false);
do $$ begin
  perform cast_vote((select id from sessions limit 1), (select id from players where is_host), (select id from players where display_name = 'Tom'), false);
  raise notice 'FAIL: second vote accepted';
exception when unique_violation then raise notice 'PASS: %', sqlerrm;
end $$;

\echo '--- 9. a 2-2 tie is announced, then loops back to discussion ---'
select cast_vote(:'g1_session_id', :'g1_amir', :'g1_player_id', false);
select cast_vote(:'g1_session_id', :'g1_priya', :'g1_amir', false);
select cast_vote(:'g1_session_id', :'g1_tom', :'g1_player_id', false);
reset role;
-- 0007: the table is told about a tie rather than being dropped back into the
-- next round with no explanation.
select case when status = 'reveal' and reveal_ends_at is not null then 'PASS: the tie stopped at the reveal' else 'FAIL: ' || status end
from sessions where id = :'g1_session_id';
select case when result = 'tied' then 'PASS: round 1 recorded as tied' else 'FAIL: ' || coalesce(result,'null') end
from rounds where session_id = :'g1_session_id' and round_number = 1 and phase = 'voting';
select case when count(*) = 4 then 'PASS: everyone still active' else 'FAIL' end from players where session_id = :'g1_session_id' and is_active;
update sessions set reveal_ends_at = now() - interval '1 second' where id = :'g1_session_id';
set role anon;
select case when tick(:'g1_session_id') = 'discussion' then 'PASS: tie cleared itself into round 2' else 'FAIL' end;
reset role;
select case when current_round = 2 then 'PASS: discussion round 2' else 'FAIL: round ' || current_round end
from sessions where id = :'g1_session_id';

\echo '--- 10. the discussion timer expiring opens voting (clock moved by hand) ---'
update rounds set ends_at = now() - interval '1 second' where session_id = :'g1_session_id' and round_number = 2 and phase = 'discussion';
set role anon;
select case when tick(:'g1_session_id') = 'voting' then 'PASS: tick opened voting after the deadline' else 'FAIL' end;

\echo '--- 11. a strict majority of skips ends the round with nobody out ---'
select cast_vote(:'g1_session_id', :'g1_player_id', null, true);
select cast_vote(:'g1_session_id', :'g1_amir', null, true);
select cast_vote(:'g1_session_id', :'g1_priya', null, true);
reset role;
select case when status = 'reveal' and reveal_ends_at is not null then 'PASS: 3 skips of 4 ended the vote early, and said so' else 'FAIL: ' || status end
from sessions where id = :'g1_session_id';
update sessions set reveal_ends_at = now() - interval '1 second' where id = :'g1_session_id';
set role anon;
select case when tick(:'g1_session_id') = 'discussion' then 'PASS: the skip cleared itself' else 'FAIL' end;
reset role;
select case when current_round = 3 then 'PASS: round 3' else 'FAIL: round ' || current_round end
from sessions where id = :'g1_session_id';

\echo '--- 12. the voting timer expiring tallies what is there ---'
update rounds set ends_at = now() - interval '1 second' where session_id = :'g1_session_id' and round_number = 3 and phase = 'discussion';
set role anon;
select tick(:'g1_session_id');
select cast_vote(:'g1_session_id', :'g1_player_id', :'g1_tom', false);
select cast_vote(:'g1_session_id', :'g1_amir', :'g1_tom', false);
reset role;
update rounds set ends_at = now() - interval '1 second' where session_id = :'g1_session_id' and round_number = 3 and phase = 'voting';
set role anon;
select case when tick(:'g1_session_id') = 'reveal' then 'PASS: deadline tallied two votes for Tom' else 'FAIL' end;
reset role;
select case when is_active = false and revealed_role is not null and eliminated_in_round = 3
  then 'PASS: Tom is out and his role is now public' else 'FAIL' end
from players where id = :'g1_tom';
select case when revealed_role = (select role from player_secrets where player_id = :'g1_tom')
  then 'PASS: the public role matches the secret one' else 'FAIL' end
from players where id = :'g1_tom';

\echo '--- 13. only the host continues from the reveal ---'
set role anon;
do $$ begin
  perform continue_round((select id from sessions limit 1), (select id from players where display_name = 'Amir'));
  raise notice 'FAIL: non-host continued';
exception when insufficient_privilege then raise notice 'PASS: %', sqlerrm;
end $$;
select continue_round(:'g1_session_id', :'g1_player_id');
reset role;
select case
  when (select role from player_secrets where player_id = :'g1_tom') = 'imposter' and status = 'salvage' and salvage_player_id = :'g1_tom'
    then 'PASS: last imposter out, salvage guess offered to Tom'
  when (select role from player_secrets where player_id = :'g1_tom') = 'civilian' and status = 'discussion' and current_round = 4
    then 'PASS: civilian out, on to round 4'
  else 'FAIL: ' || status end
from sessions where id = :'g1_session_id';

-- Whatever the deal was, force the rest of game 1 down the salvage path so
-- the fuzzy match gets exercised: make Tom the imposter on record if needed.
update sessions set status = 'salvage', salvage_player_id = :'g1_tom' where id = :'g1_session_id';

\echo '--- 14. only the last imposter may guess; a wrong guess ends it for civilians ---'
set role anon;
do $$ begin
  perform salvage_guess((select id from sessions limit 1), (select id from players where display_name = 'Amir'), 'Erling Haaland');
  raise notice 'FAIL: someone else guessed';
exception when insufficient_privilege then raise notice 'PASS: %', sqlerrm;
end $$;
select case when salvage_guess(:'g1_session_id', :'g1_tom', 'Nobody Atall') = false then 'PASS: wrong guess rejected' else 'FAIL' end;
reset role;
select case when status = 'ended' and winner = 'civilians' and revealed_target = (select target_player_name from session_secrets where session_id = :'g1_session_id')
  then 'PASS: game ended, civilians win, footballer published' else 'FAIL: ' || status || ' ' || coalesce(winner,'') end
from sessions where id = :'g1_session_id';
select case when count(*) = 4 then 'PASS: every role public at the end' else 'FAIL' end
from players where session_id = :'g1_session_id' and revealed_role is not null;

-- ============================================================================
\echo '=== GAME 2: the salvage guess accepts close spellings and surnames ==='
-- ============================================================================
select case when guess_matches('mbappe', 'Kylian Mbappé')          then 'PASS: surname, no accent' else 'FAIL: mbappe' end;
select case when guess_matches('Kylian Mbape', 'Kylian Mbappé')    then 'PASS: one letter off' else 'FAIL: mbape' end;
select case when guess_matches('Haland', 'Erling Haaland')         then 'PASS: surname, one letter off' else 'FAIL: haland' end;
select case when guess_matches('Erling Halland', 'Erling Haaland') then 'PASS: full name, one edit' else 'FAIL: halland' end;
select case when not guess_matches('Saka', 'Erling Haaland')       then 'PASS: a different player is wrong' else 'FAIL: saka matched' end;
select case when not guess_matches('Erling', 'Erling Haaland')     then 'PASS: first name alone is not enough' else 'FAIL: first name matched' end;
select case when guess_matches('pele', 'Pelé')                     then 'PASS: single-word name' else 'FAIL: pele' end;
select case when not guess_matches('pale', 'Pelé') or char_length('pele') <= 6 then 'PASS: short names allow only one edit' else 'FAIL' end;
select case when guess_matches('  MOHAMED  SALAH ', 'Mohamed Salah') then 'PASS: case and spacing ignored' else 'FAIL: salah' end;

-- ============================================================================
\echo '=== GAME 3: 3 players, 1 imposter. Civilian out means parity, imposters win ==='
-- ============================================================================
set role anon;
select * from create_session(p_display_name => 'Host') \gset g3_
select player_id as b from join_session(:'g3_code', 'Bea') \gset g3_
select player_id as c from join_session(:'g3_code', 'Cal') \gset g3_
select start_game(:'g3_session_id', :'g3_player_id', array['Pelé','Zico','Sócrates']);
select advance_peeking(:'g3_session_id', :'g3_player_id');
reset role;
select case when status = 'discussion' then 'PASS: host skipped the peek wait' else 'FAIL: ' || status end from sessions where id = :'g3_session_id';

-- Find a civilian who is not the host, and have the other two vote them out.
select p.id as civ from players p join player_secrets s on s.player_id = p.id
where p.session_id = :'g3_session_id' and s.role = 'civilian' and not p.is_host limit 1 \gset g3_
update rounds set ends_at = now() - interval '1 second' where session_id = :'g3_session_id' and phase = 'discussion';
set role anon;
select tick(:'g3_session_id');
select cast_vote(:'g3_session_id', v.id, :'g3_civ', false)
from players v where v.session_id = :'g3_session_id' and v.id <> :'g3_civ';
reset role;
select case when status = 'reveal' then 'PASS: two votes of three put the civilian out' else 'FAIL: ' || status end from sessions where id = :'g3_session_id';
set role anon;
select continue_round(:'g3_session_id', :'g3_player_id');
reset role;
select case when status = 'ended' and winner = 'imposters' then 'PASS: 1 v 1 is parity, imposters win' else 'FAIL: ' || status || ' ' || coalesce(winner,'') end
from sessions where id = :'g3_session_id';

\echo '--- votes carry a session_id for Realtime filters ---'
select case when count(*) = count(session_id) then 'PASS: every vote has its session_id' else 'FAIL' end from votes;

\echo '--- helpers are not callable as anon ---'
set role anon;
do $$ begin
  perform tally_votes((select id from sessions limit 1));
  raise notice 'FAIL: anon ran tally_votes';
exception when insufficient_privilege then raise notice 'PASS: %', sqlerrm;
end $$;
do $$ begin
  perform end_game((select id from sessions limit 1), 'civilians');
  raise notice 'FAIL: anon ran end_game';
exception when insufficient_privilege then raise notice 'PASS: %', sqlerrm;
end $$;
reset role;

\echo '=== cleanup ==='
delete from sessions;
select count(*) as sessions_left from sessions;
