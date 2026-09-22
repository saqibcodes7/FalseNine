-- ============================================================================
-- False Nine — migration 0006: clocks the host can turn off
--
-- Run this in the Supabase SQL editor AFTER 0001 to 0005 (paste the contents of
-- this file, not its path). It refuses to run twice.
--
-- Pass & Play lets the host wind either clock down to zero and play with no
-- limit. This brings the same option online: zero seconds means the phase has
-- no deadline at all, and rounds.ends_at is simply left null.
--
-- tick() already ignores a null ends_at, so nothing there needs changing: a
-- phase with no deadline can never expire.
--
-- What does need changing is the way out. A timed discussion ends either when
-- everyone presses Vote now or when the clock runs out; a timed vote ends when
-- the result cannot change or when the clock runs out. Take the clock away and
-- each of those loses its fallback, so one player who has put their phone down
-- can hold the table up forever. host_advance() is that fallback: the host can
-- open the vote, or close it and count what is there. It only exists for a
-- phase with no deadline — a phase with a clock has one already.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Refuse to run twice. The earlier migrations get this for free, because they
-- open by adding a column and that fails on its own. This one opens by dropping
-- a constraint, which would quietly succeed a second time and leave the table
-- without it, so it has to say so itself.
-- ----------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'host_advance'
  ) then
    raise exception 'Migration 0006 has already been run on this database';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Constraints. Zero joins the allowed values; every previously legal setting
-- stays legal, so no existing lobby becomes invalid.
-- ----------------------------------------------------------------------------

alter table public.sessions drop constraint sessions_discussion_range;
alter table public.sessions add constraint sessions_discussion_range
  check (discussion_seconds = 0 or discussion_seconds between 60 and 300);

alter table public.sessions drop constraint sessions_voting_range;
alter table public.sessions add constraint sessions_voting_range
  check (voting_seconds = 0 or voting_seconds >= 30);

comment on column public.sessions.discussion_seconds is
  'Length of the discussion, or 0 for no limit, in which case the round has no deadline and the host opens the vote.';
comment on column public.sessions.voting_seconds is
  'Length of the vote, or 0 for no limit, in which case the vote closes when the result cannot change, or when the host closes it.';

-- ----------------------------------------------------------------------------
-- A phase set to zero opens with no deadline.
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
  values (
    p_session_id, p_round, 'discussion', now(),
    case when coalesce(v_seconds, 0) = 0
         then null
         else now() + make_interval(secs => v_seconds) end
  );

  update public.sessions
  set status = 'discussion', current_round = p_round,
      peek_ends_at = null, reveal_ends_at = null
  where id = p_session_id;
end;
$$;

create or replace function public.begin_voting(p_session_id uuid)
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
  values (
    p_session_id, v_session.current_round, 'voting', now(),
    case when coalesce(v_session.voting_seconds, 0) = 0
         then null
         else now() + make_interval(secs => v_session.voting_seconds) end
  );

  update public.sessions set status = 'voting' where id = p_session_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: host_advance (host only) — the way out of a phase with no clock.
--
-- Deliberately refuses when the phase has a deadline. A host who could close a
-- timed vote early would be able to cut the table off mid-thought, and that is
-- not a power this game hands anybody; the clock everyone can see is the
-- authority. This exists only where that clock was turned off.
-- ----------------------------------------------------------------------------

create function public.host_advance(p_session_id uuid, p_player_id uuid)
returns void
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
    raise exception 'Game not found' using errcode = 'no_data_found';
  end if;
  if v_session.host_player_id is distinct from p_player_id then
    raise exception 'Only the host can move the game on' using errcode = 'insufficient_privilege';
  end if;
  if v_session.status not in ('discussion', 'voting') then
    return; -- already moved on; harmless double tap
  end if;

  select ends_at into v_ends from public.rounds
  where session_id = p_session_id
    and round_number = v_session.current_round
    and phase = v_session.status;

  if v_ends is not null then
    raise exception 'This phase has a clock, let it run' using errcode = 'check_violation';
  end if;

  if v_session.status = 'discussion' then
    perform public.begin_voting(p_session_id);
  else
    perform public.tally_votes(p_session_id);
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- Grants.
-- ----------------------------------------------------------------------------

revoke all on function public.host_advance(uuid, uuid)    from public;
grant execute on function public.host_advance(uuid, uuid) to anon, authenticated;
