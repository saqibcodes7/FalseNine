-- ============================================================================
-- False Nine — migration 0007: say it was a tie, and let the table open its
-- own vote
--
-- Run this in the Supabase SQL editor AFTER 0001 to 0006 (paste the contents of
-- this file, not its path). It refuses to run twice.
--
-- 1. A tied vote, or one where the skips won, sent everyone straight into the
--    next discussion with no word about what had happened. From a phone it
--    looked like the round had simply restarted itself. The vote now lands on
--    the reveal screen like any other result — nobody out, here is how it
--    fell — with a short clock on it, and the next round opens when that runs
--    out. Nobody presses anything.
--
--    resolve_reveal() already does the right thing for a round where nobody was
--    eliminated: the counts have not moved, so it starts the next discussion.
--    All that changes here is that tally_votes stops short of doing it itself.
--
-- 2. 0006 gave the host a button to open the vote when the discussion had no
--    clock. That is taken back out: the vote opens when every player still in
--    has pressed Vote now, and that is the only way. host_advance() now works
--    on an unlimited VOTE only, where it is the sole way to close a vote that
--    no majority will ever settle.
-- ============================================================================

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'tie_grace'
  ) then
    raise exception 'Migration 0007 has already been run on this database';
  end if;
end $$;

-- How long the table gets to read a tie. Shorter than a reveal that turns
-- somebody's card over: there is less to take in, and the round is waiting.
create function public.tie_grace()
returns interval
language sql
immutable
as $$ select interval '6 seconds' $$;

-- ----------------------------------------------------------------------------
-- tally_votes: a tie and a majority skip now stop at the reveal.
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

  -- Nobody out, either because the skips had it or because two players drew.
  -- Both land on the reveal so the table is told, and both clear themselves.
  if v_skips * 2 > v_active or v_top is null or v_leaders <> 1 then
    -- Same precedence as before: the skips winning is a skip whatever else
    -- happened, and a draw between players is a tie.
    update public.rounds
    set result = case
                   when v_skips * 2 > v_active then 'skipped'
                   when v_top is null          then 'skipped'
                   else                             'tied'
                 end
    where id = v_round.id;

    insert into public.rounds (session_id, round_number, phase, started_at)
    values (p_session_id, v_session.current_round, 'reveal', now());

    update public.sessions
    set status = 'reveal', reveal_ends_at = now() + public.tie_grace()
    where id = p_session_id;
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
-- host_advance: the vote only, and only when it has no clock.
--
-- Opening the vote is the table's to do, by every player still in pressing
-- Vote now. Closing one is different: a vote with no clock that no majority
-- will settle has no other way to end, so that stays.
-- ----------------------------------------------------------------------------

create or replace function public.host_advance(p_session_id uuid, p_player_id uuid)
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
  if v_session.status <> 'voting' then
    if v_session.status = 'discussion' then
      raise exception 'The vote opens when everyone is ready, not before'
        using errcode = 'check_violation';
    end if;
    return; -- already moved on; harmless double tap
  end if;

  select ends_at into v_ends from public.rounds
  where session_id = p_session_id
    and round_number = v_session.current_round
    and phase = 'voting';

  if v_ends is not null then
    raise exception 'This vote has a clock, let it run' using errcode = 'check_violation';
  end if;

  perform public.tally_votes(p_session_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- Grants. tie_grace is internal.
-- ----------------------------------------------------------------------------

revoke all on function public.tie_grace() from public, anon, authenticated;
