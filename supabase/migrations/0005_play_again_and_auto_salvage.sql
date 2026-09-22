-- ============================================================================
-- False Nine — migration 0005: play again, and the salvage guess starts itself
--
-- Run this in the Supabase SQL editor AFTER 0001 to 0004 (paste the contents of
-- this file, not its path). It refuses to run twice.
--
-- Two changes, both about taking decisions off the host.
--
-- 1. The last chance was the host's to hand out. When the final imposter was
--    voted out the game stopped on the reveal screen until the host pressed
--    "Give them their last chance", which is not the host's call to make — the
--    imposter has earned that guess by being caught. The reveal now arms a
--    deadline of its own (sessions.reveal_ends_at) in exactly that case, and
--    tick() opens the salvage when it passes. The table still gets to see who
--    went out and that they were the imposter, and the host can still go early.
--
--    Only that one outcome arms a clock. A civilian being voted out still waits
--    on the host, because the gap between rounds is when people actually talk.
--
-- 2. Playing again meant a new lobby and a new code, with everyone typing it in
--    from scratch. play_again() puts a finished game back to 'waiting' with the
--    same code, the same people and the same settings. New players can still
--    join, because a waiting lobby accepts them.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Column
-- ----------------------------------------------------------------------------

alter table public.sessions
  add column reveal_ends_at timestamptz;

comment on column public.sessions.reveal_ends_at is
  'Set when the reveal is the last imposter going out. The salvage guess opens once it passes, so it is not the host''s to hand out.';

-- How long the table gets to read the reveal before the last imposter is put
-- on the spot. Long enough to take in who it was and enjoy it.
create function public.reveal_grace()
returns interval
language sql
immutable
as $$ select interval '10 seconds' $$;

-- ----------------------------------------------------------------------------
-- begin_discussion and end_game clear the new deadline on the way past.
-- ----------------------------------------------------------------------------

create or replace function public.begin_discussion(p_session_id uuid, p_round int)
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
  set status = 'discussion', current_round = p_round,
      peek_ends_at = null, reveal_ends_at = null
  where id = p_session_id;
end;
$$;

create or replace function public.end_game(p_session_id uuid, p_winner text)
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
      peek_ends_at = null,
      reveal_ends_at = null,
      revealed_target = (select target_player_name from public.session_secrets where session_id = p_session_id)
  where id = p_session_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- tally_votes: when the player voted out was the last imposter, the reveal
-- gets a clock. Every other outcome behaves exactly as before.
-- ----------------------------------------------------------------------------

create or replace function public.tally_votes(p_session_id uuid)
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
  v_counts    record;
begin
  select * into v_session from public.sessions where id = p_session_id;
  select * into v_round from public.rounds
  where session_id = p_session_id and round_number = v_session.current_round and phase = 'voting';

  select count(*) into v_active from public.players where session_id = p_session_id and is_active;

  select count(*) into v_skips
  from public.votes v join public.players p on p.id = v.voter_id
  where v.round_id = v_round.id and v.is_skip and p.is_active;

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

  -- Counted after the elimination, so this is who is left.
  select * into v_counts from public.session_counts(p_session_id);

  update public.sessions
  set status = 'reveal',
      reveal_ends_at = case when v_counts.imposters = 0
                            then now() + public.reveal_grace()
                            else null end
  where id = p_session_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- resolve_reveal: what happens after the reveal, with nobody's permission
-- needed. continue_round is now the host's way of asking for it early, and
-- tick() asks for it when the clock runs out.
-- ----------------------------------------------------------------------------

create function public.resolve_reveal(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.sessions%rowtype;
  v_counts  record;
  v_out_id  uuid;
begin
  select * into v_session from public.sessions where id = p_session_id;
  if not found or v_session.status <> 'reveal' then
    return;
  end if;

  select * into v_counts from public.session_counts(p_session_id);

  if v_counts.imposters = 0 then
    select eliminated_player_id into v_out_id from public.rounds
    where session_id = p_session_id and round_number = v_session.current_round and phase = 'voting';

    update public.sessions
    set status = 'salvage', salvage_player_id = v_out_id, reveal_ends_at = null
    where id = p_session_id;
    return;
  end if;

  if v_counts.imposters >= v_counts.civilians then
    perform public.end_game(p_session_id, 'imposters');
    return;
  end if;

  perform public.begin_discussion(p_session_id, v_session.current_round + 1);
end;
$$;

create or replace function public.continue_round(p_session_id uuid, p_player_id uuid)
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
  if v_session.status <> 'reveal' then
    return;
  end if;

  perform public.resolve_reveal(p_session_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- tick: also resolves a reveal whose clock has run out.
-- ----------------------------------------------------------------------------

create or replace function public.tick(p_session_id uuid)
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

  if v_session.status = 'peeking' then
    if v_session.peek_ends_at is not null and v_session.peek_ends_at <= now() then
      perform public.begin_discussion(p_session_id, 1);
    end if;

  elsif v_session.status = 'reveal' then
    if v_session.reveal_ends_at is not null and v_session.reveal_ends_at <= now() then
      perform public.resolve_reveal(p_session_id);
    end if;

  elsif v_session.status in ('discussion', 'voting') then
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
-- RPC: play_again (host only) — same code, same people, fresh game.
--
-- Everything the last game wrote is cleared: the rounds and their votes, the
-- target, the roles, who was out. Everyone who was in the lobby is back in it,
-- including anyone who left mid-game, because leaving mid-game only marks you
-- inactive. The settings are left alone, so the host can start again in one
-- tap or change the pack first.
-- ----------------------------------------------------------------------------

create function public.play_again(p_session_id uuid, p_player_id uuid)
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
    raise exception 'Only the host can start another game' using errcode = 'insufficient_privilege';
  end if;
  if v_session.status = 'waiting' then
    return; -- already back in the lobby; harmless double tap
  end if;
  if v_session.status <> 'ended' then
    raise exception 'Finish this game first' using errcode = 'check_violation';
  end if;

  -- Votes hang off rounds and go with them.
  delete from public.rounds where session_id = p_session_id;
  delete from public.votes  where session_id = p_session_id;
  delete from public.session_secrets where session_id = p_session_id;

  update public.player_secrets s
  set role = null, hint_text = null
  from public.players p
  where p.id = s.player_id and p.session_id = p_session_id;

  update public.players
  set is_active = true, has_peeked = false, vote_ready = false,
      revealed_role = null, eliminated_in_round = null
  where session_id = p_session_id;

  update public.sessions
  set status = 'waiting', current_round = 1, started_at = null,
      peek_ends_at = null, reveal_ends_at = null, winner = null,
      salvage_player_id = null, salvage_guess = null, salvage_correct = null,
      revealed_target = null, ended_at = null
  where id = p_session_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- leave_session: leaving after full time now actually leaves.
--
-- It used to do nothing once the game had ended, on the grounds that the final
-- roster was a record worth keeping intact. play_again changes that: a lobby
-- that can be replayed would carry anyone who had walked away into the next
-- game as a player who never peeks and stalls it. So 'ended' behaves like
-- 'waiting' — a player leaving gives up their seat, and the host leaving closes
-- the lobby, which is what "Close this lobby" says on the tin.
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

  if v_session.status in ('waiting', 'ended') then
    if v_session.host_player_id = p_player_id then
      delete from public.sessions where id = p_session_id;
    else
      delete from public.players where id = p_player_id and session_id = p_session_id;
    end if;
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

  if v_session.status = 'peeking' then
    select count(*) into v_waiting from public.players where session_id = p_session_id and is_active and not has_peeked;
    if v_waiting = 0 then perform public.arm_peek(p_session_id); end if;
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
-- Grants. resolve_reveal and reveal_grace are internal.
-- ----------------------------------------------------------------------------

revoke all on function public.reveal_grace()             from public, anon, authenticated;
revoke all on function public.resolve_reveal(uuid)       from public, anon, authenticated;

revoke all on function public.play_again(uuid, uuid)     from public;
grant execute on function public.play_again(uuid, uuid)  to anon, authenticated;
