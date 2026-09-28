-- ============================================================================
-- Football fixture: FICTIONAL test data. Nothing in here is a real fact.
--
-- Invented countries (every code starts with X, which no FIFA code does), clubs,
-- competitions, trophies and footballers, arranged so every rule in migration
-- 0009 has a case that passes and a case that should not:
--
--   played for        a loan with no games (Tomas Quell at Harbour City), a
--                     reserve side whose games do not count for the first team
--                     (Luca Mendrel), two spells at one club (Kai Brennik)
--   nationality       born in one country, youth caps for it, football
--                     nationality another (Idris Kallow)
--   won               a continental cup, a league title, an international
--                     trophy and an individual award, each through explicit
--                     winner rows. At the winning club that season but not on
--                     the winners list (Mateo Silvane in the 2021 Continental
--                     Cup), on the champions' reserve side (Luca Mendrel), and
--                     a trophy whose winner data is unverified (Dunmere Super
--                     Cup). Competitions appear only as what a trophy is won
--                     in; nobody qualifies for anything by playing in one.
--   search            two footballers both known as "Danilo" (told apart by
--                     full name and birth year, never nationality), Fellari next to
--                     a Fellarino who sorts before him, a footballer known by
--                     one name ("Rodero") next to one who sorts before him
--                     ("Kiko Rodero"), and an accented name (Joël Åsmark)
--
-- Tests and local development only. It refuses to load unless you opt in
-- first, and it refuses to load into a database that holds real footballers:
--
--   set fn.load_football_fixture = 'yes';
--   \i supabase/fixtures/football_fixture.sql
--
-- Loading it twice gives the same result as loading it once.
-- ============================================================================

\set ON_ERROR_STOP on

do $$
begin
  if coalesce(current_setting('fn.load_football_fixture', true), '') <> 'yes' then
    raise exception 'This is fictional test data. To load it into a throwaway or local database, run  set fn.load_football_fixture = ''yes'';  first.';
  end if;
  if exists (select 1 from public.football_players where source <> 'fixture') then
    raise exception 'This database holds real footballers. The fictional fixture is never loaded alongside real data.';
  end if;
end $$;

begin;

-- Start clean. Deleting a player takes his facts with him.
delete from public.football_categories      where source = 'fixture';
delete from public.football_players         where source = 'fixture';
delete from public.football_national_teams  where source = 'fixture';
delete from public.football_trophies        where source = 'fixture';
delete from public.football_competitions    where source = 'fixture';
delete from public.football_clubs           where source = 'fixture';
delete from public.football_countries       where source = 'fixture';

-- ---- Countries ----------------------------------------------------------------

insert into public.football_countries (name, fifa_code, source) values
  ('Veloria',  'XVE', 'fixture'),
  ('Carvania', 'XCA', 'fixture'),
  ('Dunmere',  'XDU', 'fixture'),
  ('Estrana',  'XES', 'fixture'),
  ('Norhaven', 'XNH', 'fixture'),
  ('Solvara',  'XSO', 'fixture');

-- ---- Clubs ----------------------------------------------------------------------

insert into public.football_clubs (name, short_name, country_id, source)
select v.name, v.short_name, c.id, 'fixture'
from (values
  ('Harbour City FC',          'Harbour City',     'XVE'),
  ('Harbour City FC Reserves', 'Harbour City Res', 'XVE'),
  ('Redmoor United',           'Redmoor',          'XVE'),
  ('Castellan CF',             'Castellan',        'XCA'),
  ('Port Aldry',               'Port Aldry',       'XCA'),
  ('Northbridge Athletic',     'Northbridge',      'XDU'),
  ('Kestrel Rovers',           'Kestrel',          'XES'),
  ('Vale Albion',              'Vale Albion',      'XNH'),
  ('Ironside FC',              'Ironside',         'XSO')
) v (name, short_name, code)
join public.football_countries c on c.fifa_code = v.code;

-- ---- Competitions ---------------------------------------------------------------

-- Only the ones a trophy is won in. A competition is reference data here.

insert into public.football_competitions (name, kind, country_id, source)
select v.name, v.kind, c.id, 'fixture'
from (values
  ('Veloria Premier Division', 'league',        'XVE'),
  ('Continental Cup',          'continental',   null),
  ('World Shield',             'international', null)
) v (name, kind, code)
left join public.football_countries c on c.fifa_code = v.code;

-- ---- Trophies -------------------------------------------------------------------

insert into public.football_trophies (name, kind, competition_id, winners_verified, winners_source, source)
select v.name, v.kind, comp.id, v.verified, v.winners_source, 'fixture'
from (values
  -- like the Ballon d'Or: an award, won in no competition
  ('Golden Boot of the Isles', 'individual_award', null,                       true,  'Fixture: the fictional awarding body''s recipient list'),
  -- like the Champions League, the Premier League and the World Cup
  ('Continental Cup',          'team_trophy',      'Continental Cup',          true,  'Fixture: the fictional competition''s official winners list'),
  ('Veloria Premier Division', 'team_trophy',      'Veloria Premier Division', true,  'Fixture: the fictional league''s official title-winning squads'),
  ('World Shield',             'team_trophy',      'World Shield',             true,  'Fixture: the fictional tournament''s official squads'),
  -- winner rows exist, but nobody has verified them
  ('Dunmere Super Cup',        'team_trophy',      null,                       false, null)
) v (name, kind, competition, verified, winners_source)
left join public.football_competitions comp on comp.name = v.competition;

-- ---- Footballers ----------------------------------------------------------------

insert into public.football_players
  (known_as, full_name, date_of_birth, football_nationality_id, birth_country_id, source)
select v.known_as, v.full_name, v.born_on::date, nat.id, birth.id, 'fixture'
from (values
  ('Arlo Venn',       'Arlo Venn',       '1995-03-02', 'XVE', 'XVE'),
  ('Tomas Quell',     'Tomas Quell',     '1998-07-11', 'XVE', 'XVE'),
  ('Kai Brennik',     'Kai Brennik',     '1996-01-20', 'XCA', 'XCA'),
  ('Luca Mendrel',    'Luca Mendrel',    '2003-05-05', 'XVE', 'XVE'),
  ('Idris Kallow',    'Idris Kallow',    '2004-09-14', 'XVE', 'XCA'),
  ('Sami Oduvar',     'Samuel Oduvar',   '1999-02-28', 'XDU', 'XVE'),
  ('Marco Fellari',   'Marco Fellari',   '1993-10-10', 'XES', 'XES'),
  ('Aldo Fellarino',  'Aldo Fellarino',  '1997-04-04', 'XES', 'XCA'),
  ('Emil Strandvik',  'Emil Strandvik',  '1994-12-01', 'XNH', 'XNH'),
  ('Nico Havrel',     'Nicolas Havrel',  '1992-06-06', 'XDU', 'XDU'),
  ('Danilo',          'Danilo Arvelo',   '1994-08-08', 'XCA', 'XCA'),
  ('Danilo',          'Danilo Moretzo',  '2001-03-03', 'XES', 'XES'),
  ('Joël Åsmark',     'Joël Åsmark',     '1997-11-11', 'XNH', 'XNH'),
  ('Ruben Castelmar', 'Ruben Castelmar', '1990-02-02', 'XCA', 'XCA'),
  ('Owen Marrick',    'Owen Marrick',    '1991-09-09', 'XVE', 'XVE'),
  ('Felix Draymond',  'Felix Draymond',  '1996-05-15', 'XDU', 'XDU'),
  ('Hugo Lindqvar',   'Hugo Lindqvar',   '1995-07-07', 'XNH', 'XNH'),
  ('Pavel Orskin',    'Pavel Orskin',    '1993-03-13', 'XSO', 'XSO'),
  ('Teo Vargalo',     'Teo Vargalo',     '1999-12-12', 'XSO', 'XSO'),
  ('Bram Olvedo',     'Bram Olvedo',     '1998-01-30', 'XES', 'XES'),
  ('Jonas Pellwick',  'Jonas Pellwick',  '1994-04-21', 'XDU', 'XDU'),
  ('Rafa Quintel',    'Rafael Quintel',  '1996-08-17', 'XCA', 'XCA'),
  ('Eli Morrowin',    'Eli Morrowin',    '2000-10-02', 'XNH', 'XNH'),
  ('Stefan Dravek',   'Stefan Dravek',   '1992-11-23', 'XSO', 'XSO'),
  ('Ade Kolawe',      'Ade Kolawe',      '1997-06-09', 'XDU', 'XDU'),
  ('Mateo Silvane',   'Mateo Silvane',   '1999-09-19', 'XES', 'XES'),
  ('Oskar Holmvik',   'Oskar Holmvik',   '1991-01-01', 'XNH', 'XNH'),
  ('Leon Varrow',     'Leon Varrow',     '2002-02-14', 'XVE', 'XVE'),
  ('Iker Zalduen',    'Iker Zalduen',    '1995-05-25', 'XCA', 'XCA'),
  ('Noah Treml',      'Noah Treml',      '2001-07-07', 'XSO', 'XSO'),
  ('Ciaran Moldry',   'Ciaran Moldry',   '1998-03-03', 'XDU', 'XDU'),
  ('Anders Kvell',    'Anders Kvell',    '2003-12-24', 'XNH', 'XNH'),
  -- Known by one name, like Ronaldo, next to a Rodero who sorts first
  ('Rodero',          'Rodero Almaz Fontes', '1986-09-22', 'XSO', 'XSO'),
  ('Kiko Rodero',     'Francisco Rodero',    '1990-04-18', 'XSO', 'XSO')
) v (known_as, full_name, born_on, nationality, birthplace)
join public.football_countries nat on nat.fifa_code = v.nationality
left join public.football_countries birth on birth.fifa_code = v.birthplace;

-- ---- Spells at clubs (senior competitive appearances) ---------------------------
-- Footballers are looked up by full name, which is unique in this fixture.

insert into public.football_player_clubs
  (player_id, club_id, joined_on, left_on, senior_competitive_apps, source)
select p.id, c.id, v.joined_on::date, v.left_on::date, v.apps, 'fixture'
from (values
  -- Harbour City FC
  ('Arlo Venn',       'Harbour City FC', '2016-07-01', null,         120),
  ('Tomas Quell',     'Harbour City FC', '2019-08-01', '2020-01-31',   0),  -- loan, never played
  ('Idris Kallow',    'Harbour City FC', '2022-07-01', null,          30),
  ('Marco Fellari',   'Harbour City FC', '2014-07-01', '2017-06-30',  45),
  ('Emil Strandvik',  'Harbour City FC', '2013-07-01', '2016-06-30',  60),
  ('Joël Åsmark',     'Harbour City FC', '2019-07-01', '2020-06-30',  22),
  ('Felix Draymond',  'Harbour City FC', '2020-07-01', '2021-06-30',  15),
  ('Pavel Orskin',    'Harbour City FC', '2012-07-01', '2013-06-30',   8),
  ('Mateo Silvane',   'Harbour City FC', '2022-07-01', null,          40),
  -- the reserve side is a club of its own
  ('Luca Mendrel',    'Harbour City FC Reserves', '2021-07-01', null, 30),
  -- Redmoor United
  ('Tomas Quell',     'Redmoor United', '2017-07-01', null,           40),
  ('Samuel Oduvar',   'Redmoor United', '2018-07-01', null,           70),
  ('Danilo Arvelo',   'Redmoor United', '2016-07-01', '2018-06-30',   25),
  ('Owen Marrick',    'Redmoor United', '2010-07-01', '2019-06-30',  150),
  ('Hugo Lindqvar',   'Redmoor United', '2016-07-01', '2018-06-30',   33),
  ('Teo Vargalo',     'Redmoor United', '2019-07-01', '2020-06-30',   12),
  ('Leon Varrow',     'Redmoor United', '2021-07-01', null,            5),
  -- Castellan CF
  ('Kai Brennik',     'Castellan CF', '2015-07-01', '2016-06-30',     10),
  ('Kai Brennik',     'Castellan CF', '2019-07-01', '2019-12-31',      0),  -- second spell, no games
  ('Aldo Fellarino', 'Castellan CF', '2017-07-01', null,             50),
  ('Ruben Castelmar', 'Castellan CF', '2009-07-01', null,            200),
  ('Bram Olvedo',     'Castellan CF', '2016-07-01', '2017-06-30',     18),
  ('Jonas Pellwick',  'Castellan CF', '2014-07-01', '2015-06-30',      9),
  ('Rafael Quintel',  'Castellan CF', '2018-07-01', null,             60),
  ('Arlo Venn',       'Castellan CF', '2013-07-01', '2016-06-30',     30),
  -- Port Aldry
  ('Danilo Moretzo',  'Port Aldry', '2019-07-01', '2020-06-30',       14),
  ('Stefan Dravek',   'Port Aldry', '2015-07-01', '2018-06-30',       35),
  ('Iker Zalduen',    'Port Aldry', '2016-07-01', null,               80),
  ('Samuel Oduvar',   'Port Aldry', '2016-07-01', '2018-06-30',       20),
  ('Owen Marrick',    'Port Aldry', '2019-07-01', '2020-06-30',       10),
  -- Northbridge Athletic
  ('Nicolas Havrel',  'Northbridge Athletic', '2012-07-01', null,     90),
  ('Felix Draymond',  'Northbridge Athletic', '2016-07-01', '2020-06-30', 60),
  ('Jonas Pellwick',  'Northbridge Athletic', '2015-07-01', null,     40),
  ('Ade Kolawe',      'Northbridge Athletic', '2017-07-01', null,     55),
  ('Ciaran Moldry',   'Northbridge Athletic', '2020-07-01', null,     11),
  ('Kai Brennik',     'Northbridge Athletic', '2016-07-01', '2019-06-30', 20),
  -- Kestrel Rovers
  ('Marco Fellari',   'Kestrel Rovers', '2017-07-01', null,           70),
  ('Danilo Moretzo',  'Kestrel Rovers', '2020-07-01', null,           30),
  ('Bram Olvedo',     'Kestrel Rovers', '2017-07-01', null,           44),
  ('Mateo Silvane',   'Kestrel Rovers', '2019-07-01', '2022-06-30',   25),
  ('Noah Treml',      'Kestrel Rovers', '2020-07-01', '2021-06-30',    6),
  ('Eli Morrowin',    'Kestrel Rovers', '2018-07-01', '2020-06-30',   19),
  -- Vale Albion
  ('Emil Strandvik',  'Vale Albion', '2016-07-01', null,              80),
  ('Joël Åsmark',     'Vale Albion', '2020-07-01', null,              40),
  ('Hugo Lindqvar',   'Vale Albion', '2018-07-01', null,              60),
  ('Eli Morrowin',    'Vale Albion', '2020-07-01', null,              50),
  ('Oskar Holmvik',   'Vale Albion', '2009-07-01', null,             100),
  ('Anders Kvell',    'Vale Albion', '2022-07-01', null,               7),
  ('Teo Vargalo',     'Vale Albion', '2020-07-01', '2021-06-30',      22),
  -- Ironside FC
  ('Pavel Orskin',    'Ironside FC', '2013-07-01', null,              90),
  ('Teo Vargalo',     'Ironside FC', '2021-07-01', null,              60),
  ('Stefan Dravek',   'Ironside FC', '2018-07-01', null,              15),
  ('Noah Treml',      'Ironside FC', '2021-07-01', null,              70),
  ('Ade Kolawe',      'Ironside FC', '2015-07-01', '2017-06-30',      10),
  ('Leon Varrow',     'Ironside FC', '2019-07-01', '2021-06-30',      30)
) v (full_name, club, joined_on, left_on, apps)
join public.football_players p on p.full_name = v.full_name and p.source = 'fixture'
join public.football_clubs c on c.name = v.club and c.source = 'fixture';

-- ---- Winners and recipients -----------------------------------------------------
-- Explicit rows only. Mateo Silvane was at Kestrel Rovers when they won the
-- Continental Cup in 2021 but is not on the winners list, so he has not won it.
-- Luca Mendrel was on Harbour City's reserve side when the first team won the
-- 2022/23 title, which does not make him a champion either.

insert into public.football_player_trophies (player_id, trophy_id, season, club_id, source)
select p.id, t.id, v.season, c.id, 'fixture'
from (values
  ('Arlo Venn',       'Golden Boot of the Isles', '2019', null),
  ('Iker Zalduen',    'Golden Boot of the Isles', '2021', null),
  ('Pavel Orskin',    'Golden Boot of the Isles', '2022', null),
  ('Marco Fellari',   'Continental Cup', '2021', 'Kestrel Rovers'),
  ('Bram Olvedo',     'Continental Cup', '2021', 'Kestrel Rovers'),
  ('Danilo Moretzo',  'Continental Cup', '2021', 'Kestrel Rovers'),
  ('Ruben Castelmar', 'Continental Cup', '2023', 'Castellan CF'),
  ('Rafael Quintel',  'Continental Cup', '2023', 'Castellan CF'),
  ('Aldo Fellarino',  'Continental Cup', '2023', 'Castellan CF'),
  ('Tomas Quell',     'Veloria Premier Division', '2018/19', 'Redmoor United'),
  ('Samuel Oduvar',   'Veloria Premier Division', '2018/19', 'Redmoor United'),
  ('Owen Marrick',    'Veloria Premier Division', '2018/19', 'Redmoor United'),
  ('Arlo Venn',       'Veloria Premier Division', '2022/23', 'Harbour City FC'),
  ('Idris Kallow',    'Veloria Premier Division', '2022/23', 'Harbour City FC'),
  ('Mateo Silvane',   'Veloria Premier Division', '2022/23', 'Harbour City FC'),
  ('Emil Strandvik',  'World Shield', '2022', null),
  ('Joël Åsmark',     'World Shield', '2022', null),
  ('Oskar Holmvik',   'World Shield', '2022', null),
  ('Hugo Lindqvar',   'World Shield', '2022', null),
  -- recorded, but this trophy's winner data is not verified
  ('Nicolas Havrel',  'Dunmere Super Cup', '2020', 'Northbridge Athletic'),
  ('Felix Draymond',  'Dunmere Super Cup', '2020', 'Northbridge Athletic')
) v (full_name, trophy, season, club)
join public.football_players p on p.full_name = v.full_name and p.source = 'fixture'
join public.football_trophies t on t.name = v.trophy and t.source = 'fixture'
left join public.football_clubs c on c.name = v.club and c.source = 'fixture';

-- ---- International sides and caps -----------------------------------------------
-- Idris Kallow was born in Carvania and capped by its U17 side, but his
-- football nationality is Veloria. Neither fact makes him Carvanian here.

insert into public.football_national_teams (country_id, level, source)
select c.id, v.level, 'fixture'
from (values ('XVE', 'senior'), ('XCA', 'senior'), ('XCA', 'u17'), ('XDU', 'senior'), ('XNH', 'senior')) v (code, level)
join public.football_countries c on c.fifa_code = v.code;

insert into public.football_player_national_teams (player_id, national_team_id, appearances, source)
select p.id, nt.id, v.apps, 'fixture'
from (values
  ('Idris Kallow',   'XCA', 'u17',     5),
  ('Samuel Oduvar',  'XDU', 'senior', 12),
  ('Emil Strandvik', 'XNH', 'senior', 40),
  ('Arlo Venn',      'XVE', 'senior', 30)
) v (full_name, code, level, apps)
join public.football_players p on p.full_name = v.full_name and p.source = 'fixture'
join public.football_countries c on c.fifa_code = v.code
join public.football_national_teams nt on nt.country_id = c.id and nt.level = v.level;

-- ---- Criteria ---------------------------------------------------------------------
-- Every first-team club, every country, and every trophy. A competition shows
-- up here only as its trophy, so "Continental Cup" on a board means won it.
-- The Dunmere Super Cup gets a criterion too, but it stays switched off: its
-- winner data is not verified, and the database would refuse to switch it on.

insert into public.football_categories (type, club_id, label, short_label, active, source)
select 'CLUB', c.id, c.name, c.short_name, true, 'fixture'
from public.football_clubs c
where c.source = 'fixture' and c.name <> 'Harbour City FC Reserves';

insert into public.football_categories (type, country_id, label, short_label, active, source)
select 'NATIONALITY', c.id, c.name, c.fifa_code, true, 'fixture'
from public.football_countries c
where c.source = 'fixture';

insert into public.football_categories (type, trophy_id, trophy_winners_verified, label, short_label, active, source)
select 'TROPHY', t.id, t.winners_verified, t.name, null, t.winners_verified, 'fixture'
from public.football_trophies t
where t.source = 'fixture';

-- ---- Nothing went missing ---------------------------------------------------------
-- Every fact above is joined in by name, so a typo would drop a row without a
-- word. Count them all, and refuse the whole fixture if anything is short.

do $$
declare
  v_expected constant jsonb := '{
    "countries": 6, "clubs": 9, "competitions": 3, "trophies": 5, "players": 34,
    "spells": 55, "trophy_rows": 21,
    "national_teams": 5, "caps": 4, "categories": 19
  }';
  v_actual jsonb;
begin
  select jsonb_build_object(
    'countries',        (select count(*) from public.football_countries             where source = 'fixture'),
    'clubs',            (select count(*) from public.football_clubs                 where source = 'fixture'),
    'competitions',     (select count(*) from public.football_competitions          where source = 'fixture'),
    'trophies',         (select count(*) from public.football_trophies              where source = 'fixture'),
    'players',          (select count(*) from public.football_players               where source = 'fixture'),
    'spells',           (select count(*) from public.football_player_clubs          where source = 'fixture'),
    'trophy_rows',      (select count(*) from public.football_player_trophies       where source = 'fixture'),
    'national_teams',   (select count(*) from public.football_national_teams        where source = 'fixture'),
    'caps',             (select count(*) from public.football_player_national_teams where source = 'fixture'),
    'categories',       (select count(*) from public.football_categories            where source = 'fixture')
  ) into v_actual;

  if v_actual <> v_expected then
    raise exception 'The football fixture did not load completely. Expected % but got %', v_expected, v_actual;
  end if;
end $$;

commit;
