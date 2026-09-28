-- ============================================================================
-- False Nine, rollback for migration 0009 (the football knowledge base)
--
-- Puts the database back exactly as 0008 left it. Run it in the Supabase SQL
-- editor only if you need to undo 0009. It runs as one transaction.
--
-- It refuses to run while Football Tic-Tac-Toe's tables exist, because boards
-- point at these categories; roll that migration back first. It also refuses
-- while any football data other than the fictional fixture is present, because
-- this would delete it for good. Export it first if you mean to.
--
-- The pg_trgm extension is left installed: Supabase may have had it before
-- 0009, and something else may be using it.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.football_players') is null then
    raise exception 'Migration 0009 is not applied to this database';
  end if;
  if to_regclass('public.ttt_boards') is not null or to_regclass('public.ttt_board_axes') is not null then
    raise exception 'Roll back the Football Tic-Tac-Toe migration before 0009';
  end if;
  if exists (select 1 from public.football_countries             where source <> 'fixture')
  or exists (select 1 from public.football_clubs                 where source <> 'fixture')
  or exists (select 1 from public.football_competitions          where source <> 'fixture')
  or exists (select 1 from public.football_trophies              where source <> 'fixture')
  or exists (select 1 from public.football_players               where source <> 'fixture')
  or exists (select 1 from public.football_national_teams        where source <> 'fixture')
  or exists (select 1 from public.football_player_clubs          where source <> 'fixture')
  or exists (select 1 from public.football_player_trophies       where source <> 'fixture')
  or exists (select 1 from public.football_player_national_teams where source <> 'fixture')
  or exists (select 1 from public.football_categories            where source <> 'fixture')
  or exists (select 1 from public.football_external_refs) then
    raise exception 'There is real football data in this database. Rolling back 0009 would delete it; export it first';
  end if;
end $$;

drop function public.football_search_players(text, int);
drop function public.football_intersection_size(uuid, uuid);
drop function public.football_satisfies(uuid, uuid);
drop view public.football_category_members;

drop trigger football_players_before_write on public.football_players;
drop function public.football_players_before_write();

drop table public.football_categories;
drop table public.football_external_refs;
drop table public.football_player_national_teams;
drop table public.football_player_trophies;
drop table public.football_player_clubs;
drop table public.football_national_teams;
drop table public.football_players;
drop table public.football_trophies;
drop table public.football_competitions;
drop table public.football_clubs;
drop table public.football_countries;

commit;
