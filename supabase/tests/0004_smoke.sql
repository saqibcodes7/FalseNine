-- ============================================================================
-- Smoke tests for migration 0004 (peek grace period, working hints).
--
-- Run against a THROWAWAY database, after all four migrations:
--
--   psql "$DATABASE_URL" -f supabase/tests/0004_smoke.sql
--
-- Every check prints PASS or FAIL. Scan for FAIL.
-- ============================================================================

\pset pager off
\set ON_ERROR_STOP on

-- Throwaway database: start clean so the name lookups below are unambiguous.
delete from sessions;

create or replace function pg_temp.secrets(p_session uuid)
returns table (display_name text, role text, hint_text text)
language sql as $$
  select p.display_name, s.role, s.hint_text
  from players p join player_secrets s on s.player_id = p.id
  where p.session_id = p_session order by p.joined_at
$$;

-- ============================================================================
\echo '=== GAME 1: hints on. The imposter gets the clue, nobody else does ==='
-- ============================================================================
set role anon;
select * from create_session(p_display_name => 'Saqib', p_hints_enabled => true, p_num_imposters => 1) \gset g1_
select player_id as amir  from join_session(:'g1_code', 'Amir')  \gset g1_
select player_id as priya from join_session(:'g1_code', 'Priya') \gset g1_
select player_id as tom   from join_session(:'g1_code', 'Tom')   \gset g1_

select start_game(
  :'g1_session_id', :'g1_player_id',
  array['Erling Haaland','Bukayo Saka','Cole Palmer','Virgil van Dijk'],
  array['machine','humble','cold','aura']);
reset role;

\echo '--- 1. the clue stored matches the footballer drawn ---'
select case when (
    select count(*) from pg_temp.secrets(:'g1_session_id') s
    where s.role = 'imposter'
      and s.hint_text = (
        case (select target_player_name from session_secrets where session_id = :'g1_session_id')
          when 'Erling Haaland'  then 'machine'
          when 'Bukayo Saka'     then 'humble'
          when 'Cole Palmer'     then 'cold'
          when 'Virgil van Dijk' then 'aura'
        end)
  ) = 1
  then 'PASS: the imposter holds the drawn footballer''s clue'
  else 'FAIL: target ' || (select target_player_name from session_secrets where session_id = :'g1_session_id')
       || ' hint ' || coalesce((select hint_text from pg_temp.secrets(:'g1_session_id') where role = 'imposter'), 'null') end;

\echo '--- 2. civilians carry no clue at all ---'
select case when count(*) = 0 then 'PASS: no civilian row has a hint' else 'FAIL: ' || count(*) || ' civilians hold one' end
from pg_temp.secrets(:'g1_session_id') where role = 'civilian' and hint_text is not null;

\echo '--- 3. get_my_card gives the clue to the imposter and to nobody else ---'
select p.id as imp from players p join player_secrets s on s.player_id = p.id
where p.session_id = :'g1_session_id' and s.role = 'imposter' limit 1 \gset g1_
select p.id as civ from players p join player_secrets s on s.player_id = p.id
where p.session_id = :'g1_session_id' and s.role = 'civilian' limit 1 \gset g1_

set role anon;
select case when role = 'imposter' and target_name is null and hint_text is not null
  then 'PASS: imposter gets the clue, not the name' else 'FAIL: ' || role || ' ' || coalesce(target_name,'null') || ' ' || coalesce(hint_text,'null') end
from get_my_card(:'g1_session_id', :'g1_imp');

select case when role = 'civilian' and target_name is not null and hint_text is null
  then 'PASS: civilian gets the name, not the clue' else 'FAIL: ' || role || ' ' || coalesce(target_name,'null') || ' ' || coalesce(hint_text,'null') end
from get_my_card(:'g1_session_id', :'g1_civ');
reset role;

\echo '--- 4. the clue is not reachable from the browser any other way ---'
set role anon;
do $$ begin
  perform hint_text from player_secrets limit 1;
  raise notice 'FAIL: anon read player_secrets';
exception when insufficient_privilege then raise notice 'PASS: %', sqlerrm;
end $$;
reset role;

-- ============================================================================
\echo '=== GAME 2: the peek grace period ==='
-- ============================================================================
set role anon;
select * from create_session(p_display_name => 'Host', p_num_imposters => 1, p_discussion_seconds => 60) \gset g2_
select player_id as b from join_session(:'g2_code', 'Bea') \gset g2_
select player_id as c from join_session(:'g2_code', 'Cal') \gset g2_
select start_game(:'g2_session_id', :'g2_player_id', array['Pelé','Zico','Sócrates']);
reset role;

\echo '--- 5. nothing is armed until everyone has looked ---'
select case when peek_ends_at is null then 'PASS: no deadline at kick-off' else 'FAIL: armed early' end
from sessions where id = :'g2_session_id';

set role anon;
select role from get_my_card(:'g2_session_id', :'g2_player_id') \gset g2_host_card_
select role from get_my_card(:'g2_session_id', :'g2_b')         \gset g2_bea_card_
reset role;
select case when status = 'peeking' and peek_ends_at is null
  then 'PASS: still peeking, still unarmed with one to go' else 'FAIL: ' || status end
from sessions where id = :'g2_session_id';

\echo '--- 6. the last peek arms the clock rather than starting the discussion ---'
set role anon;
select role from get_my_card(:'g2_session_id', :'g2_c') \gset g2_cal_card_
reset role;
select case when status = 'peeking' then 'PASS: Cal is still reading, not in the discussion' else 'FAIL: ' || status end
from sessions where id = :'g2_session_id';
select case when peek_ends_at between now() + interval '5 seconds' and now() + interval '9 seconds'
  then 'PASS: grace period is about 8 seconds' else 'FAIL: ' || coalesce(peek_ends_at::text, 'null') end
from sessions where id = :'g2_session_id';

\echo '--- 7. tick() before the grace runs out does nothing ---'
set role anon;
select case when tick(:'g2_session_id') = 'peeking' then 'PASS: an early tick is ignored' else 'FAIL' end;
reset role;

\echo '--- 8. a second peek cannot push kick-off further away ---'
select peek_ends_at as armed from sessions where id = :'g2_session_id' \gset g2_
set role anon;
select role from get_my_card(:'g2_session_id', :'g2_b') \gset g2_bea_again_
reset role;
select case when peek_ends_at = :'g2_armed'::timestamptz then 'PASS: the deadline held' else 'FAIL: it moved' end
from sessions where id = :'g2_session_id';

\echo '--- 9. once it passes, the discussion opens with its own deadline ---'
update sessions set peek_ends_at = now() - interval '1 second' where id = :'g2_session_id';
set role anon;
select case when tick(:'g2_session_id') = 'discussion' then 'PASS: the grace ran out, discussion opened' else 'FAIL' end;
reset role;
select case when peek_ends_at is null then 'PASS: the peek deadline was cleared' else 'FAIL: still set' end
from sessions where id = :'g2_session_id';
select case when ends_at between now() + interval '55 seconds' and now() + interval '65 seconds'
  then 'PASS: discussion ends_at is 60s out' else 'FAIL: ' || ends_at end
from rounds where session_id = :'g2_session_id' and round_number = 1 and phase = 'discussion';

\echo '--- 10. the host can still cut the wait short ---'
set role anon;
select * from create_session(p_display_name => 'Host2') \gset g3_
select player_id as b from join_session(:'g3_code', 'Dee') \gset g3_
select player_id as c from join_session(:'g3_code', 'Eli') \gset g3_
select start_game(:'g3_session_id', :'g3_player_id', array['Pelé','Zico','Sócrates']);
select advance_peeking(:'g3_session_id', :'g3_player_id');
reset role;
select case when status = 'discussion' and peek_ends_at is null
  then 'PASS: host skipped straight to the discussion' else 'FAIL: ' || status end
from sessions where id = :'g3_session_id';

-- ============================================================================
\echo '=== GAME 4: hints off, and hints that do not line up ==='
-- ============================================================================
set role anon;
select * from create_session(p_display_name => 'Host3', p_hints_enabled => false) \gset g4_
select player_id as b from join_session(:'g4_code', 'Fay') \gset g4_
select player_id as c from join_session(:'g4_code', 'Gus') \gset g4_
select start_game(:'g4_session_id', :'g4_player_id',
  array['Pelé','Zico','Sócrates'], array['immortal','strike','doctor']);
reset role;

\echo '--- 11. hints off means no clue is stored, even though one was sent ---'
select case when count(*) = 0 then 'PASS: nothing stored with hints off' else 'FAIL: ' || count(*) || ' rows hold a clue' end
from pg_temp.secrets(:'g4_session_id') where hint_text is not null;

set role anon;
select * from create_session(p_display_name => 'Host4', p_hints_enabled => true) \gset g5_
select player_id as b from join_session(:'g5_code', 'Hal') \gset g5_
select player_id as c from join_session(:'g5_code', 'Ivy') \gset g5_
select start_game(:'g5_session_id', :'g5_player_id',
  array['Pelé','Zico','Sócrates'], array['immortal','strike']);
reset role;

\echo '--- 12. a short hint list means no clue, never the wrong one ---'
select case when count(*) = 0 then 'PASS: mismatched lists give no clue' else 'FAIL: ' || count(*) || ' rows hold a clue' end
from pg_temp.secrets(:'g5_session_id') where hint_text is not null;

set role anon;
select * from create_session(p_display_name => 'Host5', p_hints_enabled => true) \gset g6_
select player_id as b from join_session(:'g6_code', 'Jo')  \gset g6_
select player_id as c from join_session(:'g6_code', 'Kit') \gset g6_
select start_game(:'g6_session_id', :'g6_player_id', array['Pelé','Zico','Sócrates']);
reset role;

\echo '--- 13. no hint list at all is fine; the game just plays without clues ---'
select case when status = 'peeking' and (select count(*) from pg_temp.secrets(:'g6_session_id') where hint_text is not null) = 0
  then 'PASS: started cleanly with no hints sent' else 'FAIL: ' || status end
from sessions where id = :'g6_session_id';

\echo '=== done. Scan the output above for FAIL. ==='
