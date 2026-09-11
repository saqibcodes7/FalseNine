-- ============================================================================
-- False Nine — migration 0003: the round engine
--
-- Run this in the Supabase SQL editor AFTER 0001 and 0002 (paste the contents
-- of this file, not its path). It refuses to run twice.
--
-- What it adds
--
--   The whole game after "Start game", as sessions.status transitions that
--   every phone follows over Realtime (brief, section 5):
--
--     waiting → peeking → discussion → voting → reveal ─┬→ discussion
--                                        └─(skip/tie)──┘   ├→ salvage → ended
--                                                          └→ ended
--
--   Every transition is a SECURITY DEFINER function below. The browser never
--   writes a row itself, and the two secret tables stay unreadable: a player's
--   own role reaches them only through get_my_card(), and the target name is
--   published on the session only once the game has ended.
--
--   Timers live on rounds.ends_at, set by the server. Clients count down to
--   that instant and call tick() when they reach it; tick() re-checks the
--   clock itself, so a phone with a fast clock cannot end a phase early and a
--   refreshed phone cannot buy time.
--
-- Decisions taken with Saqib (11 Sept 2026) on the gaps the brief left open
--   * votes_visible is a host setting: false shows "4 of 6 have voted", true
--     shows names as they land. Either way the breakdown appears at reveal.
--   * Imposters win outright the moment they are no longer outnumbered. The
--     brief's setup rule (imposters a strict minority) is applied to every
--     round, which removes the 1-v-1 dead end where every vote ties forever.
--   * The host taps Continue on the reveal screen to start the next round.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions for the salvage guess (section 6): accent stripping and
-- Levenshtein distance. Both ship with Supabase.
-- ----------------------------------------------------------------------------

create extension if not exists unaccent      with schema extensions;
create extension if not exists fuzzystrmatch with schema extensions;

-- ----------------------------------------------------------------------------
-- Columns
-- ----------------------------------------------------------------------------

alter table public.sessions
  add column votes_visible     boolean not null default false,
  add column winner            text,
  add column salvage_player_id uuid references public.players(id) on delete set null,
  add column salvage_guess     text,
  add column salvage_correct   boolean,
  add column revealed_target   text,
  add column ended_at          timestamptz;

alter table public.sessions drop constraint sessions_status_valid;
alter table public.sessions add constraint sessions_status_valid
  check (status in ('waiting','peeking','discussion','voting','reveal','salvage','ended'));
alter table public.sessions add constraint sessions_winner_valid
  check (winner is null or winner in ('civilians','imposters'));

comment on column public.sessions.votes_visible is
  'Host setting: show who voted for whom while the vote is open. Off shows only the count.';
comment on column public.sessions.revealed_target is
  'The target footballer, copied out of session_secrets only when the game ends.';

alter table public.players
  add column vote_ready          boolean not null default false,
  add column revealed_role       text,
  add column eliminated_in_round int;

alter table public.players add constraint players_revealed_role_valid
  check (revealed_role is null or revealed_role in ('civilian','imposter'));

comment on column public.players.revealed_role is
  'Public copy of the role, set when the player is voted out or the game ends. Null while it still matters.';

alter table public.rounds
  add column result               text,
  add column eliminated_player_id uuid references public.players(id) on delete set null;

alter table public.rounds add constraint rounds_result_valid
  check (result is null or result in ('eliminated','skipped','tied'));

-- Votes get a session_id so a phone can subscribe to one lobby's votes.
alter table public.votes add column session_id uuid references public.sessions(id) on delete cascade;
update public.votes v set session_id = r.session_id from public.rounds r where r.id = v.round_id and v.session_id is null;
alter table public.votes alter column session_id set not null;
create index votes_session_idx on public.votes (session_id);

-- ----------------------------------------------------------------------------
-- Settings RPCs gain votes_visible (after ai_hints_enabled)
-- ----------------------------------------------------------------------------

drop function public.create_session(text, text, text, int, boolean, int, int);

create function public.create_session(
  p_display_name       text,
  p_player_pack        text    default 'premier_league',
  p_difficulty         text    default 'casual',
  p_num_imposters      int     default 1,
  p_ai_hints_enabled   boolean default false,
  p_votes_visible      boolean default false,
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

  loop
    v_attempt := v_attempt + 1;
    v_code := public.generate_session_code();
    exit when not exists (select 1 from public.sessions s where s.code = v_code);
    if v_attempt >= 10 then
      raise exception 'Could not allocate a session code, please try again';
    end if;
  end loop;

  insert into public.sessions (
    code, player_pack, difficulty, num_imposters, ai_hints_enabled, votes_visible,
    discussion_seconds, voting_seconds, status
  )
  values (
    v_code, p_player_pack, p_difficulty, p_num_imposters, p_ai_hints_enabled, p_votes_visible,
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

drop function public.update_session_settings(uuid, uuid, text, text, int, boolean, int, int);

create function public.update_session_settings(
  p_session_id         uuid,
  p_player_id          uuid,
  p_player_pack        text,
  p_difficulty         text,
  p_num_imposters      int,
  p_ai_hints_enabled   boolean,
  p_votes_visible      boolean,
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
      votes_visible      = coalesce(p_votes_visible, votes_visible),
      discussion_seconds = coalesce(p_discussion_seconds, discussion_seconds),
      voting_seconds     = coalesce(p_voting_seconds, voting_seconds)
  where id = p_session_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Internal helpers. Not callable from the browser (no grants); the public
-- functions below run as the owner and call them.
-- ----------------------------------------------------------------------------

-- Lowercase, strip accents, keep letters/digits/spaces, collapse spaces.
-- "Kylian Mbappé" -> "kylian mbappe"
create function public.normalise_name(p_name text)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select trim(regexp_replace(
    regexp_replace(lower(extensions.unaccent(coalesce(p_name, ''))), '[^a-z0-9 ]', '', 'g'),
    '\s+', ' ', 'g'
  ));
$$;

-- Section 6: close spellings count. One edit for short names, two for longer,
-- and a bare surname is accepted too, since that is how people say footballers.
create function public.guess_matches(p_guess text, p_target text)
returns boolean
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  g text := public.normalise_name(p_guess);
  t text := public.normalise_name(p_target);
  surname text;
  allowed int;
begin
  if g = '' or t = '' then
    return false;
  end if;

  allowed := case when char_length(t) <= 6 then 1 else 2 end;
  if extensions.levenshtein(g, t) <= allowed then
    return true;
  end if;

  surname := split_part(t, ' ', array_length(string_to_array(t, ' '), 1));
  if surname <> t and char_length(surname) >= 4 then
    allowed := case when char_length(surname) <= 6 then 1 else 2 end;
    if extensions.levenshtein(g, surname) <= allowed then
      return true;
    end if;
  end if;

  return false;
end;
$$;

-- Active civilians and imposters, from the secret roles.
create function public.session_counts(p_session_id uuid, out civilians int, out imposters int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    count(*) filter (where s.role = 'civilian')::int,
    count(*) filter (where s.role = 'imposter')::int
  from public.players p
  join public.player_secrets s on s.player_id = p.id
  where p.session_id = p_session_id and p.is_active;
$$;

create function public.begin_discussion(p_session_id uuid, p_round int)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seconds int;
begin
  select discussion_seconds into v_seconds from public.sessions where id = p_session_id;

  update public.players set vote_ready = false where session_id = p_session_id;

  insert into public.rounds (session_id, round_number, phase, started_at, ends_at)
  values (p_session_id, p_round, 'discussion', now(), now() + make_interval(secs => v_seconds));

  update public.sessions
  set status = 'discussion', current_round = p_round
  where id = p_session_id;
end;
$$;

create function public.begin_voting(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.sessions%rowtype;
begin
  select * into v_session from public.sessions where id = p_session_id;

  insert into public.rounds (session_id, round_number, phase, started_at, ends_at)
  values (p_session_id, v_session.current_round, 'voting', now(),
          now() + make_interval(secs => v_session.voting_seconds));

  update public.sessions set status = 'voting' where id = p_session_id;
end;
$$;

create function public.end_game(p_session_id uuid, p_winner text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Everyone's role goes public, and so does the footballer.
  update public.players p
  set revealed_role = s.role
  from public.player_secrets s
  where s.player_id = p.id and p.session_id = p_session_id;

  update public.sessions
  set status = 'ended',
      winner = p_winner,
      ended_at = now(),
      revealed_target = (select target_player_name from public.session_secrets where session_id = p_session_id)
  where id = p_session_id;
end;
$$;

-- Section 5, the vote. Strict-majority skip or a tie: straight back to
-- discussion. Otherwise the most-voted player is out and we go to reveal.
create function public.tally_votes(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session   public.sessions%rowtype;
  v_round     public.rounds%rowtype;
  v_active    int;
  v_skips     int;
  v_top       int;
  v_leaders   int;
  v_out_id    uuid;
  v_out_role  text;
begin
  select * into v_session from public.sessions where id = p_session_id;
  select * into v_round from public.rounds
  where session_id = p_session_id and round_number = v_session.current_round and phase = 'voting';

  select count(*) into v_active from public.players where session_id = p_session_id and is_active;

  select count(*) into v_skips
  from public.votes v join public.players p on p.id = v.voter_id
  where v.round_id = v_round.id and v.is_skip and p.is_active;

  -- Votes for players, counting only votes from active voters for active targets.
  with counted as (
    select v.voted_for_id, count(*) as n
    from public.votes v
    join public.players voter  on voter.id  = v.voter_id
    join public.players target on target.id = v.voted_for_id
    where v.round_id = v_round.id and not v.is_skip and voter.is_active and target.is_active
    group by v.voted_for_id
  )
  select max(n), count(*) filter (where n = (select max(n) from counted))
  into v_top, v_leaders
  from counted;

  if v_skips * 2 > v_active or v_top is null then
    update public.rounds set result = 'skipped' where id = v_round.id;
    perform public.begin_discussion(p_session_id, v_session.current_round + 1);
    return;
  end if;

  if v_leaders <> 1 then
    update public.rounds set result = 'tied' where id = v_round.id;
    perform public.begin_discussion(p_session_id, v_session.current_round + 1);
    return;
  end if;

  select voted_for_id into v_out_id
  from (
    select v.voted_for_id, count(*) as n
    from public.votes v
    join public.players voter  on voter.id  = v.voter_id
    join public.players target on target.id = v.voted_for_id
    where v.round_id = v_round.id and not v.is_skip and voter.is_active and target.is_active
    group by v.voted_for_id
    order by n desc
    limit 1
  ) x;

  select role into v_out_role from public.player_secrets where player_id = v_out_id;

  update public.players
  set is_active = false, revealed_role = v_out_role, eliminated_in_round = v_session.current_round
  where id = v_out_id;

  update public.rounds set result = 'eliminated', eliminated_player_id = v_out_id where id = v_round.id;

  insert into public.rounds (session_id, round_number, phase, started_at)
  values (p_session_id, v_session.current_round, 'reveal', now());

  update public.sessions set status = 'reveal' where id = p_session_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: start_game (host only)
--
-- The browser sends the candidate names for the chosen pack and difficulty
-- and the server picks one at random, so not even the host's phone knows
-- which. Roles are dealt here too.
-- ----------------------------------------------------------------------------

create function public.start_game(
  p_session_id uuid,
  p_player_id  uuid,
  p_candidates text[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.sessions%rowtype;
  v_players int;
  v_target  text;
begin
  select * into v_session from public.sessions where id = p_session_id for update;

  if not found then
    raise exception 'Game not found' using errcode = 'no_data_found';
  end if;
  if v_session.host_player_id is distinct from p_player_id then
    raise exception 'Only the host can start the game' using errcode = 'insufficient_privilege';
  end if;
  if v_session.status <> 'waiting' then
    raise exception 'The game has already started' using errcode = 'check_violation';
  end if;

  select count(*) into v_players from public.players where session_id = p_session_id;
  if v_players < 3 then
    raise exception 'Need at least 3 players to start' using errcode = 'check_violation';
  end if;
  if v_session.num_imposters >= v_players - v_session.num_imposters then
    raise exception 'Imposters have to be outnumbered' using errcode = 'check_violation';
  end if;
  if p_candidates is null or array_length(p_candidates, 1) is null or array_length(p_candidates, 1) < 3 then
    raise exception 'The player pack is empty' using errcode = 'check_violation';
  end if;

  v_target := p_candidates[1 + floor(random() * array_length(p_candidates, 1))::int];
  if v_target is null or char_length(trim(v_target)) = 0 or char_length(v_target) > 80 then
    raise exception 'The player pack has a bad entry' using errcode = 'check_violation';
  end if;

  insert into public.session_secrets (session_id, target_player_name)
  values (p_session_id, trim(v_target))
  on conflict (session_id) do update set target_player_name = excluded.target_player_name;

  -- Deal the roles: shuffle, first num_imposters are imposters.
  with dealt as (
    select p.id, row_number() over (order by random()) as seat
    from public.players p
    where p.session_id = p_session_id
  )
  update public.player_secrets s
  set role = case when d.seat <= v_session.num_imposters then 'imposter' else 'civilian' end,
      hint_text = null
  from dealt d
  where s.player_id = d.id;

  update public.players
  set is_active = true, has_peeked = false, vote_ready = false,
      revealed_role = null, eliminated_in_round = null
  where session_id = p_session_id;

  update public.sessions
  set status = 'peeking', current_round = 1, started_at = now(),
      winner = null, salvage_player_id = null, salvage_guess = null,
      salvage_correct = null, revealed_target = null, ended_at = null
  where id = p_session_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: get_my_card
--
-- The only way a role or the target leaves the database before the end.
-- Returns the caller's role, the footballer if they are a civilian, and the
-- hint if they are an imposter with hints on. Marks them as having peeked;
-- once every active player has, the discussion starts on its own.
-- ----------------------------------------------------------------------------

create function public.get_my_card(p_session_id uuid, p_player_id uuid)
returns table (role text, target_name text, hint_text text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.sessions%rowtype;
  v_player  public.players%rowtype;
  v_secret  public.player_secrets%rowtype;
  v_waiting int;
begin
  select * into v_session from public.sessions where id = p_session_id for update;
  if not found then
    raise exception 'Game not found' using errcode = 'no_data_found';
  end if;

  select * into v_player from public.players p where p.id = p_player_id and p.session_id = p_session_id;
  if not found then
    raise exception 'You are not in this game' using errcode = 'insufficient_privilege';
  end if;
  if v_session.status = 'waiting' then
    raise exception 'The game has not started' using errcode = 'check_violation';
  end if;

  select * into v_secret from public.player_secrets s where s.player_id = p_player_id;

  if v_session.status = 'peeking' and not v_player.has_peeked then
    update public.players set has_peeked = true where id = p_player_id;

    select count(*) into v_waiting
    from public.players p where p.session_id = p_session_id and p.is_active and not p.has_peeked;

    if v_waiting = 0 then
      perform public.begin_discussion(p_session_id, 1);
    end if;
  end if;

  return query select
    v_secret.role,
    case when v_secret.role = 'civilian'
         then (select ss.target_player_name from public.session_secrets ss where ss.session_id = p_session_id)
         else null end,
    case when v_secret.role = 'imposter' then v_secret.hint_text else null end;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: advance_peeking (host only) — "everyone has seen it, let's go"
-- ----------------------------------------------------------------------------

create function public.advance_peeking(p_session_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.sessions%rowtype;
begin
  select * into v_session from public.sessions where id = p_session_id for update;
  if not found then
    raise exception 'Game not found' using errcode = 'no_data_found';
  end if;
  if v_session.host_player_id is distinct from p_player_id then
    raise exception 'Only the host can move the game on' using errcode = 'insufficient_privilege';
  end if;
  if v_session.status <> 'peeking' then
    return; -- already moved on; harmless double tap
  end if;

  perform public.begin_discussion(p_session_id, 1);
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: ready_to_vote — "Vote now". When every active player has pressed it,
-- voting opens early.
-- ----------------------------------------------------------------------------

create function public.ready_to_vote(p_session_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.sessions%rowtype;
  v_waiting int;
begin
  select * into v_session from public.sessions where id = p_session_id for update;
  if not found then
    raise exception 'Game not found' using errcode = 'no_data_found';
  end if;
  if v_session.status <> 'discussion' then
    return;
  end if;

  update public.players set vote_ready = true
  where id = p_player_id and session_id = p_session_id and is_active;

  select count(*) into v_waiting
  from public.players p where p.session_id = p_session_id and p.is_active and not p.vote_ready;

  if v_waiting = 0 then
    perform public.begin_voting(p_session_id);
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: cast_vote — one vote per active player per round, for another active
-- player or a skip. Tallies as soon as the result cannot change: everyone has
-- voted, skips have a strict majority, or one player has a strict majority.
-- ----------------------------------------------------------------------------

create function public.cast_vote(
  p_session_id   uuid,
  p_player_id    uuid,
  p_voted_for_id uuid,
  p_is_skip      boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.sessions%rowtype;
  v_round   public.rounds%rowtype;
  v_active  int;
  v_votes   int;
  v_skips   int;
  v_top     int;
begin
  select * into v_session from public.sessions where id = p_session_id for update;
  if not found then
    raise exception 'Game not found' using errcode = 'no_data_found';
  end if;
  if v_session.status <> 'voting' then
    raise exception 'Voting is not open' using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.players p where p.id = p_player_id and p.session_id = p_session_id and p.is_active) then
    raise exception 'You are out of this game, you cannot vote' using errcode = 'insufficient_privilege';
  end if;

  if not coalesce(p_is_skip, false) then
    if p_voted_for_id is null then
      raise exception 'Pick a player or skip' using errcode = 'check_violation';
    end if;
    if p_voted_for_id = p_player_id then
      raise exception 'You cannot vote for yourself' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.players p where p.id = p_voted_for_id and p.session_id = p_session_id and p.is_active) then
      raise exception 'That player is not in the vote' using errcode = 'check_violation';
    end if;
  end if;

  select * into v_round from public.rounds
  where session_id = p_session_id and round_number = v_session.current_round and phase = 'voting';

  begin
    insert into public.votes (round_id, session_id, voter_id, voted_for_id, is_skip)
    values (v_round.id, p_session_id, p_player_id,
            case when coalesce(p_is_skip, false) then null else p_voted_for_id end,
            coalesce(p_is_skip, false));
  exception when unique_violation then
    raise exception 'You have already voted this round' using errcode = 'unique_violation';
  end;

  select count(*) into v_active from public.players where session_id = p_session_id and is_active;
  select count(*), count(*) filter (where is_skip) into v_votes, v_skips
  from public.votes where round_id = v_round.id;
  select coalesce(max(n), 0) into v_top
  from (select count(*) as n from public.votes where round_id = v_round.id and not is_skip group by voted_for_id) x;

  -- Close the vote early once the result cannot change: everyone has voted,
  -- skips have a strict majority, or one player already has one.
  if v_votes >= v_active or v_skips * 2 > v_active or v_top * 2 > v_active then
    perform public.tally_votes(p_session_id);
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: tick — any phone calls this when its countdown reaches zero. The server
-- checks the clock itself, so an early or duplicate call does nothing.
-- Returns the status afterwards.
-- ----------------------------------------------------------------------------

create function public.tick(p_session_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.sessions%rowtype;
  v_ends    timestamptz;
begin
  select * into v_session from public.sessions where id = p_session_id for update;
  if not found then
    return null;
  end if;

  if v_session.status in ('discussion', 'voting') then
    select ends_at into v_ends from public.rounds
    where session_id = p_session_id and round_number = v_session.current_round and phase = v_session.status;

    if v_ends is not null and v_ends <= now() then
      if v_session.status = 'discussion' then
        perform public.begin_voting(p_session_id);
      else
        perform public.tally_votes(p_session_id);
      end if;
    end if;
  end if;

  select status into v_session.status from public.sessions where id = p_session_id;
  return v_session.status;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: continue_round (host only) — leaves the reveal screen. Goes to the
-- salvage guess if that was the last imposter, ends the game if imposters
-- are no longer outnumbered, otherwise starts the next discussion.
-- ----------------------------------------------------------------------------

create function public.continue_round(p_session_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session   public.sessions%rowtype;
  v_counts    record;
  v_out_id    uuid;
begin
  select * into v_session from public.sessions where id = p_session_id for update;
  if not found then
    raise exception 'Game not found' using errcode = 'no_data_found';
  end if;
  if v_session.host_player_id is distinct from p_player_id then
    raise exception 'Only the host can move the game on' using errcode = 'insufficient_privilege';
  end if;
  if v_session.status <> 'reveal' then
    return;
  end if;

  select * into v_counts from public.session_counts(p_session_id);

  if v_counts.imposters = 0 then
    select eliminated_player_id into v_out_id from public.rounds
    where session_id = p_session_id and round_number = v_session.current_round and phase = 'voting';

    update public.sessions set status = 'salvage', salvage_player_id = v_out_id where id = p_session_id;
    return;
  end if;

  if v_counts.imposters >= v_counts.civilians then
    perform public.end_game(p_session_id, 'imposters');
    return;
  end if;

  perform public.begin_discussion(p_session_id, v_session.current_round + 1);
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: salvage_guess — the last imposter's one shot (section 6).
-- ----------------------------------------------------------------------------

create function public.salvage_guess(p_session_id uuid, p_player_id uuid, p_guess text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.sessions%rowtype;
  v_target  text;
  v_guess   text := trim(coalesce(p_guess, ''));
  v_correct boolean;
begin
  select * into v_session from public.sessions where id = p_session_id for update;
  if not found then
    raise exception 'Game not found' using errcode = 'no_data_found';
  end if;
  if v_session.status <> 'salvage' then
    raise exception 'There is no guess to make right now' using errcode = 'check_violation';
  end if;
  if v_session.salvage_player_id is distinct from p_player_id then
    raise exception 'Only the last imposter gets to guess' using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_guess) = 0 then
    raise exception 'Type a name' using errcode = 'check_violation';
  end if;
  if char_length(v_guess) > 80 then
    v_guess := left(v_guess, 80);
  end if;

  select target_player_name into v_target from public.session_secrets where session_id = p_session_id;
  v_correct := public.guess_matches(v_guess, v_target);

  update public.sessions set salvage_guess = v_guess, salvage_correct = v_correct where id = p_session_id;
  perform public.end_game(p_session_id, case when v_correct then 'imposters' else 'civilians' end);

  return v_correct;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: server_now — so phones can measure their clock against the server's.
-- ----------------------------------------------------------------------------

create function public.server_now()
returns timestamptz
language sql
stable
as $$ select now() $$;

-- ----------------------------------------------------------------------------
-- leave_session: mid-game, leaving marks you out rather than deleting the
-- row, so votes and counts stay coherent. If that leaves no imposters, or
-- leaves them no longer outnumbered, the game ends there and then.
-- ----------------------------------------------------------------------------

create or replace function public.leave_session(
  p_session_id uuid,
  p_player_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.sessions%rowtype;
  v_counts  record;
  v_waiting int;
begin
  select * into v_session from public.sessions s where s.id = p_session_id for update;
  if not found then
    return;
  end if;

  if v_session.status = 'waiting' then
    if v_session.host_player_id = p_player_id then
      delete from public.sessions where id = p_session_id;
    else
      delete from public.players where id = p_player_id and session_id = p_session_id;
    end if;
    return;
  end if;

  if v_session.status = 'ended' then
    return;
  end if;

  update public.players
  set is_active = false, vote_ready = false
  where id = p_player_id and session_id = p_session_id and is_active;

  if not found then
    return;
  end if;

  select * into v_counts from public.session_counts(p_session_id);

  if v_counts.imposters = 0 then
    perform public.end_game(p_session_id, 'civilians');
    return;
  end if;
  if v_counts.imposters >= v_counts.civilians then
    perform public.end_game(p_session_id, 'imposters');
    return;
  end if;

  -- The departed might have been the one everyone was waiting on.
  if v_session.status = 'peeking' then
    select count(*) into v_waiting from public.players where session_id = p_session_id and is_active and not has_peeked;
    if v_waiting = 0 then perform public.begin_discussion(p_session_id, 1); end if;
  elsif v_session.status = 'discussion' then
    select count(*) into v_waiting from public.players where session_id = p_session_id and is_active and not vote_ready;
    if v_waiting = 0 then perform public.begin_voting(p_session_id); end if;
  elsif v_session.status = 'voting' then
    select count(*) into v_waiting
    from public.players p
    where p.session_id = p_session_id and p.is_active
      and not exists (
        select 1 from public.votes v
        join public.rounds r on r.id = v.round_id
        where v.voter_id = p.id and r.session_id = p_session_id
          and r.round_number = v_session.current_round and r.phase = 'voting');
    if v_waiting = 0 then perform public.tally_votes(p_session_id); end if;
  elsif v_session.status = 'salvage' and v_session.salvage_player_id = p_player_id then
    perform public.end_game(p_session_id, 'civilians');
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Grants. Public RPCs: execute for anon. Helpers: nothing for anyone but the
-- owner, so they can only run from inside the functions above.
-- ----------------------------------------------------------------------------

revoke all on function public.create_session(text, text, text, int, boolean, boolean, int, int) from public;
revoke all on function public.update_session_settings(uuid, uuid, text, text, int, boolean, boolean, int, int) from public;
revoke all on function public.start_game(uuid, uuid, text[])            from public;
revoke all on function public.get_my_card(uuid, uuid)                    from public;
revoke all on function public.advance_peeking(uuid, uuid)                from public;
revoke all on function public.ready_to_vote(uuid, uuid)                  from public;
revoke all on function public.cast_vote(uuid, uuid, uuid, boolean)       from public;
revoke all on function public.tick(uuid)                                 from public;
revoke all on function public.continue_round(uuid, uuid)                 from public;
revoke all on function public.salvage_guess(uuid, uuid, text)            from public;
revoke all on function public.server_now()                               from public;

revoke all on function public.normalise_name(text)                       from public, anon, authenticated;
revoke all on function public.guess_matches(text, text)                  from public, anon, authenticated;
revoke all on function public.session_counts(uuid)                       from public, anon, authenticated;
revoke all on function public.begin_discussion(uuid, int)                from public, anon, authenticated;
revoke all on function public.begin_voting(uuid)                         from public, anon, authenticated;
revoke all on function public.end_game(uuid, text)                       from public, anon, authenticated;
revoke all on function public.tally_votes(uuid)                          from public, anon, authenticated;

grant execute on function public.create_session(text, text, text, int, boolean, boolean, int, int) to anon, authenticated;
grant execute on function public.update_session_settings(uuid, uuid, text, text, int, boolean, boolean, int, int) to anon, authenticated;
grant execute on function public.start_game(uuid, uuid, text[])          to anon, authenticated;
grant execute on function public.get_my_card(uuid, uuid)                 to anon, authenticated;
grant execute on function public.advance_peeking(uuid, uuid)             to anon, authenticated;
grant execute on function public.ready_to_vote(uuid, uuid)               to anon, authenticated;
grant execute on function public.cast_vote(uuid, uuid, uuid, boolean)    to anon, authenticated;
grant execute on function public.tick(uuid)                              to anon, authenticated;
grant execute on function public.continue_round(uuid, uuid)              to anon, authenticated;
grant execute on function public.salvage_guess(uuid, uuid, text)         to anon, authenticated;
grant execute on function public.server_now()                            to anon, authenticated;
