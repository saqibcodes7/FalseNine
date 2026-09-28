-- ============================================================================
-- False Nine, migration 0009: the football knowledge base
--
-- Run this in the Supabase SQL editor AFTER 0001 to 0008 (paste the contents of
-- this file, not its path). It refuses to run twice, and it runs as one
-- transaction.
--
-- This is shared False Nine infrastructure, not part of any one game: the
-- footballers, the clubs, countries, competitions and trophies, and the facts
-- that connect them. Football Tic-Tac-Toe is its first reader. Nothing here
-- touches a session, a seat or a game.
--
-- The facts are relationships, never flags on a player. A footballer does not
-- have a played_for_arsenal column; he has a row in football_player_clubs.
--
-- ----------------------------------------------------------------------------
-- WHAT COUNTS AS A FACT
--
--   Played for a club      at least one official senior competitive appearance
--                          for that club (football_player_clubs.
--                          senior_competitive_apps >= 1). A loan with no games
--                          does not count, and a reserve or youth side is a
--                          club of its own, so its games do not count for the
--                          first team.
--
--   Football nationality   exactly one country per footballer
--                          (football_players.football_nationality_id). Birth
--                          country, citizenship, ancestry, eligibility and
--                          youth caps are all stored or storable separately and
--                          none of them changes it.
--
--   Won a trophy           an explicit, sourced winner or recipient row in
--                          football_player_trophies. Never inferred from club
--                          membership, and never from having played in the
--                          competition. Individual awards use the official
--                          recipient; team trophies use an authoritative
--                          source's official winners or squad list. A trophy
--                          whose winner data has not been verified cannot be
--                          switched on as a criterion (see football_categories).
--
--   Competitions           reference data only. A competition is what a trophy
--                          is won in (the Champions League trophy points at the
--                          UEFA Champions League). Nobody qualifies for anything
--                          by playing in one: there is no participation table
--                          and no competition criterion. A competition on a
--                          board means its trophy, so it means "won it". If a
--                          future game needs participation, it arrives as a
--                          new, additive migration.
--
-- ----------------------------------------------------------------------------
-- PROVENANCE
--
-- Every row says where it came from in `source`: 'fixture' (fictional test
-- data), 'manual' (entered by hand) or 'sportmonks' (the future import). Every
-- fact row that is not fictional also carries `source_ref`, a URL or the
-- provider's own id, so any fact can be traced and the importer can replace
-- its own rows without touching anyone else's. Providers' ids for our
-- entities live in football_external_refs, so no provider's shape leaks into
-- the tables gameplay reads.
--
-- ----------------------------------------------------------------------------
-- ACCESS
--
-- The browser can read none of this directly. The one door is
-- football_search_players(), which returns names and birth year for the
-- autocomplete and nothing a criterion is built from: no nationality, clubs or
-- trophies, so nobody can query their way to any part of a square's answer.
-- Writes are for the service role and the importer only.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.football_players') is not null then
    raise exception 'Migration 0009 has already been run on this database';
  end if;
  if to_regclass('public.game_modes') is null then
    raise exception 'Run migrations 0001 to 0008 before 0009';
  end if;
end $$;

-- Trigram indexes for the player search. Ships with Supabase.
create extension if not exists pg_trgm with schema extensions;

-- ----------------------------------------------------------------------------
-- Entities
-- ----------------------------------------------------------------------------

create table public.football_countries (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  -- FIFA's three-letter code, which unlike ISO has England, Scotland, Wales
  -- and Northern Ireland as countries of their own.
  fifa_code  text not null unique,
  flag_url   text,
  source     text not null,

  constraint football_countries_code_format check (fifa_code ~ '^[A-Z]{3}$'),
  constraint football_countries_source_valid check (source in ('fixture', 'manual', 'sportmonks'))
);

create table public.football_clubs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  short_name  text,
  country_id  uuid references public.football_countries(id) on delete restrict,
  logo_url    text,
  source      text not null,

  constraint football_clubs_name_present check (char_length(trim(name)) > 0),
  constraint football_clubs_source_valid check (source in ('fixture', 'manual', 'sportmonks'))
);

comment on table public.football_clubs is
  'Senior clubs. A reserve, B or youth side is a club of its own, so its appearances never count for the first team.';

create table public.football_competitions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null,
  -- Null for continental and international competitions.
  country_id  uuid references public.football_countries(id) on delete restrict,
  source      text not null,

  constraint football_competitions_kind_valid
    check (kind in ('league', 'domestic_cup', 'continental', 'international')),
  constraint football_competitions_source_valid check (source in ('fixture', 'manual', 'sportmonks')),
  constraint football_competitions_name_unique unique nulls not distinct (name, country_id)
);

create table public.football_trophies (
  id                uuid primary key default gen_random_uuid(),
  -- Unique within its competition, not across all of them: two competitions
  -- can each have a "Super Cup". Awards have no competition, and NULLS NOT
  -- DISTINCT means two awards still cannot share a name.
  name              text not null,
  kind              text not null,
  -- The competition this trophy is awarded for winning, if any: the Champions
  -- League trophy points at the UEFA Champions League. Null for awards such
  -- as the Ballon d'Or.
  competition_id    uuid references public.football_competitions(id) on delete restrict,
  -- True only once the winner rows for this trophy come from an authoritative
  -- source and are complete. Until then it cannot be switched on as a
  -- criterion; see football_categories.
  winners_verified  boolean not null default false,
  winners_source    text,
  source            text not null,

  constraint football_trophies_kind_valid check (kind in ('individual_award', 'team_trophy')),
  constraint football_trophies_source_valid check (source in ('fixture', 'manual', 'sportmonks')),
  constraint football_trophies_verified_needs_source
    check (not winners_verified or char_length(trim(coalesce(winners_source, ''))) > 0),
  constraint football_trophies_name_unique unique nulls not distinct (name, competition_id),
  -- The target of football_categories' readiness key below.
  constraint football_trophies_id_verified unique (id, winners_verified)
);

comment on column public.football_trophies.winners_source is
  'Where the winner rows come from: the official recipient list for an award, or an authoritative source''s official winners or squad list for a team trophy.';

create table public.football_players (
  id                       uuid primary key default gen_random_uuid(),
  -- What people call him, and what the autocomplete shows first: "Ronaldo".
  known_as                 text not null,
  full_name                text not null,
  first_name               text,
  last_name                text,
  date_of_birth            date,
  football_nationality_id  uuid not null references public.football_countries(id) on delete restrict,
  birth_country_id         uuid references public.football_countries(id) on delete restrict,
  image_url                text,
  -- Maintained by a trigger: known_as then full_name, lowercased, accents and
  -- punctuation stripped. What the search matches against.
  search_name              text not null default '',
  source                   text not null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint football_players_names_present
    check (char_length(trim(known_as)) > 0 and char_length(trim(full_name)) > 0),
  constraint football_players_source_valid check (source in ('fixture', 'manual', 'sportmonks'))
);

comment on column public.football_players.football_nationality_id is
  'The one country this footballer counts for in nationality criteria. Not birthplace, citizenship, ancestry, eligibility or youth caps.';

create index football_players_search_idx
  on public.football_players using gin (search_name extensions.gin_trgm_ops);
create index football_players_nationality_idx on public.football_players (football_nationality_id);

create table public.football_national_teams (
  id          uuid primary key default gen_random_uuid(),
  country_id  uuid not null references public.football_countries(id) on delete restrict,
  level       text not null,
  source      text not null,

  constraint football_national_teams_level_valid
    check (level in ('senior', 'u23', 'u21', 'u20', 'u19', 'u18', 'u17', 'u16', 'u15')),
  constraint football_national_teams_source_valid check (source in ('fixture', 'manual', 'sportmonks')),
  constraint football_national_teams_unique unique (country_id, level)
);

comment on table public.football_national_teams is
  'International sides at every level. Kept for the record; representing one never changes a footballer''s football nationality.';

-- ----------------------------------------------------------------------------
-- Facts. Each one carries its provenance, and anything that is not fictional
-- has to say where it came from.
-- ----------------------------------------------------------------------------

create table public.football_player_clubs (
  id                       uuid primary key default gen_random_uuid(),
  player_id                uuid not null references public.football_players(id) on delete cascade,
  club_id                  uuid not null references public.football_clubs(id) on delete restrict,
  joined_on                date,
  left_on                  date,
  -- Official senior competitive appearances in this spell. Friendlies,
  -- testimonials and youth games are not counted here.
  senior_competitive_apps  int not null default 0,
  goals                    int,
  source                   text not null,
  source_ref               text,

  constraint football_player_clubs_apps check (senior_competitive_apps >= 0),
  constraint football_player_clubs_goals check (goals is null or goals >= 0),
  constraint football_player_clubs_dates check (left_on is null or joined_on is null or left_on >= joined_on),
  constraint football_player_clubs_source_valid check (source in ('fixture', 'manual', 'sportmonks')),
  constraint football_player_clubs_sourced check (source = 'fixture' or source_ref is not null)
);

comment on table public.football_player_clubs is
  'One row per spell at a club. A player has played for a club when any spell there has at least one senior competitive appearance.';

create index football_player_clubs_player_idx on public.football_player_clubs (player_id);
create index football_player_clubs_club_idx   on public.football_player_clubs (club_id);

create table public.football_player_trophies (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references public.football_players(id) on delete cascade,
  trophy_id   uuid not null references public.football_trophies(id) on delete restrict,
  -- '2019/20' for a season, '2022' for a calendar year or a tournament.
  season      text not null,
  -- The club it was won with, for club trophies. Null for awards and for
  -- international trophies.
  club_id     uuid references public.football_clubs(id) on delete restrict,
  source      text not null,
  source_ref  text,

  constraint football_player_trophies_once unique (player_id, trophy_id, season),
  constraint football_player_trophies_source_valid check (source in ('fixture', 'manual', 'sportmonks')),
  constraint football_player_trophies_sourced check (source = 'fixture' or source_ref is not null)
);

comment on table public.football_player_trophies is
  'Explicit, sourced winners and recipients. Nothing here is ever derived from club membership.';

create index football_player_trophies_trophy_idx on public.football_player_trophies (trophy_id);

create table public.football_player_national_teams (
  player_id         uuid not null references public.football_players(id) on delete cascade,
  national_team_id  uuid not null references public.football_national_teams(id) on delete restrict,
  appearances       int not null default 0,
  goals             int,
  first_cap_on      date,
  last_cap_on       date,
  source            text not null,
  source_ref        text,

  primary key (player_id, national_team_id),
  constraint football_player_national_teams_apps check (appearances >= 0 and (goals is null or goals >= 0)),
  constraint football_player_national_teams_source_valid check (source in ('fixture', 'manual', 'sportmonks')),
  constraint football_player_national_teams_sourced check (source = 'fixture' or source_ref is not null)
);

-- ----------------------------------------------------------------------------
-- Providers' ids for our entities. Exactly one entity per row, each through a
-- real foreign key, so a mapping can never point at something that is not
-- there. This is where the importer looks up "Sportmonks player 12345".
-- ----------------------------------------------------------------------------

create table public.football_external_refs (
  id              uuid primary key default gen_random_uuid(),
  provider        text not null,
  external_id     text not null,
  player_id       uuid references public.football_players(id)      on delete cascade,
  club_id         uuid references public.football_clubs(id)        on delete cascade,
  country_id      uuid references public.football_countries(id)    on delete cascade,
  competition_id  uuid references public.football_competitions(id) on delete cascade,
  trophy_id       uuid references public.football_trophies(id)     on delete cascade,
  entity_kind     text generated always as (
    case
      when player_id      is not null then 'player'
      when club_id        is not null then 'club'
      when country_id     is not null then 'country'
      when competition_id is not null then 'competition'
      when trophy_id      is not null then 'trophy'
    end
  ) stored,

  constraint football_external_refs_one_entity
    check (num_nonnulls(player_id, club_id, country_id, competition_id, trophy_id) = 1),
  constraint football_external_refs_provider_valid check (provider in ('sportmonks')),
  constraint football_external_refs_external_unique unique (provider, entity_kind, external_id)
);

create unique index football_external_refs_player_unique      on public.football_external_refs (provider, player_id)      where player_id      is not null;
create unique index football_external_refs_club_unique        on public.football_external_refs (provider, club_id)        where club_id        is not null;
create unique index football_external_refs_country_unique     on public.football_external_refs (provider, country_id)     where country_id     is not null;
create unique index football_external_refs_competition_unique on public.football_external_refs (provider, competition_id) where competition_id is not null;
create unique index football_external_refs_trophy_unique      on public.football_external_refs (provider, trophy_id)      where trophy_id      is not null;

-- ----------------------------------------------------------------------------
-- Categories: the criteria a board is built from.
--
-- Each type means exactly one relationship:
--
--   CLUB         club_id     at least one senior competitive appearance for it
--   NATIONALITY  country_id  that is his football nationality
--   TROPHY       trophy_id   a verified winner or recipient row exists
--
-- A competition on a board is a TROPHY criterion: an axis that says
-- "Champions League" means he won the Champions League. There is deliberately
-- no criterion for having played in a competition.
--
-- There is no polymorphic ref_id. Each target is a real foreign key, and the
-- CHECK below makes sure exactly the one that matches `type` is set, so
-- Postgres itself refuses a category that points at nothing, at the wrong kind
-- of thing, or at something being deleted. A new type (a position, an era) is
-- a new column, a new branch in that CHECK and a new branch in
-- football_category_members, added by a later migration.
--
-- The trophy readiness rule is enforced the same way, declaratively. A TROPHY
-- row carries a copy of its trophy's winners_verified flag, tied to the trophy
-- by a composite foreign key with ON UPDATE CASCADE, so the copy can never
-- disagree with the trophy. An active TROPHY category needs that flag to be
-- true: switching one on for an unverified trophy fails, and so does marking a
-- trophy unverified while a live category still uses it.
--
-- New categories start switched off. Turning one on is a deliberate act.
-- ----------------------------------------------------------------------------

create table public.football_categories (
  id                       uuid primary key default gen_random_uuid(),
  type                     text not null,
  club_id                  uuid references public.football_clubs(id)        on delete restrict,
  country_id               uuid references public.football_countries(id)    on delete restrict,
  trophy_id                uuid,
  trophy_winners_verified  boolean,
  label                    text not null,
  short_label              text,
  active                   boolean not null default false,
  source                   text not null,
  created_at               timestamptz not null default now(),

  constraint football_categories_type_valid
    check (type in ('CLUB', 'NATIONALITY', 'TROPHY')),
  constraint football_categories_target check (
    case type
      when 'CLUB'        then club_id    is not null and num_nonnulls(country_id, trophy_id) = 0
      when 'NATIONALITY' then country_id is not null and num_nonnulls(club_id, trophy_id)    = 0
      when 'TROPHY'      then trophy_id  is not null and num_nonnulls(club_id, country_id)   = 0
      else false
    end
  ),
  constraint football_categories_trophy_flag_pairs
    check ((trophy_id is null) = (trophy_winners_verified is null)),
  constraint football_categories_trophy_fk
    foreign key (trophy_id, trophy_winners_verified)
    references public.football_trophies (id, winners_verified)
    on update cascade on delete restrict,
  constraint football_categories_trophy_winners_verified
    check (type <> 'TROPHY' or not active or trophy_winners_verified),
  constraint football_categories_label_present check (char_length(trim(label)) > 0),
  constraint football_categories_source_valid check (source in ('fixture', 'manual', 'sportmonks'))
);

-- One criterion per target, per type.
create unique index football_categories_club_unique    on public.football_categories (club_id)    where club_id    is not null;
create unique index football_categories_country_unique on public.football_categories (country_id) where country_id is not null;
create unique index football_categories_trophy_unique  on public.football_categories (trophy_id)  where trophy_id  is not null;

-- ----------------------------------------------------------------------------
-- search_name and updated_at, kept current by the database rather than by
-- whoever writes the row. Runs as its owner because normalise_name() (0003) is
-- internal, and the importer writing players does not hold execute on it.
-- ----------------------------------------------------------------------------

create function public.football_players_before_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.search_name := trim(public.normalise_name(new.known_as) || ' ' || public.normalise_name(new.full_name));
  new.updated_at := now();
  return new;
end;
$$;

create trigger football_players_before_write
  before insert or update on public.football_players
  for each row execute function public.football_players_before_write();

-- ----------------------------------------------------------------------------
-- Who satisfies what. The single definition of every criterion: the move
-- validator and the board generator both read this, so they can never
-- disagree about who fits a square.
-- ----------------------------------------------------------------------------

create view public.football_category_members as
  select c.id as category_id, pc.player_id
  from public.football_categories c
  join public.football_player_clubs pc on pc.club_id = c.club_id
  where c.type = 'CLUB' and pc.senior_competitive_apps >= 1

  union

  select c.id, p.id
  from public.football_categories c
  join public.football_players p on p.football_nationality_id = c.country_id
  where c.type = 'NATIONALITY'

  union

  -- Only explicit winner rows, and only for trophies whose winner data is
  -- verified. Nothing here looks at clubs or at who played in the competition.
  select c.id, pt.player_id
  from public.football_categories c
  join public.football_player_trophies pt on pt.trophy_id = c.trophy_id
  where c.type = 'TROPHY' and c.trophy_winners_verified;

comment on view public.football_category_members is
  'Every (category, footballer) pair where the footballer satisfies the category. The one definition of each criterion.';

create function public.football_satisfies(p_player_id uuid, p_category_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.football_category_members m
    where m.category_id = p_category_id and m.player_id = p_player_id
  );
$$;

create function public.football_intersection_size(p_category_a uuid, p_category_b uuid)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int from (
    select player_id from public.football_category_members where category_id = p_category_a
    intersect
    select player_id from public.football_category_members where category_id = p_category_b
  ) both_sides;
$$;

-- ----------------------------------------------------------------------------
-- RPC: football_search_players, for the autocomplete.
--
-- Searches every footballer, never just the ones that fit a square, because a
-- list filtered by the square would give the answer away. Every word typed has
-- to start a word of the name, in any order, accents and punctuation ignored:
-- "jesus gab" finds Gabriel Jesus, "odegaard" finds Ødegaard.
--
-- Order: an exact match on what he is known as, then whole-word matches, then
-- matches on the start of a word; ties by name, then by age, so two
-- footballers with the same name always come back in the same order.
--
-- Each row is only what it takes to pick the right man: his id (what a move
-- submits), what he is known as, his full name and his birth year. Nothing a
-- criterion is built from comes back. On an Arsenal x Brazil square, showing
-- that a footballer's nationality is Brazil would answer half the square before
-- he was even submitted.
-- ----------------------------------------------------------------------------

create function public.football_search_players(p_query text, p_limit int default 10)
returns table (
  id          uuid,
  known_as    text,
  full_name   text,
  birth_year  int
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_query  text := public.normalise_name(left(coalesce(p_query, ''), 80));
  v_words  text[];
  v_limit  int := least(greatest(coalesce(p_limit, 10), 1), 20);
begin
  if char_length(v_query) < 2 then
    return;
  end if;
  v_words := string_to_array(v_query, ' ');

  return query
  select p.id, p.known_as, p.full_name, extract(year from p.date_of_birth)::int
  from public.football_players p
  where not exists (
    select 1 from unnest(v_words) w
    where (' ' || p.search_name) not like ('% ' || w || '%')
  )
  order by
    case
      when public.normalise_name(p.known_as) = v_query then 0
      when not exists (
        select 1 from unnest(v_words) w
        where (' ' || p.search_name || ' ') not like ('% ' || w || ' %')
      ) then 1
      else 2
    end,
    p.known_as,
    p.date_of_birth nulls last,
    p.id
  limit v_limit;
end;
$$;

-- ----------------------------------------------------------------------------
-- Row level security and grants.
--
-- RLS on with no policies denies everything to anyone holding the anon key,
-- and the grants are stripped back to nothing on top of that. The service
-- role, which the importer uses, bypasses RLS. Nothing here is published to
-- Realtime.
-- ----------------------------------------------------------------------------

alter table public.football_countries              enable row level security;
alter table public.football_clubs                  enable row level security;
alter table public.football_competitions           enable row level security;
alter table public.football_trophies               enable row level security;
alter table public.football_players                enable row level security;
alter table public.football_national_teams         enable row level security;
alter table public.football_player_clubs           enable row level security;
alter table public.football_player_trophies        enable row level security;
alter table public.football_player_national_teams  enable row level security;
alter table public.football_external_refs          enable row level security;
alter table public.football_categories             enable row level security;

revoke all on
  public.football_countries, public.football_clubs, public.football_competitions,
  public.football_trophies, public.football_players, public.football_national_teams,
  public.football_player_clubs, public.football_player_trophies, public.football_player_national_teams,
  public.football_external_refs, public.football_categories,
  public.football_category_members
from anon, authenticated;

revoke all on function public.football_players_before_write()      from public, anon, authenticated;
revoke all on function public.football_satisfies(uuid, uuid)         from public, anon, authenticated;
revoke all on function public.football_intersection_size(uuid, uuid) from public, anon, authenticated;

revoke all on function public.football_search_players(text, int) from public;
grant execute on function public.football_search_players(text, int) to anon, authenticated;

commit;
