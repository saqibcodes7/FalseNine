-- ============================================================================
-- False Nine — migration 0002: difficulty per lobby
--
-- Run this in the Supabase SQL editor AFTER 0001_init.sql (paste the contents
-- of this file, not its path). Safe to run once; it refuses to run twice.
--
-- What changes
--   sessions.difficulty   'casual' | 'ball_aware' | 'you_know_ball'
--                         Casual is the starting XI, Ball Aware adds the bench,
--                         You Know Ball is the whole squad. The pack picks the
--                         era, the difficulty picks how obscure it gets.
--
--   create_session()          gains p_difficulty after p_player_pack
--   update_session_settings() gains p_difficulty after p_player_pack
--
-- Postgres cannot change a function's parameter list with CREATE OR REPLACE
-- (it would create a second overload, and supabase-js would then refuse the
-- call as ambiguous), so the two functions are dropped and recreated. Their
-- bodies are otherwise unchanged from 0001.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Column
-- ----------------------------------------------------------------------------

alter table public.sessions
  add column difficulty text not null default 'casual';

alter table public.sessions
  add constraint sessions_difficulty_valid
  check (difficulty in ('casual', 'ball_aware', 'you_know_ball'));

comment on column public.sessions.difficulty is
  'How deep into the pack the target can be drawn from: casual (starting XI), ball_aware (+bench), you_know_ball (whole squad).';

-- ----------------------------------------------------------------------------
-- RPC: create_session — now takes the difficulty
-- ----------------------------------------------------------------------------

drop function public.create_session(text, text, int, boolean, int, int);

create function public.create_session(
  p_display_name       text,
  p_player_pack        text    default 'premier_league',
  p_difficulty         text    default 'casual',
  p_num_imposters      int     default 1,
  p_ai_hints_enabled   boolean default false,
  p_discussion_seconds int     default 180,
  p_voting_seconds     int     default 60
)
returns table (session_id uuid, code text, player_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name       text := trim(coalesce(p_display_name, ''));
  v_code       text;
  v_session_id uuid;
  v_player_id  uuid;
  v_attempt    int := 0;
begin
  if char_length(v_name) = 0 then
    raise exception 'Enter a display name' using errcode = 'check_violation';
  end if;
  if char_length(v_name) > 20 then
    raise exception 'Display name must be 20 characters or fewer' using errcode = 'check_violation';
  end if;

  -- Retry on the astronomically unlikely code collision rather than 500ing.
  loop
    v_attempt := v_attempt + 1;
    v_code := public.generate_session_code();
    exit when not exists (select 1 from public.sessions s where s.code = v_code);
    if v_attempt >= 10 then
      raise exception 'Could not allocate a session code, please try again';
    end if;
  end loop;

  insert into public.sessions (
    code, player_pack, difficulty, num_imposters, ai_hints_enabled,
    discussion_seconds, voting_seconds, status
  )
  values (
    v_code, p_player_pack, p_difficulty, p_num_imposters, p_ai_hints_enabled,
    p_discussion_seconds, p_voting_seconds, 'waiting'
  )
  returning id into v_session_id;

  insert into public.players (session_id, display_name, is_host)
  values (v_session_id, v_name, true)
  returning id into v_player_id;

  insert into public.player_secrets (player_id) values (v_player_id);

  update public.sessions set host_player_id = v_player_id where id = v_session_id;

  return query select v_session_id, v_code, v_player_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: update_session_settings — now takes the difficulty
-- Host-only. The player id acts as the bearer token: it is a v4 uuid that only
-- ever travelled to the one browser that created the lobby.
-- ----------------------------------------------------------------------------

drop function public.update_session_settings(uuid, uuid, text, int, boolean, int, int);

create function public.update_session_settings(
  p_session_id         uuid,
  p_player_id          uuid,
  p_player_pack        text,
  p_difficulty         text,
  p_num_imposters      int,
  p_ai_hints_enabled   boolean,
  p_discussion_seconds int,
  p_voting_seconds     int
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.sessions%rowtype;
begin
  select * into v_session from public.sessions s where s.id = p_session_id;

  if not found then
    raise exception 'Game not found' using errcode = 'no_data_found';
  end if;

  if v_session.host_player_id is distinct from p_player_id then
    raise exception 'Only the host can change the settings' using errcode = 'insufficient_privilege';
  end if;

  if v_session.status <> 'waiting' then
    raise exception 'Settings are locked once the game starts' using errcode = 'check_violation';
  end if;

  update public.sessions
  set player_pack        = coalesce(p_player_pack, player_pack),
      difficulty         = coalesce(p_difficulty, difficulty),
      num_imposters      = coalesce(p_num_imposters, num_imposters),
      ai_hints_enabled   = coalesce(p_ai_hints_enabled, ai_hints_enabled),
      discussion_seconds = coalesce(p_discussion_seconds, discussion_seconds),
      voting_seconds     = coalesce(p_voting_seconds, voting_seconds)
  where id = p_session_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Grants, same shape as 0001: execute for anon, nothing for public.
-- ----------------------------------------------------------------------------

revoke all on function public.create_session(text, text, text, int, boolean, int, int) from public;
revoke all on function public.update_session_settings(uuid, uuid, text, text, int, boolean, int, int) from public;

grant execute on function public.create_session(text, text, text, int, boolean, int, int) to anon, authenticated;
grant execute on function public.update_session_settings(uuid, uuid, text, text, int, boolean, int, int) to anon, authenticated;
