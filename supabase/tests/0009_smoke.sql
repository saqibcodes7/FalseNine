-- ============================================================================
-- Smoke tests for migration 0009 (the football knowledge base).
--
-- Run against a THROWAWAY database, after all the migrations. The easy way is
-- `npm run test:db`. Loads the fictional fixture, so no result here depends on
-- a real-world fact being right.
--
-- Everything that writes runs inside a transaction that is rolled back at the
-- end, so the fixture is left exactly as it was loaded.
--
-- Every check prints PASS or FAIL.
-- ============================================================================

\pset pager off
\set ON_ERROR_STOP on

set fn.load_football_fixture = 'yes';
\ir ../fixtures/football_fixture.sql

-- ---- Helpers: look things up by name, compare sets of footballers -----------

create function pg_temp.player(p_full_name text) returns uuid language sql as
  $$ select id from public.football_players where full_name = p_full_name $$;
create function pg_temp.club(p_name text) returns uuid language sql as
  $$ select id from public.football_clubs where name = p_name $$;
create function pg_temp.country(p_code text) returns uuid language sql as
  $$ select id from public.football_countries where fifa_code = p_code $$;
create function pg_temp.trophy(p_name text) returns uuid language sql as
  $$ select id from public.football_trophies where name = p_name $$;
create function pg_temp.cat(p_type text, p_label text) returns uuid language sql as
  $$ select id from public.football_categories where type = p_type and label = p_label $$;

-- Everyone who satisfies a category, by full name, sorted.
create function pg_temp.members(p_type text, p_label text) returns text[] language sql as $$
  select array_agg(p.full_name order by p.full_name collate "C")
  from public.football_category_members m
  join public.football_players p on p.id = m.player_id
  where m.category_id = pg_temp.cat(p_type, p_label)
$$;

create function pg_temp.expect_set(p_what text, p_actual text[], p_expected text[]) returns text language sql as $$
  select case
    when coalesce(p_actual, '{}') = coalesce((select array_agg(x order by x collate "C") from unnest(p_expected) x), '{}')
    then 'PASS: ' || p_what
    else 'FAIL: ' || p_what || ', got ' || coalesce(array_to_string(p_actual, ', '), 'nobody')
  end
$$;

-- ============================================================================
\echo '=== 1. The fixture is loaded, complete and entirely fictional ==='
-- ============================================================================

select case when (select count(*) from football_players) = 34
             and (select count(*) from football_categories) = 19
             and (select count(*) from football_category_members) = 105
  then 'PASS: 34 footballers, 19 criteria, 105 memberships'
  else 'FAIL: ' || (select count(*) from football_players) || ' / ' || (select count(*) from football_categories)
       || ' / ' || (select count(*) from football_category_members) end;

select case when not exists (select 1 from football_countries where fifa_code !~ '^X')
             and not exists (select 1 from football_players where source <> 'fixture')
             and not exists (select 1 from football_player_clubs where source <> 'fixture')
             and not exists (select 1 from football_player_trophies where source <> 'fixture')
  then 'PASS: every row is marked fixture, every country code is an invented X code'
  else 'FAIL: something real crept into the fixture' end;

-- ============================================================================
\echo '=== 2. Played for: at least one senior competitive appearance ==='
-- ============================================================================

select pg_temp.expect_set('Harbour City FC is exactly the eight who played for the first team',
  pg_temp.members('CLUB', 'Harbour City FC'),
  array['Arlo Venn', 'Emil Strandvik', 'Felix Draymond', 'Idris Kallow', 'Joël Åsmark',
        'Marco Fellari', 'Mateo Silvane', 'Pavel Orskin']);

select case when not public.football_satisfies(pg_temp.player('Tomas Quell'), pg_temp.cat('CLUB', 'Harbour City FC'))
             and public.football_satisfies(pg_temp.player('Tomas Quell'), pg_temp.cat('CLUB', 'Redmoor United'))
  then 'PASS: a loan without a game does not count; his games elsewhere do'
  else 'FAIL: Tomas Quell' end;

select case when not public.football_satisfies(pg_temp.player('Luca Mendrel'), pg_temp.cat('CLUB', 'Harbour City FC'))
  then 'PASS: games for the reserve side do not count for the first team'
  else 'FAIL: Luca Mendrel counted for the first team' end;

select case when (select count(*) from football_category_members
                  where category_id = pg_temp.cat('CLUB', 'Castellan CF') and player_id = pg_temp.player('Kai Brennik')) = 1
  then 'PASS: two spells at one club are one membership'
  else 'FAIL: Kai Brennik counted more than once' end;

select case when public.football_satisfies(pg_temp.player('Arlo Venn'), pg_temp.cat('CLUB', 'Castellan CF'))
  then 'PASS: a spell that has ended still counts'
  else 'FAIL: Arlo Venn at Castellan' end;

-- ============================================================================
\echo '=== 3. Football nationality: one country, whatever else is true ==='
-- ============================================================================

select pg_temp.expect_set('Carvania is exactly its five nationals',
  pg_temp.members('NATIONALITY', 'Carvania'),
  array['Danilo Arvelo', 'Iker Zalduen', 'Kai Brennik', 'Rafael Quintel', 'Ruben Castelmar']);

select case when public.football_satisfies(pg_temp.player('Idris Kallow'), pg_temp.cat('NATIONALITY', 'Veloria'))
             and not public.football_satisfies(pg_temp.player('Idris Kallow'), pg_temp.cat('NATIONALITY', 'Carvania'))
             and exists (select 1 from football_player_national_teams pnt
                         join football_national_teams nt on nt.id = pnt.national_team_id
                         where pnt.player_id = pg_temp.player('Idris Kallow') and nt.country_id = pg_temp.country('XCA'))
  then 'PASS: born in Carvania with Carvania U17 caps, still only Veloria'
  else 'FAIL: Idris Kallow' end;

select case when not public.football_satisfies(pg_temp.player('Samuel Oduvar'), pg_temp.cat('NATIONALITY', 'Veloria'))
  then 'PASS: birthplace alone is not nationality'
  else 'FAIL: Samuel Oduvar counted for his birthplace' end;

select case when count(*) = 34 and min(n) = 1 and max(n) = 1
  then 'PASS: every footballer has exactly one nationality criterion'
  else 'FAIL: nationality memberships per player range ' || min(n) || ' to ' || max(n) end
from (
  select p.id, count(m.category_id) as n
  from football_players p
  left join football_category_members m
    on m.player_id = p.id and m.category_id in (select id from football_categories where type = 'NATIONALITY')
  group by p.id
) per_player;

-- ============================================================================
\echo '=== 4. Competitions are reference data, never a criterion ==='
-- ============================================================================

select case when to_regclass('public.football_player_competitions') is null
  then 'PASS: there is no table of who played in which competition'
  else 'FAIL: a participation table exists' end;

do $$ begin
  insert into football_categories (type, label, source) values ('COMPETITION', 'Played in the Continental Cup', 'manual');
  raise notice 'FAIL: a competition criterion was accepted';
exception when check_violation then raise notice 'PASS: there is no competition criterion type';
end $$;

select case when not exists (
    select 1 from football_competitions c
    where not exists (select 1 from football_trophies t where t.competition_id = c.id))
  then 'PASS: every competition in the fixture is there as what a trophy is won in'
  else 'FAIL: a competition with no trophy' end;

select case
  when (select count(*) from football_categories where label = 'Continental Cup') = 1
   and (select c.type = 'TROPHY' and comp.name = 'Continental Cup'
        from football_categories c
        join football_trophies t on t.id = c.trophy_id
        join football_competitions comp on comp.id = t.competition_id
        where c.label = 'Continental Cup')
  then 'PASS: an axis that says Continental Cup is the trophy, so it means won it'
  else 'FAIL: the Continental Cup criterion is not its trophy' end;

-- ============================================================================
\echo '=== 5. Won a trophy: explicit, verified winners only ==='
-- ============================================================================

select pg_temp.expect_set('won the Continental Cup is exactly the six on the winners lists',
  pg_temp.members('TROPHY', 'Continental Cup'),
  array['Bram Olvedo', 'Danilo Moretzo', 'Marco Fellari', 'Aldo Fellarino', 'Rafael Quintel', 'Ruben Castelmar']);

select pg_temp.expect_set('won the league is exactly the two title-winning squads',
  pg_temp.members('TROPHY', 'Veloria Premier Division'),
  array['Arlo Venn', 'Idris Kallow', 'Mateo Silvane', 'Owen Marrick', 'Samuel Oduvar', 'Tomas Quell']);

select pg_temp.expect_set('won the international trophy is exactly its winning squad',
  pg_temp.members('TROPHY', 'World Shield'),
  array['Emil Strandvik', 'Hugo Lindqvar', 'Joël Åsmark', 'Oskar Holmvik']);

select pg_temp.expect_set('an individual award goes to its official recipients',
  pg_temp.members('TROPHY', 'Golden Boot of the Isles'),
  array['Arlo Venn', 'Iker Zalduen', 'Pavel Orskin']);

select case when not public.football_satisfies(pg_temp.player('Mateo Silvane'), pg_temp.cat('TROPHY', 'Continental Cup'))
             and exists (select 1 from football_player_clubs
                         where player_id = pg_temp.player('Mateo Silvane') and club_id = pg_temp.club('Kestrel Rovers')
                           and joined_on <= '2021-12-31' and (left_on is null or left_on >= '2021-01-01'))
  then 'PASS: at the winning club that year is not the same as winning it'
  else 'FAIL: Mateo Silvane was treated as a winner' end;

select case when not public.football_satisfies(pg_temp.player('Luca Mendrel'), pg_temp.cat('TROPHY', 'Veloria Premier Division'))
             and exists (select 1 from football_player_clubs
                         where player_id = pg_temp.player('Luca Mendrel') and club_id = pg_temp.club('Harbour City FC Reserves'))
  then 'PASS: on the champions'' reserve side is not the same as winning the title'
  else 'FAIL: Luca Mendrel was treated as a champion' end;

select case when (select not active from football_categories where id = pg_temp.cat('TROPHY', 'Dunmere Super Cup'))
             and pg_temp.members('TROPHY', 'Dunmere Super Cup') is null
             and (select count(*) from football_player_trophies where trophy_id = pg_temp.trophy('Dunmere Super Cup')) = 2
  then 'PASS: an unverified trophy is switched off and has no members, even with winner rows'
  else 'FAIL: the Dunmere Super Cup leaked' end;

-- ============================================================================
\echo '=== 6. Intersections ==='
-- ============================================================================

select case
  when public.football_intersection_size(pg_temp.cat('CLUB', 'Harbour City FC'), pg_temp.cat('NATIONALITY', 'Veloria')) = 2
   and public.football_intersection_size(pg_temp.cat('CLUB', 'Harbour City FC'), pg_temp.cat('NATIONALITY', 'Carvania')) = 0
   and public.football_intersection_size(pg_temp.cat('CLUB', 'Kestrel Rovers'), pg_temp.cat('TROPHY', 'Continental Cup')) = 3
   and public.football_intersection_size(pg_temp.cat('CLUB', 'Redmoor United'), pg_temp.cat('TROPHY', 'Veloria Premier Division')) = 3
   and public.football_intersection_size(pg_temp.cat('NATIONALITY', 'Norhaven'), pg_temp.cat('TROPHY', 'World Shield')) = 4
  then 'PASS: intersection sizes are right, including an empty one'
  else 'FAIL: intersection sizes' end;

select case
  when public.football_satisfies(pg_temp.player('Arlo Venn'), pg_temp.cat('CLUB', 'Harbour City FC'))
   and public.football_satisfies(pg_temp.player('Arlo Venn'), pg_temp.cat('NATIONALITY', 'Veloria'))
   and not public.football_satisfies(pg_temp.player('Marco Fellari'), pg_temp.cat('NATIONALITY', 'Veloria'))
  then 'PASS: satisfies agrees with the membership view both ways'
  else 'FAIL: satisfies' end;

-- ============================================================================
\echo '=== 7. The schema refuses bad data ==='
-- Everything in this section is rolled back at the end.
-- ============================================================================

begin;

do $$ begin
  insert into football_categories (type, club_id, country_id, label, source)
  values ('CLUB', pg_temp.club('Harbour City FC Reserves'), pg_temp.country('XVE'), 'Two targets', 'manual');
  raise notice 'FAIL: a criterion pointed at two things';
exception when check_violation then raise notice 'PASS: a criterion cannot point at two things';
end $$;

do $$ begin
  insert into football_categories (type, label, source) values ('CLUB', 'Nothing', 'manual');
  raise notice 'FAIL: a criterion pointed at nothing';
exception when check_violation then raise notice 'PASS: a criterion cannot point at nothing';
end $$;

do $$ begin
  insert into football_categories (type, club_id, label, source)
  values ('NATIONALITY', pg_temp.club('Harbour City FC Reserves'), 'Wrong kind', 'manual');
  raise notice 'FAIL: a nationality criterion pointed at a club';
exception when check_violation then raise notice 'PASS: a criterion cannot point at the wrong kind of thing';
end $$;

do $$ begin
  insert into football_categories (type, club_id, label, source)
  values ('POSITION', pg_temp.club('Harbour City FC Reserves'), 'Unknown type', 'manual');
  raise notice 'FAIL: an unknown type was accepted';
exception when check_violation then raise notice 'PASS: an unknown criterion type is refused';
end $$;

do $$ begin
  insert into football_categories (type, club_id, label, source)
  values ('CLUB', pg_temp.club('Harbour City FC'), 'Harbour City again', 'manual');
  raise notice 'FAIL: the same criterion was defined twice';
exception when unique_violation then raise notice 'PASS: the same criterion cannot be defined twice';
end $$;

do $$ begin
  delete from football_clubs where name = 'Harbour City FC';
  raise notice 'FAIL: a club in use by a criterion was deleted';
exception when foreign_key_violation then raise notice 'PASS: a club a criterion uses cannot be deleted';
end $$;

do $$ begin
  delete from football_countries where fifa_code = 'XSO';
  raise notice 'FAIL: a country in use was deleted';
exception when foreign_key_violation then raise notice 'PASS: a country footballers belong to cannot be deleted';
end $$;

-- Trophy readiness.
do $$ begin
  update football_categories set trophy_winners_verified = true where id = pg_temp.cat('TROPHY', 'Dunmere Super Cup');
  raise notice 'FAIL: a criterion claimed its trophy was verified when it is not';
exception when foreign_key_violation then raise notice 'PASS: a criterion cannot claim its trophy is verified';
end $$;

do $$ begin
  update football_categories set active = true where id = pg_temp.cat('TROPHY', 'Dunmere Super Cup');
  raise notice 'FAIL: an unverified trophy was switched on';
exception when check_violation then raise notice 'PASS: an unverified trophy cannot be switched on';
end $$;

do $$ begin
  update football_trophies set winners_verified = false where name = 'Continental Cup';
  raise notice 'FAIL: a trophy went unverified under a live criterion';
exception when check_violation then raise notice 'PASS: a trophy cannot go unverified while its criterion is on';
end $$;

do $$ begin
  update football_trophies set winners_verified = true where name = 'Dunmere Super Cup';
  raise notice 'FAIL: a trophy was verified without saying where its winners come from';
exception when check_violation then raise notice 'PASS: verifying a trophy needs a winners source';
end $$;

update football_trophies
set winners_verified = true, winners_source = 'Fixture: an invented official list'
where name = 'Dunmere Super Cup';
update football_categories set active = true where id = pg_temp.cat('TROPHY', 'Dunmere Super Cup');
select pg_temp.expect_set('once verified and switched on, its winners appear',
  pg_temp.members('TROPHY', 'Dunmere Super Cup'), array['Felix Draymond', 'Nicolas Havrel']);

update football_categories set active = false where id = pg_temp.cat('TROPHY', 'Golden Boot of the Isles');
update football_trophies set winners_verified = false where name = 'Golden Boot of the Isles';
select case when (select trophy_winners_verified = false from football_categories where id = pg_temp.cat('TROPHY', 'Golden Boot of the Isles'))
             and pg_temp.members('TROPHY', 'Golden Boot of the Isles') is null
  then 'PASS: switched off first, a trophy can go unverified, and its criterion follows'
  else 'FAIL: the verified flag did not follow the trophy' end;

-- Provenance.
do $$ begin
  insert into football_player_clubs (player_id, club_id, senior_competitive_apps, source)
  values (pg_temp.player('Anders Kvell'), pg_temp.club('Ironside FC'), 3, 'manual');
  raise notice 'FAIL: a hand-entered fact was saved without a source';
exception when check_violation then raise notice 'PASS: a hand-entered fact has to say where it came from';
end $$;

do $$ begin
  insert into football_player_trophies (player_id, trophy_id, season, source)
  values (pg_temp.player('Anders Kvell'), pg_temp.trophy('World Shield'), '2026', 'sportmonks');
  raise notice 'FAIL: an imported winner was saved without a source reference';
exception when check_violation then raise notice 'PASS: an imported winner has to carry its source reference';
end $$;

insert into football_player_clubs (player_id, club_id, senior_competitive_apps, source, source_ref)
values (pg_temp.player('Anders Kvell'), pg_temp.club('Ironside FC'), 3, 'manual', 'https://example.invalid/fixture-only');
select case when public.football_satisfies(pg_temp.player('Anders Kvell'), pg_temp.cat('CLUB', 'Ironside FC'))
  then 'PASS: a sourced fact is accepted and counts straight away'
  else 'FAIL: the sourced fact did not count' end;

-- Shape of the facts.
do $$ begin
  insert into football_players (known_as, full_name, source) values ('Nobody', 'No Nationality', 'manual');
  raise notice 'FAIL: a footballer was saved without a nationality';
exception when not_null_violation then raise notice 'PASS: every footballer needs a football nationality';
end $$;

do $$ begin
  insert into football_player_clubs (player_id, club_id, senior_competitive_apps, source)
  values (pg_temp.player('Anders Kvell'), pg_temp.club('Vale Albion'), -1, 'fixture');
  raise notice 'FAIL: negative appearances were accepted';
exception when check_violation then raise notice 'PASS: appearances cannot be negative';
end $$;

do $$ begin
  insert into football_player_clubs (player_id, club_id, joined_on, left_on, source)
  values (pg_temp.player('Anders Kvell'), pg_temp.club('Vale Albion'), '2024-07-01', '2023-07-01', 'fixture');
  raise notice 'FAIL: a spell ended before it began';
exception when check_violation then raise notice 'PASS: a spell cannot end before it begins';
end $$;

do $$ begin
  insert into football_player_trophies (player_id, trophy_id, season, source)
  values (pg_temp.player('Arlo Venn'), pg_temp.trophy('Golden Boot of the Isles'), '2019', 'fixture');
  raise notice 'FAIL: the same trophy was won twice in one season';
exception when unique_violation then raise notice 'PASS: a trophy is won once per season';
end $$;

-- Providers' ids.
do $$ begin
  insert into football_external_refs (provider, external_id, player_id, club_id)
  values ('sportmonks', '1', pg_temp.player('Arlo Venn'), pg_temp.club('Ironside FC'));
  raise notice 'FAIL: one external id mapped to two things';
exception when check_violation then raise notice 'PASS: an external id maps to exactly one thing';
end $$;

insert into football_external_refs (provider, external_id, player_id) values ('sportmonks', '42', pg_temp.player('Arlo Venn'));
insert into football_external_refs (provider, external_id, club_id)   values ('sportmonks', '42', pg_temp.club('Ironside FC'));
do $$ begin
  insert into football_external_refs (provider, external_id, player_id) values ('sportmonks', '42', pg_temp.player('Teo Vargalo'));
  raise notice 'FAIL: one provider id was given to two footballers';
exception when unique_violation then raise notice 'PASS: a provider''s player id belongs to one footballer (a club may share the number)';
end $$;

do $$ begin
  insert into football_external_refs (provider, external_id, player_id) values ('fixture', '7', pg_temp.player('Teo Vargalo'));
  raise notice 'FAIL: an unknown provider was accepted';
exception when check_violation then raise notice 'PASS: only known providers can map ids';
end $$;

-- search_name follows the name.
update football_players set known_as = 'Zeph Quarrington' where full_name = 'Anders Kvell';
select case when exists (select 1 from football_search_players('quarrington') where full_name = 'Anders Kvell')
  then 'PASS: renaming a footballer updates what the search finds'
  else 'FAIL: the search did not follow the rename' end;

-- Trophy names are unique within a competition, and awards among themselves.
insert into football_trophies (name, kind, competition_id, source)
select 'Super Cup', 'team_trophy', id, 'fixture' from football_competitions where name in ('Continental Cup', 'Veloria Premier Division');
select case when (select count(*) from football_trophies where name = 'Super Cup') = 2
  then 'PASS: two competitions can each have a trophy of the same name'
  else 'FAIL: same-named trophies in different competitions were refused' end;

do $$ begin
  insert into football_trophies (name, kind, competition_id, source)
  select 'Super Cup', 'team_trophy', id, 'fixture' from football_competitions where name = 'Continental Cup';
  raise notice 'FAIL: the same trophy was defined twice for one competition';
exception when unique_violation then raise notice 'PASS: one competition cannot have the same trophy twice';
end $$;

do $$ begin
  insert into football_trophies (name, kind, source) values ('Golden Boot of the Isles', 'individual_award', 'fixture');
  raise notice 'FAIL: two awards with no competition shared a name';
exception when unique_violation then raise notice 'PASS: awards with no competition still cannot share a name';
end $$;

-- The result limit, with more matches than it allows.
insert into football_players (known_as, full_name, football_nationality_id, source)
select 'Clampson ' || i, 'Clampson ' || i, pg_temp.country('XSO'), 'manual'
from generate_series(1, 25) i;
select case when (select count(*) from football_search_players('clampson', 500)) = 20
             and (select count(*) from football_search_players('clampson', 0)) = 1
             and (select count(*) from football_search_players('clampson')) = 10
  then 'PASS: the search returns 10 by default and never fewer than 1 or more than 20'
  else 'FAIL: limits gave ' || (select count(*) from football_search_players('clampson', 500)) || ', '
       || (select count(*) from football_search_players('clampson', 0)) || ', '
       || (select count(*) from football_search_players('clampson')) end;

rollback;

select case when (select count(*) from football_category_members) = 105
             and (select count(*) from football_external_refs) = 0
             and exists (select 1 from football_players where known_as = 'Anders Kvell')
             and (select count(*) from football_players) = 34
  then 'PASS: all of that was rolled back; the fixture is untouched'
  else 'FAIL: section 7 left something behind' end;

-- ============================================================================
\echo '=== 8. The search, as the browser uses it ==='
-- ============================================================================

set role anon;

select case when count(*) = 2
             and count(distinct id) = 2
             and string_agg(full_name || ' ' || birth_year, ' | ' order by n) = 'Danilo Arvelo 1994 | Danilo Moretzo 2001'
  then 'PASS: two footballers called Danilo come back apart, oldest first, told apart by full name and year'
  else 'FAIL: Danilo: ' || coalesce(string_agg(full_name || ' ' || birth_year, ' | ' order by n), 'nothing') end
from football_search_players('danilo') with ordinality as r(id, known_as, full_name, birth_year, n);

select case when string_agg(full_name, ' | ' order by n) = 'Marco Fellari | Aldo Fellarino'
  then 'PASS: a whole-word match ranks above a longer name that starts the same, even one that sorts first'
  else 'FAIL: ' || coalesce(string_agg(full_name, ' | ' order by n), 'nothing') end
from football_search_players('fellari') with ordinality as r(id, known_as, full_name, birth_year, n);

select case when string_agg(known_as, ' | ' order by n) = 'Rodero | Kiko Rodero'
  then 'PASS: someone known by exactly what was typed comes first, even when another sorts before him'
  else 'FAIL: ' || coalesce(string_agg(known_as, ' | ' order by n), 'nothing') end
from football_search_players('rodero') with ordinality as r(id, known_as, full_name, birth_year, n);

select case when (select count(*) from football_search_players('joel asmark')) = 1
             and (select count(*) from football_search_players('JOËL ÅSMARK')) = 1
             and (select count(*) from football_search_players('asmark joel')) = 1
  then 'PASS: accents, case and word order do not matter'
  else 'FAIL: accent or order handling' end;

select case when (select count(*) from football_search_players('ellari')) = 0
  then 'PASS: words match from their start, not from the middle'
  else 'FAIL: matched mid-word' end;

select case when (select count(*) from football_search_players('m')) = 0
             and (select count(*) from football_search_players(null)) = 0
  then 'PASS: one character, or nothing, returns nothing'
  else 'FAIL: short query returned rows' end;

select case when exists (select 1 from football_search_players('mendrel') where full_name = 'Luca Mendrel')
  then 'PASS: the search covers everyone, not only footballers who fit some criterion'
  else 'FAIL: Luca Mendrel is not searchable' end;

select case when pg_get_function_result('public.football_search_players(text, int)'::regprocedure)
                  = 'TABLE(id uuid, known_as text, full_name text, birth_year integer)'
  then 'PASS: a search result is only id, names and birth year, nothing a criterion is built from'
  else 'FAIL: the search returns ' || pg_get_function_result('public.football_search_players(text, int)'::regprocedure) end;

select case when (select full_name || ' ' || birth_year from football_search_players('kallow')) = 'Idris Kallow 2004'
  then 'PASS: a result still says enough to pick the right footballer'
  else 'FAIL: Idris Kallow could not be identified' end;

-- ============================================================================
\echo '=== 9. The browser can reach the search and nothing else ==='
-- ============================================================================

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'football_players', 'football_player_clubs', 'football_competitions',
    'football_player_trophies', 'football_categories', 'football_category_members',
    'football_trophies', 'football_external_refs'
  ] loop
    begin
      execute format('select 1 from public.%I limit 1', v_table);
      raise notice 'FAIL: anon read %', v_table;
    exception when insufficient_privilege then
      raise notice 'PASS: anon cannot read %', v_table;
    end;
  end loop;
end $$;

do $$ begin
  perform public.football_satisfies(gen_random_uuid(), gen_random_uuid());
  raise notice 'FAIL: anon asked whether a footballer fits a criterion';
exception when insufficient_privilege then raise notice 'PASS: anon cannot ask who fits a criterion';
end $$;

do $$ begin
  perform public.football_intersection_size(gen_random_uuid(), gen_random_uuid());
  raise notice 'FAIL: anon counted an intersection';
exception when insufficient_privilege then raise notice 'PASS: anon cannot count an intersection';
end $$;

do $$ begin
  insert into public.football_players (known_as, full_name, football_nationality_id, source)
  values ('Hacker', 'Hacker', gen_random_uuid(), 'manual');
  raise notice 'FAIL: anon added a footballer';
exception when insufficient_privilege then raise notice 'PASS: anon cannot add a footballer';
end $$;

reset role;

\echo '=== 0009 done ==='
