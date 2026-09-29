-- ============================================================================
-- False Nine, migration 0010: Football Tic-Tac-Toe
--
-- Run this in the Supabase SQL editor AFTER 0001 to 0009 (paste the contents of
-- this file, not its path). It refuses to run twice, and it runs as one
-- transaction.
--
-- Two players, a 3x3 board. Three criteria across the top, three down the
-- side; a square is the meeting of its row and its column. On your turn you
-- pick an empty square and name a footballer who fits both. Three in a row
-- wins.
--
-- The database is the referee. The browser never decides that an answer is
-- right and then writes the square: it asks ttt_submit_move(), which checks
-- everything under a lock and either claims the square or says no.
--
-- ----------------------------------------------------------------------------
-- THE RULES, AS AGREED
--
--   A right answer     claims the square, and the turn passes (unless it wins).
--   A wrong answer     claims nothing, and the turn passes. The player is told
--                      it was wrong, never which half of the square it missed;
--                      that is kept server-side for diagnostics only.
--   Refused, turn kept not your turn, square already taken, board over, not in
--                      the game, unknown footballer, or a footballer who has
--                      already claimed a square on this board. Nothing is
--                      recorded and nobody's turn is used up.
--   Pass               records the pass and hands the turn over.
--   Win                three squares in a row, column or diagonal.
--   Draw               the board is full, or no empty square has any unused
--                      footballer left who fits it. A game never ends early
--                      just because nobody can complete a line any more.
--   Who starts         a coin toss on the server for the first board of a
--                      match, and that player is X. On a rematch the marks stay
--                      with the same people and the starter alternates. A new
--                      opponent starts a new match, with a new coin toss.
--   No turn timer.
--   Difficulty         the host can change it in the lobby and between boards,
--                      never while a board is in play. The next board uses it.
--
-- WHO IS ACTING
--
--   Every seat belongs to a signed-in user: the anonymous Supabase user the
--   app creates silently, with no sign-up screen. seat_owners records which
--   user holds which seat. None of the Tic-Tac-Toe RPCs take a player id: each
--   one works out the acting seat from auth.uid() and the lobby, under the
--   lobby's lock. A player id is visible to everyone in the lobby and proves
--   nothing, so knowing someone else's gets you nowhere. leave_session, which
--   every game shares, still takes one for Football Imposter's sake; for a
--   Tic-Tac-Toe lobby it refuses to leave any seat but the caller's own.
--
-- LEAVING (leave_session, which every game shares)
--
--   Before kick-off, or once the lobby has ended: as for every game, the host
--   leaving closes the lobby and anyone else gives up their seat.
--   Opponent, mid-board or between boards: the board in play (if any) goes to
--   the host by forfeit, the opponent's seat is removed, and the lobby goes
--   back to waiting on the same code so someone else can join.
--   Host, mid-board: the host is marked out and keeps their seat, the board
--   goes to the opponent by forfeit, and the lobby ends. This is Football
--   Imposter's existing mid-game rule; nobody inherits the host role.
--   Host, between boards: the lobby closes for everyone, as before kick-off.
--
-- ----------------------------------------------------------------------------
-- BOARDS
--
-- A board is built from football_categories (migration 0009) and nothing
-- else: there are no hand-written answer lists. Before a board is shown, every
-- square is checked to have at least one footballer who fits it, and the
-- number of footballers who fit each square is kept (server-side only) as
-- that square's size.
--
-- Difficulty comes from those sizes, in bands you can tune without touching
-- code (ttt_difficulty_bands). A board's difficulty is that of its hardest
-- square: an Easy board has every square at 11 or more, a Medium board has
-- every square at 5 or more and at least one at 10 or fewer, and so on. The
-- 'standard' profile is the product definition; 'dev' exists only so the
-- small fictional fixture can make a board at every difficulty, and nothing
-- switches to it unless a test database asks.
--
-- The board rules (build a board, check an answer against a square, find a
-- winning line, ask whether any square is still answerable) know nothing
-- about lobbies, seats or turns. The online game wraps them. A pass-and-play
-- mode can reuse them with turns of its own.
--
-- ----------------------------------------------------------------------------
-- WHAT THE BROWSER CAN SEE
--
-- A Tic-Tac-Toe lobby is readable only from a seat in it: its sessions and
-- players rows, and its ttt_settings, ttt_games, ttt_moves, ttt_boards and
-- ttt_board_axes. A seat counts while it exists, so a host who walked out
-- mid-board can still see how it ended, and an opponent who joins later can
-- see the lobby's earlier boards. sessions, players, ttt_settings, ttt_games
-- and ttt_moves are published to Realtime, which checks these same policies,
-- as the subscriber, before sending an insert or update, so a phone only
-- hears about its own lobby. Realtime cannot check a policy against a row
-- that has been deleted: with row level security on, it sends deletes with
-- the primary key only, so a subscriber can learn that some seat id went,
-- and nothing else. Football Imposter lobbies read exactly as before.
-- ttt_lines, the eight winning lines, is readable by anyone.
-- Readable by nobody: each square's size (ttt_board_cells), why a wrong answer
-- was wrong (ttt_move_checks), who owns which seat (seat_owners), and the
-- difficulty configuration.
--
-- supabase/rollback/0010_rollback.sql undoes all of this.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.ttt_games') is not null then
    raise exception 'Migration 0010 has already been run on this database';
  end if;
  if to_regclass('public.football_category_members') is null then
    raise exception 'Run migrations 0001 to 0009 before 0010';
  end if;
  -- Every Supabase project has this. A plain Postgres gets a stand-in from
  -- supabase/tests/_supabase_shim.sql.
  if to_regprocedure('auth.uid()') is null then
    raise exception 'Migration 0010 needs Supabase Auth: auth.uid() is missing';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Keys that let Tic-Tac-Toe rows say, declaratively, "this belongs to a
-- Tic-Tac-Toe session", "this is a seat in that same session" and "this
-- snapshot is of that criterion's real type". Each target is already unique
-- by its primary key, so these add no restriction of their own.
-- ----------------------------------------------------------------------------

alter table public.sessions            add constraint sessions_id_game_mode_unique        unique (id, game_mode);
alter table public.players             add constraint players_id_session_unique           unique (id, session_id);
alter table public.football_categories add constraint football_categories_id_type_unique  unique (id, type);

-- ----------------------------------------------------------------------------
-- The eight lines. Squares are numbered 0 to 8, left to right, top to bottom:
--
--      0 | 1 | 2
--      3 | 4 | 5
--      6 | 7 | 8
-- ----------------------------------------------------------------------------

create table public.ttt_lines (
  line   smallint primary key,
  cells  smallint[] not null unique,
  kind   text not null,

  constraint ttt_lines_line_range check (line between 0 and 7),
  constraint ttt_lines_kind_valid check (kind in ('row', 'column', 'diagonal')),
  constraint ttt_lines_three_cells check (array_length(cells, 1) = 3 and cells <@ '{0,1,2,3,4,5,6,7,8}'::smallint[])
);

insert into public.ttt_lines (line, cells, kind) values
  (0, '{0,1,2}', 'row'),
  (1, '{3,4,5}', 'row'),
  (2, '{6,7,8}', 'row'),
  (3, '{0,3,6}', 'column'),
  (4, '{1,4,7}', 'column'),
  (5, '{2,5,8}', 'column'),
  (6, '{0,4,8}', 'diagonal'),
  (7, '{2,4,6}', 'diagonal');

-- ----------------------------------------------------------------------------
-- Difficulty: profiles of bands, and which profile is live.
-- ----------------------------------------------------------------------------

create table public.ttt_threshold_profiles (
  id           text primary key,
  description  text not null,

  constraint ttt_threshold_profiles_id_format check (id ~ '^[a-z][a-z0-9_]*$')
);

create table public.ttt_difficulty_bands (
  profile      text not null references public.ttt_threshold_profiles(id) on delete cascade,
  difficulty   text not null,
  -- A board at this difficulty has every square at least this big...
  min_answers  int  not null,
  -- ...and its hardest square no bigger than this. Null for no upper limit.
  max_answers  int,

  primary key (profile, difficulty),
  constraint ttt_difficulty_bands_difficulty_valid check (difficulty in ('easy', 'medium', 'hard', 'extreme')),
  constraint ttt_difficulty_bands_min check (min_answers >= 1),
  constraint ttt_difficulty_bands_max check (max_answers is null or max_answers >= min_answers)
);

comment on table public.ttt_difficulty_bands is
  'A board''s difficulty is its hardest square: every square has at least min_answers footballers who fit, and the smallest has at most max_answers. Tune here; no code changes.';

-- Exactly one row: which profile boards are generated with.
create table public.ttt_config (
  singleton       boolean primary key default true,
  active_profile  text not null references public.ttt_threshold_profiles(id),

  constraint ttt_config_one_row check (singleton)
);

insert into public.ttt_threshold_profiles (id, description) values
  ('standard', 'The product definition. Squares with 1 answer are Extreme, 2 to 4 Hard, 5 to 10 Medium, 11 or more Easy.'),
  ('dev',      'For the small fictional test fixture only: any board where every square has an answer counts at every difficulty. Never make this live on a real database.');

insert into public.ttt_difficulty_bands (profile, difficulty, min_answers, max_answers) values
  ('standard', 'easy',    11, null),
  ('standard', 'medium',   5,   10),
  ('standard', 'hard',     2,    4),
  ('standard', 'extreme',  1,    1),
  ('dev',      'easy',     1, null),
  ('dev',      'medium',   1, null),
  ('dev',      'hard',     1, null),
  ('dev',      'extreme',  1, null);

insert into public.ttt_config (active_profile) values ('standard');

-- ----------------------------------------------------------------------------
-- Per-lobby settings. Only difficulty for now. Lives here rather than on
-- sessions, which belongs to every game.
-- ----------------------------------------------------------------------------

create table public.ttt_settings (
  session_id  uuid primary key,
  game_mode   text not null default 'tic_tac_toe',
  difficulty  text not null default 'medium',

  constraint ttt_settings_mode check (game_mode = 'tic_tac_toe'),
  constraint ttt_settings_difficulty_valid check (difficulty in ('easy', 'medium', 'hard', 'extreme')),
  constraint ttt_settings_session_fk
    foreign key (session_id, game_mode) references public.sessions (id, game_mode) on delete cascade
);

-- ----------------------------------------------------------------------------
-- Boards. Written once, in one transaction, and never changed.
-- ----------------------------------------------------------------------------

create table public.ttt_boards (
  id                 uuid primary key default gen_random_uuid(),
  difficulty         text not null,
  threshold_profile  text not null references public.ttt_threshold_profiles(id) on delete restrict,
  created_at         timestamptz not null default now(),

  constraint ttt_boards_difficulty_valid check (difficulty in ('easy', 'medium', 'hard', 'extreme'))
);

create table public.ttt_board_axes (
  board_id       uuid not null references public.ttt_boards(id) on delete cascade,
  axis           text not null,
  position       smallint not null,
  category_id    uuid not null,
  -- Snapshots, so the board reads the same whatever happens to the criterion
  -- later. The type is tied to the criterion's real type by the foreign key.
  category_type  text not null,
  label          text not null,
  short_label    text,

  primary key (board_id, axis, position),
  constraint ttt_board_axes_axis_valid check (axis in ('row', 'col')),
  constraint ttt_board_axes_position_range check (position between 0 and 2),
  constraint ttt_board_axes_label_present check (char_length(trim(label)) > 0),
  -- The same criterion cannot appear twice on a board, as two rows, two
  -- columns, or a row and a column.
  constraint ttt_board_axes_distinct unique (board_id, category_id),
  constraint ttt_board_axes_category_fk
    foreign key (category_id, category_type) references public.football_categories (id, type) on delete restrict
);

-- How many footballers fit each square, when the board was made. Server-side
-- only: it says how hard a square is, which is the board generator's business
-- rather than the players'.
create table public.ttt_board_cells (
  board_id      uuid not null references public.ttt_boards(id) on delete cascade,
  cell          smallint not null,
  answer_count  int not null,

  primary key (board_id, cell),
  constraint ttt_board_cells_cell_range check (cell between 0 and 8),
  -- A square nobody fits is never allowed on a board.
  constraint ttt_board_cells_answerable check (answer_count >= 1)
);

-- ----------------------------------------------------------------------------
-- Games: one row per board played in a lobby.
--
-- Marks are stored as 'X' and 'O' rather than as players, so the record of a
-- finished board still makes sense after someone has left and their seat has
-- gone: the seat columns go null, the names stay.
-- ----------------------------------------------------------------------------

create table public.ttt_games (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null,
  game_mode     text not null default 'tic_tac_toe',
  board_number  int  not null,
  board_id      uuid not null unique references public.ttt_boards(id) on delete restrict,
  x_player_id   uuid,
  o_player_id   uuid,
  x_name        text not null,
  o_name        text not null,
  starter_mark  text not null,
  turn_mark     text,
  status        text not null default 'playing',
  end_reason    text,
  winner_mark   text,
  winning_line  smallint references public.ttt_lines(line),
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,

  constraint ttt_games_mode check (game_mode = 'tic_tac_toe'),
  constraint ttt_games_session_fk
    foreign key (session_id, game_mode) references public.sessions (id, game_mode) on delete cascade,
  constraint ttt_games_x_seat_fk
    foreign key (x_player_id, session_id) references public.players (id, session_id) on delete set null (x_player_id),
  constraint ttt_games_o_seat_fk
    foreign key (o_player_id, session_id) references public.players (id, session_id) on delete set null (o_player_id),
  constraint ttt_games_board_number unique (session_id, board_number),
  constraint ttt_games_board_number_positive check (board_number >= 1),
  -- The target for ttt_moves' foreign key.
  constraint ttt_games_id_session unique (id, session_id),
  constraint ttt_games_two_people check (x_player_id <> o_player_id),
  constraint ttt_games_marks_valid
    check (starter_mark in ('X', 'O') and (turn_mark is null or turn_mark in ('X', 'O'))
           and (winner_mark is null or winner_mark in ('X', 'O'))),
  constraint ttt_games_status_valid check (status in ('playing', 'won', 'drawn', 'forfeited')),
  -- Somebody's turn exactly while the board is in play.
  constraint ttt_games_turn check ((status = 'playing') = (turn_mark is not null)),
  -- Each way a board can end carries exactly the facts that belong to it.
  constraint ttt_games_ending check (
    case status
      when 'playing'   then end_reason is null and winner_mark is null and winning_line is null and ended_at is null
      when 'won'       then end_reason = 'line' and winner_mark is not null and winning_line is not null and ended_at is not null
      when 'drawn'     then end_reason in ('board_full', 'no_answers_left') and winner_mark is null and winning_line is null and ended_at is not null
      when 'forfeited' then end_reason = 'forfeit' and winner_mark is not null and winning_line is null and ended_at is not null
      else false
    end
  )
);

-- One board in play per lobby at a time.
create unique index ttt_games_one_in_play on public.ttt_games (session_id) where status = 'playing';

-- ----------------------------------------------------------------------------
-- Moves: every turn that was used up. Refused attempts are never recorded.
-- ----------------------------------------------------------------------------

create table public.ttt_moves (
  id                  uuid primary key default gen_random_uuid(),
  game_id             uuid not null,
  session_id          uuid not null,
  move_number         int  not null,
  player_id           uuid,
  mark                text not null,
  kind                text not null,
  cell                smallint,
  football_player_id  uuid references public.football_players(id) on delete restrict,
  -- What the footballer is known as, at the time. Shown on the board.
  footballer_name     text,
  created_at          timestamptz not null default now(),

  constraint ttt_moves_game_fk
    foreign key (game_id, session_id) references public.ttt_games (id, session_id) on delete cascade,
  constraint ttt_moves_seat_fk
    foreign key (player_id, session_id) references public.players (id, session_id) on delete set null (player_id),
  constraint ttt_moves_number unique (game_id, move_number),
  constraint ttt_moves_number_positive check (move_number >= 1),
  -- The target for ttt_move_checks' foreign key.
  constraint ttt_moves_id_kind unique (id, kind),
  constraint ttt_moves_mark_valid check (mark in ('X', 'O')),
  constraint ttt_moves_kind_valid check (kind in ('claim', 'wrong', 'pass')),
  constraint ttt_moves_cell_range check (cell is null or cell between 0 and 8),
  -- A claim and a wrong answer name a square and a footballer; a pass names
  -- neither.
  constraint ttt_moves_shape check (
    case kind
      when 'pass' then cell is null and football_player_id is null and footballer_name is null
      else cell is not null and football_player_id is not null and footballer_name is not null
    end
  )
);

-- The backstops behind the checks in ttt_submit_move(): a square is claimed
-- once, and a footballer claims one square per board.
create unique index ttt_moves_one_claim_per_square on public.ttt_moves (game_id, cell)               where kind = 'claim';
create unique index ttt_moves_footballer_once      on public.ttt_moves (game_id, football_player_id) where kind = 'claim';
create index ttt_moves_session_idx on public.ttt_moves (session_id);

-- Why a wrong answer was wrong. Server-side only, never shown to a player.
-- Tied by foreign key to a move whose kind is 'wrong', so a right answer can
-- never carry one.
create table public.ttt_move_checks (
  move_id  uuid primary key,
  kind     text not null default 'wrong',
  row_ok   boolean not null,
  col_ok   boolean not null,

  constraint ttt_move_checks_kind check (kind = 'wrong'),
  constraint ttt_move_checks_move_fk
    foreign key (move_id, kind) references public.ttt_moves (id, kind) on delete cascade,
  constraint ttt_move_checks_was_wrong check (not (row_ok and col_ok))
);

-- ----------------------------------------------------------------------------
-- Who holds each seat.
--
-- A Tic-Tac-Toe seat belongs to the signed-in user who created or joined the
-- lobby. The binding lives here rather than on players, which every game
-- shares and the browser can read: nobody but the functions below can read
-- this table, and it is not published to Realtime, so no one learns anyone
-- else's user id. Football Imposter seats have no row here and work exactly
-- as they always have.
-- ----------------------------------------------------------------------------

create table public.seat_owners (
  player_id     uuid primary key,
  session_id    uuid not null,
  auth_user_id  uuid not null,
  created_at    timestamptz not null default now(),

  constraint seat_owners_seat_fk
    foreign key (player_id, session_id) references public.players (id, session_id) on delete cascade,
  -- One seat per person per lobby: nobody plays both X and O.
  constraint seat_owners_one_seat_each unique (session_id, auth_user_id)
);

-- ----------------------------------------------------------------------------
-- Invariants that need a trigger rather than a CHECK.
--
-- The ones that read tables run as their owner. A deferred trigger fires at
-- commit as whoever committed, which for a game is the browser's role, and
-- that role cannot read a board's square sizes.
-- ----------------------------------------------------------------------------

-- Boards, their squares, the lines and the move history are write-once.
create function public.ttt_forbid_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception '% rows are written once and never changed', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

create trigger ttt_lines_fixed        before update or delete on public.ttt_lines       for each row execute function public.ttt_forbid_change();
create trigger ttt_boards_fixed       before update           on public.ttt_boards      for each row execute function public.ttt_forbid_change();
create trigger ttt_board_axes_fixed   before update           on public.ttt_board_axes  for each row execute function public.ttt_forbid_change();
create trigger ttt_board_cells_fixed  before update           on public.ttt_board_cells for each row execute function public.ttt_forbid_change();
create trigger ttt_move_checks_fixed  before update           on public.ttt_move_checks for each row execute function public.ttt_forbid_change();
create trigger seat_owners_fixed      before update           on public.seat_owners     for each row execute function public.ttt_forbid_change();

-- A move never changes either, with one exception: when someone leaves and
-- their seat is removed, the foreign key clears player_id. The mark stays.
create function public.ttt_moves_before_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_unchanged public.ttt_moves;
begin
  v_unchanged := new;
  v_unchanged.player_id := old.player_id;
  if new.player_id is not null or v_unchanged is distinct from old then
    raise exception 'ttt_moves rows are written once and never changed' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger ttt_moves_fixed before update on public.ttt_moves
  for each row execute function public.ttt_moves_before_update();

-- A row or column cannot be taken off a board, nor a square's size, while
-- the board exists. Deleting the board itself takes them with it: by the time
-- the cascade reaches them, the board row is already gone.
create function public.ttt_keep_board_whole()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.ttt_boards b where b.id = old.board_id) then
    raise exception 'A board is changed only by deleting it whole' using errcode = 'restrict_violation';
  end if;
  return old;
end;
$$;

create trigger ttt_board_axes_whole  before delete on public.ttt_board_axes  for each row execute function public.ttt_keep_board_whole();
create trigger ttt_board_cells_whole before delete on public.ttt_board_cells for each row execute function public.ttt_keep_board_whole();

-- By the end of the transaction that makes it, a board has exactly three
-- rows, three columns and nine squares.
create function public.ttt_check_board_complete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.ttt_boards b where b.id = new.id) and (
       (select count(*) from public.ttt_board_axes a where a.board_id = new.id and a.axis = 'row') <> 3
    or (select count(*) from public.ttt_board_axes a where a.board_id = new.id and a.axis = 'col') <> 3
    or (select count(*) from public.ttt_board_cells c where c.board_id = new.id) <> 9
  ) then
    raise exception 'A board needs three rows, three columns and nine squares' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger ttt_boards_complete
  after insert on public.ttt_boards
  deferrable initially deferred
  for each row execute function public.ttt_check_board_complete();

-- A board in play has both its players seated. Checked at the end of the
-- transaction rather than per statement, so deleting a whole lobby (which
-- removes seats and games in whichever order Postgres chooses) still works.
create function public.ttt_check_game_seated()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.ttt_games g
    where g.id = new.id and g.status = 'playing' and (g.x_player_id is null or g.o_player_id is null)
  ) then
    raise exception 'A board in play needs both of its players' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger ttt_games_seated
  after insert or update on public.ttt_games
  deferrable initially deferred
  for each row execute function public.ttt_check_game_seated();

-- Every Tic-Tac-Toe seat has an owner by the end of the transaction that
-- makes it, and keeps one for as long as the seat exists: an owner row goes
-- only with its seat. Football Imposter seats are left alone.
create function public.ttt_check_seat_owned()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seat uuid;
begin
  if tg_table_name = 'players' then
    v_seat := new.id;
  else
    v_seat := old.player_id;
  end if;

  if exists (
    select 1
    from public.players p
    join public.sessions s on s.id = p.session_id
    where p.id = v_seat and s.game_mode = 'tic_tac_toe'
      and not exists (select 1 from public.seat_owners o where o.player_id = p.id)
  ) then
    raise exception 'A Football Tic-Tac-Toe seat needs an owner' using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger players_ttt_seat_owned
  after insert on public.players
  deferrable initially deferred
  for each row execute function public.ttt_check_seat_owned();

create constraint trigger seat_owners_kept
  after delete on public.seat_owners
  deferrable initially deferred
  for each row execute function public.ttt_check_seat_owned();

-- A game's board goes when the game does. Each board belongs to one game.
create function public.ttt_games_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.ttt_boards b where b.id = old.board_id;
  return null;
end;
$$;

create trigger ttt_games_drop_board after delete on public.ttt_games
  for each row execute function public.ttt_games_after_delete();

-- ----------------------------------------------------------------------------
-- Board rules. None of these know about lobbies, seats or turns.
-- ----------------------------------------------------------------------------

create function public.ttt_active_profile()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select c.active_profile from public.ttt_config c $$;

-- Does a board with these nine square sizes count as this difficulty?
create function public.ttt_board_meets(p_counts int[], p_difficulty text, p_profile text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_band     public.ttt_difficulty_bands%rowtype;
  v_hardest  int;
begin
  select * into v_band from public.ttt_difficulty_bands b
  where b.profile = p_profile and b.difficulty = p_difficulty;
  if not found then
    raise exception 'There is no % band in the % profile', p_difficulty, p_profile
      using errcode = 'invalid_parameter_value';
  end if;

  if coalesce(array_length(p_counts, 1), 0) <> 9 or array_position(p_counts, null) is not null then
    return false;
  end if;

  select min(c) into v_hardest from unnest(p_counts) c;
  return v_hardest >= v_band.min_answers
     and (v_band.max_answers is null or v_hardest <= v_band.max_answers);
end;
$$;

-- Build and save a board from three row and three column criteria. Refuses
-- anything that is not a legal board at the given difficulty.
create function public.ttt_build_board(p_rows uuid[], p_cols uuid[], p_difficulty text, p_profile text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_all     uuid[] := coalesce(p_rows, '{}') || coalesce(p_cols, '{}');
  v_counts  int[]  := '{}';
  v_board   uuid;
  r         int;
  c         int;
begin
  if coalesce(array_length(p_rows, 1), 0) <> 3 or coalesce(array_length(p_cols, 1), 0) <> 3 then
    raise exception 'A board has three rows and three columns' using errcode = 'check_violation';
  end if;
  if (select count(distinct x) from unnest(v_all) x) <> 6 then
    raise exception 'A criterion can appear only once on a board' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.football_categories fc where fc.id = any (v_all) and fc.active) <> 6 then
    raise exception 'Every criterion on a board has to exist and be switched on' using errcode = 'check_violation';
  end if;

  for r in 1..3 loop
    for c in 1..3 loop
      v_counts := v_counts || public.football_intersection_size(p_rows[r], p_cols[c]);
    end loop;
  end loop;

  if 0 = any (v_counts) then
    raise exception 'Every square needs at least one footballer who fits it' using errcode = 'check_violation';
  end if;
  if not public.ttt_board_meets(v_counts, p_difficulty, p_profile) then
    raise exception 'That board is not % in the % profile', p_difficulty, p_profile using errcode = 'check_violation';
  end if;

  insert into public.ttt_boards (difficulty, threshold_profile)
  values (p_difficulty, p_profile)
  returning id into v_board;

  insert into public.ttt_board_axes (board_id, axis, position, category_id, category_type, label, short_label)
  select v_board, a.axis, a.position, fc.id, fc.type, fc.label, fc.short_label
  from (
    select 'row' as axis, (i - 1)::smallint as position, p_rows[i] as category_id from generate_series(1, 3) i
    union all
    select 'col', (i - 1)::smallint, p_cols[i] from generate_series(1, 3) i
  ) a
  join public.football_categories fc on fc.id = a.category_id;

  insert into public.ttt_board_cells (board_id, cell, answer_count)
  select v_board, (i - 1)::smallint, v_counts[i] from generate_series(1, 9) i;

  return v_board;
end;
$$;

-- Make a random board at a difficulty, from the switched-on criteria.
--
-- Picking six criteria at random almost never works on real football data:
-- footballers cluster by country and era, so three random rows rarely share
-- enough of them to support any column. So each attempt grows a board from one
-- square that works:
--
--   1. a random criterion, and a random partner that meets it with a number
--      of footballers inside the band: the square that makes the board this
--      difficulty is there from the start;
--   2. two more rows that also meet that partner;
--   3. every criterion that meets all three rows with enough footballers.
--
-- The first column is drawn from those whose hardest meeting is within the
-- band's ceiling, so the board really is that difficulty; the other two from
-- any that qualify. Rows and columns are shuffled, and half the time swapped,
-- so nothing about how the board was found shows on it. ttt_build_board()
-- then checks every square again before anything is saved.
--
-- Each membership lookup first collects the footballers of one criterion and
-- then fetches only their other memberships, so it runs on the per-footballer
-- indexes instead of reading every membership there is.
--
-- It gives up after 40 attempts or three seconds, whichever comes first, with
-- a message the host can act on.
create function public.ttt_generate_board(p_difficulty text, p_profile text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile     text := coalesce(p_profile, public.ttt_active_profile());
  v_band        public.ttt_difficulty_bands%rowtype;
  v_candidates  uuid[];
  v_count       int;
  v_deadline    timestamptz := clock_timestamp() + interval '3 seconds';
  v_seed        uuid;
  v_partner     uuid;
  v_rows        uuid[];
  v_pool        uuid[];
  v_first       uuid;
  v_others      uuid[];
  v_cols        uuid[];
  v_attempt     int;
begin
  select * into v_band from public.ttt_difficulty_bands b
  where b.profile = v_profile and b.difficulty = p_difficulty;
  if not found then
    raise exception 'There is no % band in the % profile', p_difficulty, v_profile
      using errcode = 'invalid_parameter_value';
  end if;

  -- A criterion with fewer footballers than the band's floor can never meet
  -- anything with enough of them.
  select array_agg(fc.id) into v_candidates
  from public.football_categories fc
  join (
    select m.category_id from public.football_category_members m
    group by m.category_id having count(*) >= v_band.min_answers
  ) big on big.category_id = fc.id
  where fc.active;
  v_count := coalesce(array_length(v_candidates, 1), 0);

  if v_count >= 6 then
    for v_attempt in 1..40 loop
      exit when clock_timestamp() > v_deadline;

      -- 1. A seed and a partner that meets it within the band.
      v_seed := v_candidates[1 + floor(random() * v_count)::int];
      select array_agg(m.player_id) into v_pool
      from public.football_category_members m where m.category_id = v_seed;

      select m.category_id into v_partner
      from public.football_category_members m
      where m.player_id = any (v_pool) and m.category_id = any (v_candidates) and m.category_id <> v_seed
      group by m.category_id
      having count(*) >= v_band.min_answers and (v_band.max_answers is null or count(*) <= v_band.max_answers)
      order by random() limit 1;
      continue when v_partner is null;

      -- 2. Two more rows that also meet the partner.
      select array_agg(m.player_id) into v_pool
      from public.football_category_members m where m.category_id = v_partner;

      select array[v_seed] || array_agg(x) into v_rows
      from (
        select m.category_id as x
        from public.football_category_members m
        where m.player_id = any (v_pool) and m.category_id = any (v_candidates)
          and m.category_id <> all (array[v_seed, v_partner])
        group by m.category_id having count(*) >= v_band.min_answers
        order by random() limit 2
      ) more;
      continue when coalesce(array_length(v_rows, 1), 0) <> 3;

      -- 3. Columns that meet all three rows.
      select array_agg(distinct m.player_id) into v_pool
      from public.football_category_members m where m.category_id = any (v_rows);

      with meets as (
        select c.category_id as col,
               count(*) filter (where r.category_id = v_rows[1]) as n1,
               count(*) filter (where r.category_id = v_rows[2]) as n2,
               count(*) filter (where r.category_id = v_rows[3]) as n3
        from (select m.category_id, m.player_id from public.football_category_members m
              where m.category_id = any (v_rows)) r
        join (select m.category_id, m.player_id from public.football_category_members m
              where m.player_id = any (v_pool) and m.category_id = any (v_candidates)
                and m.category_id <> all (v_rows)) c
          on c.player_id = r.player_id
        group by c.category_id
      ),
      qualifying as (
        select col, least(n1, n2, n3) as hardest from meets
        where n1 >= v_band.min_answers and n2 >= v_band.min_answers and n3 >= v_band.min_answers
      )
      select
        (select q.col from qualifying q
         where v_band.max_answers is null or q.hardest <= v_band.max_answers
         order by random() limit 1),
        array(select q.col from qualifying q order by random())
      into v_first, v_others;
      continue when v_first is null;

      v_others := array_remove(v_others, v_first);
      continue when coalesce(array_length(v_others, 1), 0) < 2;

      v_rows := (select array_agg(x order by random()) from unnest(v_rows) x);
      v_cols := (select array_agg(x order by random()) from unnest(array[v_first, v_others[1], v_others[2]]) x);
      if random() < 0.5 then
        return public.ttt_build_board(v_rows, v_cols, p_difficulty, v_profile);
      end if;
      return public.ttt_build_board(v_cols, v_rows, p_difficulty, v_profile);
    end loop;
  end if;

  raise exception 'Could not make % % board from the footballers we have. Try another difficulty.',
    case when p_difficulty in ('easy', 'extreme') then 'an' else 'a' end, p_difficulty
    using errcode = 'check_violation', hint = 'ttt_no_board_found';
end;
$$;

-- Does this footballer fit the square's row, and its column?
create function public.ttt_cell_accepts(p_board_id uuid, p_cell int, p_football_player_id uuid)
returns table (row_ok boolean, col_ok boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.football_satisfies(p_football_player_id, r.category_id),
         public.football_satisfies(p_football_player_id, c.category_id)
  from public.ttt_board_axes r
  join public.ttt_board_axes c on c.board_id = r.board_id and c.axis = 'col' and c.position = p_cell % 3
  where r.board_id = p_board_id and r.axis = 'row' and r.position = p_cell / 3;
$$;

-- The first line that these squares complete, or null.
create function public.ttt_winning_line(p_cells smallint[])
returns smallint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select l.line from public.ttt_lines l
  where l.cells <@ coalesce(p_cells, '{}')
  order by l.line
  limit 1;
$$;

-- Is any empty square still answerable by a footballer who has not been used?
create function public.ttt_board_has_answers(p_board_id uuid, p_claimed smallint[], p_used uuid[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from generate_series(0, 8) cell
    join public.ttt_board_axes r on r.board_id = p_board_id and r.axis = 'row' and r.position = cell / 3
    join public.ttt_board_axes c on c.board_id = p_board_id and c.axis = 'col' and c.position = cell % 3
    where cell <> all (coalesce(p_claimed, '{}'))
      and exists (
        select 1
        from public.football_category_members mr
        join public.football_category_members mc
          on mc.player_id = mr.player_id and mc.category_id = c.category_id
        where mr.category_id = r.category_id
          and mr.player_id <> all (coalesce(p_used, '{}'))
      )
  );
$$;

-- ----------------------------------------------------------------------------
-- The online game: lobbies, seats and turns, around the board rules.
-- ----------------------------------------------------------------------------

-- The seat the signed-in user holds in this lobby, or null. Public, so an app
-- that has lost its saved seat can ask for it back; it only ever answers with
-- the caller's own.
create function public.ttt_my_seat(p_session_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.player_id from public.seat_owners o
  where o.session_id = p_session_id and o.auth_user_id = auth.uid();
$$;

-- Does the signed-in user hold a seat in this lobby? For the read policies.
create function public.ttt_is_seated(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.seat_owners o
    where o.session_id = p_session_id and o.auth_user_id = auth.uid()
  );
$$;

-- Can the caller see this lobby's shared rows (sessions, players)? Any
-- Football Imposter lobby, as before; a Tic-Tac-Toe lobby only from a seat.
create function public.session_visible(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select s.game_mode <> 'tic_tac_toe' from public.sessions s where s.id = p_session_id), false)
      or public.ttt_is_seated(p_session_id);
$$;

-- Can the caller see this board? Only from a seat in the lobby it is played in.
create function public.ttt_can_see_board(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.ttt_games g
    join public.seat_owners o on o.session_id = g.session_id
    where g.board_id = p_board_id and o.auth_user_id = auth.uid()
  );
$$;

-- The seat an RPC acts for: the caller's own seat in this lobby. Refuses if
-- the caller is not signed in or holds no seat here.
create function public.ttt_acting_seat(p_session_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_seat uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to play Football Tic-Tac-Toe'
      using errcode = 'insufficient_privilege', hint = 'ttt_no_auth';
  end if;
  v_seat := public.ttt_my_seat(p_session_id);
  if v_seat is null then
    raise exception 'You are not in this game' using errcode = 'insufficient_privilege', hint = 'ttt_not_in_game';
  end if;
  return v_seat;
end;
$$;

-- After a square is claimed: a line wins, a full board or a dead board draws,
-- otherwise the turn passes.
create function public.ttt_settle(p_game_id uuid, p_mark text)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_game     public.ttt_games%rowtype;
  v_mine     smallint[];
  v_line     smallint;
  v_claimed  smallint[];
  v_used     uuid[];
begin
  select * into v_game from public.ttt_games g where g.id = p_game_id;

  select array_agg(m.cell) into v_mine
  from public.ttt_moves m where m.game_id = p_game_id and m.kind = 'claim' and m.mark = p_mark;

  v_line := public.ttt_winning_line(v_mine);
  if v_line is not null then
    update public.ttt_games
    set status = 'won', end_reason = 'line', winner_mark = p_mark, winning_line = v_line,
        turn_mark = null, ended_at = now()
    where id = p_game_id;
    return;
  end if;

  select array_agg(m.cell), array_agg(m.football_player_id) into v_claimed, v_used
  from public.ttt_moves m where m.game_id = p_game_id and m.kind = 'claim';

  if coalesce(array_length(v_claimed, 1), 0) = 9 then
    update public.ttt_games
    set status = 'drawn', end_reason = 'board_full', turn_mark = null, ended_at = now()
    where id = p_game_id;
    return;
  end if;

  if not public.ttt_board_has_answers(v_game.board_id, v_claimed, v_used) then
    update public.ttt_games
    set status = 'drawn', end_reason = 'no_answers_left', turn_mark = null, ended_at = now()
    where id = p_game_id;
    return;
  end if;

  update public.ttt_games
  set turn_mark = case p_mark when 'X' then 'O' else 'X' end
  where id = p_game_id;
end;
$$;

-- Start a board in a lobby whose row is already locked by the caller.
create function public.ttt_begin_board(p_session_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_seats       uuid[];
  v_prev        public.ttt_games%rowtype;
  v_has_prev    boolean;
  v_x           uuid;
  v_o           uuid;
  v_starter     text;
  v_difficulty  text;
  v_board       uuid;
  v_game        uuid;
begin
  select array_agg(p.id order by p.joined_at, p.id) into v_seats
  from public.players p where p.session_id = p_session_id and p.is_active;

  if coalesce(array_length(v_seats, 1), 0) <> 2 then
    raise exception 'Football Tic-Tac-Toe needs exactly two players'
      using errcode = 'check_violation', hint = 'ttt_need_two_players';
  end if;

  select * into v_prev from public.ttt_games g
  where g.session_id = p_session_id order by g.board_number desc limit 1;
  v_has_prev := found;

  if v_has_prev and v_prev.x_player_id = any (v_seats) and v_prev.o_player_id = any (v_seats) then
    -- A rematch: same marks, the other player starts.
    v_x := v_prev.x_player_id;
    v_o := v_prev.o_player_id;
    v_starter := case v_prev.starter_mark when 'X' then 'O' else 'X' end;
  else
    -- A new match: toss a coin. Whoever wins it is X and goes first.
    if random() < 0.5 then
      v_x := v_seats[1]; v_o := v_seats[2];
    else
      v_x := v_seats[2]; v_o := v_seats[1];
    end if;
    v_starter := 'X';
  end if;

  select s.difficulty into v_difficulty from public.ttt_settings s where s.session_id = p_session_id;
  v_board := public.ttt_generate_board(coalesce(v_difficulty, 'medium'));

  insert into public.ttt_games
    (session_id, board_number, board_id, x_player_id, o_player_id, x_name, o_name, starter_mark, turn_mark)
  values (
    p_session_id,
    case when v_has_prev then v_prev.board_number + 1 else 1 end,
    v_board, v_x, v_o,
    (select p.display_name from public.players p where p.id = v_x),
    (select p.display_name from public.players p where p.id = v_o),
    v_starter, v_starter
  )
  returning id into v_game;

  update public.sessions
  set status = 'playing', started_at = coalesce(started_at, now())
  where id = p_session_id;

  return v_game;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: ttt_create_session. The Football Tic-Tac-Toe version of create_session:
-- makes the lobby, the host's seat (owned by the signed-in caller) and the
-- settings in one transaction.
-- ----------------------------------------------------------------------------

create function public.ttt_create_session(
  p_display_name  text,
  p_difficulty    text default 'medium'
)
returns table (session_id uuid, code text, player_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name        text := trim(coalesce(p_display_name, ''));
  v_difficulty  text := coalesce(nullif(trim(p_difficulty), ''), 'medium');
  v_code        text;
  v_session_id  uuid;
  v_player_id   uuid;
  v_attempt     int := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in to play Football Tic-Tac-Toe'
      using errcode = 'insufficient_privilege', hint = 'ttt_no_auth';
  end if;
  if char_length(v_name) = 0 then
    raise exception 'Enter a display name' using errcode = 'check_violation';
  end if;
  if char_length(v_name) > 20 then
    raise exception 'Display name must be 20 characters or fewer' using errcode = 'check_violation';
  end if;
  if v_difficulty not in ('easy', 'medium', 'hard', 'extreme') then
    raise exception 'Pick a difficulty: easy, medium, hard or extreme' using errcode = 'check_violation';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_code := public.generate_session_code();
    exit when not exists (select 1 from public.sessions s where s.code = v_code);
    if v_attempt >= 10 then
      raise exception 'Could not allocate a session code, please try again';
    end if;
  end loop;

  insert into public.sessions (code, game_mode, status)
  values (v_code, 'tic_tac_toe', 'waiting')
  returning id into v_session_id;

  insert into public.players (session_id, display_name, is_host)
  values (v_session_id, v_name, true)
  returning id into v_player_id;

  insert into public.seat_owners (player_id, session_id, auth_user_id)
  values (v_player_id, v_session_id, auth.uid());

  update public.sessions set host_player_id = v_player_id where id = v_session_id;

  insert into public.ttt_settings (session_id, difficulty) values (v_session_id, v_difficulty);

  return query select v_session_id, v_code, v_player_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: join_session, from 0008, now recording who owns a Tic-Tac-Toe seat.
-- Joining a Tic-Tac-Toe lobby needs a signed-in caller, and a caller can hold
-- one seat per lobby. Everything about Football Imposter is unchanged.
-- ----------------------------------------------------------------------------

create or replace function public.join_session(
  p_code         text,
  p_display_name text,
  p_game_mode    text default 'imposter'
)
returns table (session_id uuid, code text, player_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code      text := upper(trim(coalesce(p_code, '')));
  v_name      text := trim(coalesce(p_display_name, ''));
  -- Omitted, null or blank all mean Football Imposter, never "any game".
  v_mode      text := coalesce(nullif(trim(p_game_mode), ''), 'imposter');
  v_game      public.game_modes%rowtype;
  v_session   public.sessions%rowtype;
  v_player_id uuid;
  v_count     int;
begin
  if char_length(v_name) = 0 then
    raise exception 'Enter a display name' using errcode = 'check_violation';
  end if;
  if char_length(v_name) > 20 then
    raise exception 'Display name must be 20 characters or fewer' using errcode = 'check_violation';
  end if;

  select * into v_game from public.game_modes g where g.id = v_mode;
  if not found then
    raise exception 'Unknown game' using errcode = 'invalid_parameter_value';
  end if;

  -- Locked, so two people joining at the same moment are seated one after the
  -- other and cannot both take the last seat.
  select * into v_session from public.sessions s where s.code = v_code for update;

  if not found then
    raise exception 'No game found with code %', v_code using errcode = 'no_data_found';
  end if;

  if v_session.game_mode <> v_mode then
    raise exception 'That code is for %. Join it from there.',
      (select g.name from public.game_modes g where g.id = v_session.game_mode)
      using errcode = 'check_violation';
  end if;

  -- A Football Tic-Tac-Toe seat belongs to a signed-in user, one seat each.
  if v_session.game_mode = 'tic_tac_toe' then
    if auth.uid() is null then
      raise exception 'Sign in to play Football Tic-Tac-Toe'
        using errcode = 'insufficient_privilege', hint = 'ttt_no_auth';
    end if;
    if exists (
      select 1 from public.seat_owners o
      where o.session_id = v_session.id and o.auth_user_id = auth.uid()
    ) then
      raise exception 'You are already in this game' using errcode = 'unique_violation', hint = 'ttt_already_seated';
    end if;
  end if;

  if v_session.status <> 'waiting' then
    raise exception 'That game has already started' using errcode = 'check_violation';
  end if;

  select count(*) into v_count from public.players p where p.session_id = v_session.id;
  if v_count >= v_game.max_players then
    raise exception 'That game is full (% players max)', v_game.max_players using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from public.players p
    where p.session_id = v_session.id
      and lower(trim(p.display_name)) = lower(v_name)
  ) then
    raise exception 'Someone in this game is already called %', v_name using errcode = 'unique_violation';
  end if;

  insert into public.players (session_id, display_name, is_host)
  values (v_session.id, v_name, false)
  returning id into v_player_id;

  -- Only Imposter deals hidden roles; only Tic-Tac-Toe records who owns a seat.
  if v_session.game_mode = 'imposter' then
    insert into public.player_secrets (player_id) values (v_player_id);
  elsif v_session.game_mode = 'tic_tac_toe' then
    insert into public.seat_owners (player_id, session_id, auth_user_id)
    values (v_player_id, v_session.id, auth.uid());
  end if;

  return query select v_session.id, v_session.code, v_player_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: ttt_update_settings (host only). In the lobby and between boards,
-- never while a board is in play. The next board uses the new difficulty.
-- ----------------------------------------------------------------------------

create function public.ttt_update_settings(p_session_id uuid, p_difficulty text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session  public.sessions%rowtype;
  v_me       uuid;
begin
  select * into v_session from public.sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'Game not found' using errcode = 'no_data_found', hint = 'ttt_no_game';
  end if;
  if v_session.game_mode <> 'tic_tac_toe' then
    raise exception 'That is not a Football Tic-Tac-Toe game' using errcode = 'check_violation', hint = 'ttt_wrong_game';
  end if;
  v_me := public.ttt_acting_seat(p_session_id);
  if v_session.host_player_id is distinct from v_me then
    raise exception 'Only the host can change the settings' using errcode = 'insufficient_privilege', hint = 'ttt_not_host';
  end if;
  if v_session.status not in ('waiting', 'playing') then
    raise exception 'This game is over' using errcode = 'check_violation', hint = 'ttt_game_over';
  end if;
  if exists (select 1 from public.ttt_games g where g.session_id = p_session_id and g.status = 'playing') then
    raise exception 'Finish this board first' using errcode = 'check_violation', hint = 'ttt_board_in_play';
  end if;
  if p_difficulty is null or p_difficulty not in ('easy', 'medium', 'hard', 'extreme') then
    raise exception 'Pick a difficulty: easy, medium, hard or extreme' using errcode = 'check_violation';
  end if;

  insert into public.ttt_settings (session_id, difficulty) values (p_session_id, p_difficulty)
  on conflict (session_id) do update set difficulty = excluded.difficulty;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: ttt_start_game (host only): the first board of a match, from the lobby.
-- RPC: ttt_rematch (host only): the next board, once the last one has ended.
-- ----------------------------------------------------------------------------

create function public.ttt_start_game(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session  public.sessions%rowtype;
  v_me       uuid;
begin
  select * into v_session from public.sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'Game not found' using errcode = 'no_data_found', hint = 'ttt_no_game';
  end if;
  if v_session.game_mode <> 'tic_tac_toe' then
    raise exception 'That is not a Football Tic-Tac-Toe game' using errcode = 'check_violation', hint = 'ttt_wrong_game';
  end if;
  v_me := public.ttt_acting_seat(p_session_id);
  if v_session.host_player_id is distinct from v_me then
    raise exception 'Only the host can start the game' using errcode = 'insufficient_privilege', hint = 'ttt_not_host';
  end if;
  if v_session.status <> 'waiting' then
    raise exception 'The game has already started' using errcode = 'check_violation';
  end if;

  perform public.ttt_begin_board(p_session_id);
end;
$$;

create function public.ttt_rematch(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session  public.sessions%rowtype;
  v_me       uuid;
begin
  select * into v_session from public.sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'Game not found' using errcode = 'no_data_found', hint = 'ttt_no_game';
  end if;
  if v_session.game_mode <> 'tic_tac_toe' then
    raise exception 'That is not a Football Tic-Tac-Toe game' using errcode = 'check_violation', hint = 'ttt_wrong_game';
  end if;
  v_me := public.ttt_acting_seat(p_session_id);
  if v_session.host_player_id is distinct from v_me then
    raise exception 'Only the host can start another board' using errcode = 'insufficient_privilege', hint = 'ttt_not_host';
  end if;
  if v_session.status <> 'playing' then
    raise exception 'There is no match to continue' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.ttt_games g where g.session_id = p_session_id and g.status = 'playing') then
    raise exception 'Finish this board first' using errcode = 'check_violation', hint = 'ttt_board_in_play';
  end if;

  perform public.ttt_begin_board(p_session_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: ttt_submit_move: name a footballer for a square.
--
-- The acting seat is the caller's own, found from auth.uid() once the lobby is
-- locked. Everything is then checked under the lobby's lock and the board's,
-- taken in the same order as leave_session() takes them, so two phones can
-- never both claim one square and a move can never cross paths with a player
-- leaving. The unique indexes on ttt_moves stand behind these checks
-- regardless.
--
-- Refusals raise with a sentence for the player and a stable hint for the app
-- (ttt_not_your_turn, ttt_square_taken, ttt_footballer_used, ...). A move that
-- is accepted returns 'claimed' or 'wrong', and nothing about why.
-- ----------------------------------------------------------------------------

create function public.ttt_submit_move(
  p_session_id          uuid,
  p_cell                int,
  p_football_player_id  uuid
)
returns table (outcome text, game_status text, end_reason text, winner_mark text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session  public.sessions%rowtype;
  v_game     public.ttt_games%rowtype;
  v_me       uuid;
  v_mark     text;
  v_name     text;
  v_row_ok   boolean;
  v_col_ok   boolean;
  v_number   int;
  v_move     uuid;
begin
  select * into v_session from public.sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'Game not found' using errcode = 'no_data_found', hint = 'ttt_no_game';
  end if;
  if v_session.game_mode <> 'tic_tac_toe' then
    raise exception 'That is not a Football Tic-Tac-Toe game' using errcode = 'check_violation', hint = 'ttt_wrong_game';
  end if;
  v_me := public.ttt_acting_seat(p_session_id);

  select * into v_game from public.ttt_games g
  where g.session_id = p_session_id and g.status = 'playing'
  for update;
  if not found then
    raise exception 'There is no board in play' using errcode = 'check_violation', hint = 'ttt_no_board';
  end if;

  v_mark := case
              when v_me = v_game.x_player_id then 'X'
              when v_me = v_game.o_player_id then 'O'
            end;
  if v_mark is null then
    raise exception 'You are not in this game' using errcode = 'insufficient_privilege', hint = 'ttt_not_in_game';
  end if;
  if v_mark <> v_game.turn_mark then
    raise exception 'It is not your turn' using errcode = 'check_violation', hint = 'ttt_not_your_turn';
  end if;
  if p_cell is null or p_cell not between 0 and 8 then
    raise exception 'That square is not on the board' using errcode = 'check_violation', hint = 'ttt_bad_square';
  end if;
  if exists (
    select 1 from public.ttt_moves m
    where m.game_id = v_game.id and m.kind = 'claim' and m.cell = p_cell
  ) then
    raise exception 'That square is already taken' using errcode = 'check_violation', hint = 'ttt_square_taken';
  end if;

  select fp.known_as into v_name from public.football_players fp where fp.id = p_football_player_id;
  if not found then
    raise exception 'Pick a footballer from the list' using errcode = 'check_violation', hint = 'ttt_unknown_footballer';
  end if;

  -- Checked before the answer itself: who has claimed a square is on the board
  -- for everyone to see, so refusing a reused name gives nothing away.
  if exists (
    select 1 from public.ttt_moves m
    where m.game_id = v_game.id and m.kind = 'claim' and m.football_player_id = p_football_player_id
  ) then
    raise exception '% has already been used on this board', v_name
      using errcode = 'check_violation', hint = 'ttt_footballer_used';
  end if;

  select a.row_ok, a.col_ok into v_row_ok, v_col_ok
  from public.ttt_cell_accepts(v_game.board_id, p_cell, p_football_player_id) a;

  select coalesce(max(m.move_number), 0) + 1 into v_number
  from public.ttt_moves m where m.game_id = v_game.id;

  if v_row_ok and v_col_ok then
    insert into public.ttt_moves
      (game_id, session_id, move_number, player_id, mark, kind, cell, football_player_id, footballer_name)
    values
      (v_game.id, p_session_id, v_number, v_me, v_mark, 'claim', p_cell, p_football_player_id, v_name);

    perform public.ttt_settle(v_game.id, v_mark);
    select * into v_game from public.ttt_games g where g.id = v_game.id;

    return query select 'claimed'::text, v_game.status, v_game.end_reason, v_game.winner_mark;
    return;
  end if;

  insert into public.ttt_moves
    (game_id, session_id, move_number, player_id, mark, kind, cell, football_player_id, footballer_name)
  values
    (v_game.id, p_session_id, v_number, v_me, v_mark, 'wrong', p_cell, p_football_player_id, v_name)
  returning id into v_move;

  insert into public.ttt_move_checks (move_id, row_ok, col_ok)
  values (v_move, coalesce(v_row_ok, false), coalesce(v_col_ok, false));

  update public.ttt_games
  set turn_mark = case v_mark when 'X' then 'O' else 'X' end
  where id = v_game.id;

  return query select 'wrong'::text, 'playing'::text, null::text, null::text;
end;
$$;

-- ----------------------------------------------------------------------------
-- RPC: ttt_pass: use your turn without naming anyone.
-- ----------------------------------------------------------------------------

create function public.ttt_pass(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session  public.sessions%rowtype;
  v_game     public.ttt_games%rowtype;
  v_me       uuid;
  v_mark     text;
begin
  select * into v_session from public.sessions s where s.id = p_session_id for update;
  if not found then
    raise exception 'Game not found' using errcode = 'no_data_found', hint = 'ttt_no_game';
  end if;
  if v_session.game_mode <> 'tic_tac_toe' then
    raise exception 'That is not a Football Tic-Tac-Toe game' using errcode = 'check_violation', hint = 'ttt_wrong_game';
  end if;
  v_me := public.ttt_acting_seat(p_session_id);

  select * into v_game from public.ttt_games g
  where g.session_id = p_session_id and g.status = 'playing'
  for update;
  if not found then
    raise exception 'There is no board in play' using errcode = 'check_violation', hint = 'ttt_no_board';
  end if;

  v_mark := case
              when v_me = v_game.x_player_id then 'X'
              when v_me = v_game.o_player_id then 'O'
            end;
  if v_mark is null then
    raise exception 'You are not in this game' using errcode = 'insufficient_privilege', hint = 'ttt_not_in_game';
  end if;
  if v_mark <> v_game.turn_mark then
    raise exception 'It is not your turn' using errcode = 'check_violation', hint = 'ttt_not_your_turn';
  end if;

  insert into public.ttt_moves (game_id, session_id, move_number, player_id, mark, kind)
  values (
    v_game.id, p_session_id,
    (select coalesce(max(m.move_number), 0) + 1 from public.ttt_moves m where m.game_id = v_game.id),
    v_me, v_mark, 'pass'
  );

  update public.ttt_games
  set turn_mark = case v_mark when 'X' then 'O' else 'X' end
  where id = v_game.id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Leaving a Football Tic-Tac-Toe lobby. See the header for the rules. Called
-- by leave_session(), which already holds the lobby's lock.
--
-- The seat that leaves is always the caller's own. p_player_id is accepted for
-- leave_session()'s sake: if it names another seat that still exists, the call
-- is refused; if it names a seat that has already gone (a repeated leave), or
-- the caller holds no seat, nothing happens.
-- ----------------------------------------------------------------------------

create function public.ttt_leave(p_session_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session   public.sessions%rowtype;
  v_me        uuid;
  v_game      public.ttt_games%rowtype;
  v_in_play   boolean;
  v_mark      text;
begin
  select * into v_session from public.sessions s where s.id = p_session_id for update;
  if not found then
    return;
  end if;

  v_me := public.ttt_my_seat(p_session_id);

  if p_player_id is not null and p_player_id is distinct from v_me then
    if exists (select 1 from public.players p where p.id = p_player_id and p.session_id = p_session_id) then
      raise exception 'You can only leave your own seat'
        using errcode = 'insufficient_privilege', hint = 'ttt_not_your_seat';
    end if;
    return;
  end if;
  if v_me is null then
    return;
  end if;

  -- In the lobby, or once the lobby has ended (its host walked out
  -- mid-board): the rule every game shares.
  if v_session.status in ('waiting', 'ended') then
    perform public.give_up_seat(p_session_id, v_me);
    return;
  end if;

  select * into v_game from public.ttt_games g
  where g.session_id = p_session_id and g.status = 'playing'
  for update;
  v_in_play := found;

  if v_in_play then
    v_mark := case
                when v_me = v_game.x_player_id then 'X'
                when v_me = v_game.o_player_id then 'O'
              end;
    if v_mark is not null then
      update public.ttt_games
      set status = 'forfeited', end_reason = 'forfeit',
          winner_mark = case v_mark when 'X' then 'O' else 'X' end,
          turn_mark = null, ended_at = now()
      where id = v_game.id;
    end if;
  end if;

  if v_session.host_player_id = v_me then
    if v_in_play then
      -- Mid-board: out, but keeps the seat. Nobody inherits the host role.
      update public.players set is_active = false where id = v_me;
      update public.sessions set status = 'ended', ended_at = now() where id = p_session_id;
    else
      -- Between boards: closes the lobby, as before kick-off.
      perform public.give_up_seat(p_session_id, v_me);
    end if;
    return;
  end if;

  -- The opponent: seat removed, lobby back to waiting for someone new. Their
  -- finished boards keep their name; the seat columns go null.
  delete from public.players p where p.id = v_me and p.session_id = p_session_id;
  update public.sessions set status = 'waiting' where id = p_session_id;
end;
$$;

-- leave_session() from 0008. A Tic-Tac-Toe lobby is handed to ttt_leave()
-- before anything else, so its lobby rule runs only after the caller's seat
-- has been checked. Football Imposter goes exactly the way it always has.
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
begin
  -- Every path below runs under this lock, whichever game it is.
  select * into v_session from public.sessions s where s.id = p_session_id for update;
  if not found then
    return;
  end if;

  if v_session.game_mode = 'tic_tac_toe' then
    perform public.ttt_leave(p_session_id, p_player_id);
    return;
  end if;

  if v_session.status = 'waiting' then
    perform public.give_up_seat(p_session_id, p_player_id);
    return;
  end if;

  -- After kick-off, what leaving means is up to the game.
  if v_session.game_mode = 'imposter' then
    perform public.imposter_leave_in_play(p_session_id, p_player_id);
    return;
  end if;

  raise exception 'Leaving this game is not supported yet' using errcode = 'feature_not_supported';
end;
$$;

-- ----------------------------------------------------------------------------
-- Row level security, grants and Realtime.
--
-- Nothing a Tic-Tac-Toe lobby holds is readable except from a seat in it. The
-- policies call the seat helpers above, which read seat_owners as its owner;
-- the browser's roles hold execute on those helpers and nothing else there.
-- Realtime applies these same policies to each change before sending it.
-- ----------------------------------------------------------------------------

-- Shared rows. A Football Imposter lobby reads exactly as before, for anyone;
-- a Tic-Tac-Toe lobby's rows only for someone holding a seat in it.
drop policy "sessions are readable" on public.sessions;
create policy "sessions are readable" on public.sessions for select
  using (game_mode <> 'tic_tac_toe' or public.ttt_is_seated(id));

drop policy "players are readable" on public.players;
create policy "players are readable" on public.players for select
  using (public.session_visible(session_id));

alter table public.ttt_lines              enable row level security;
alter table public.ttt_threshold_profiles enable row level security;
alter table public.ttt_difficulty_bands   enable row level security;
alter table public.ttt_config             enable row level security;
alter table public.ttt_settings           enable row level security;
alter table public.ttt_boards             enable row level security;
alter table public.ttt_board_axes         enable row level security;
alter table public.ttt_board_cells        enable row level security;
alter table public.ttt_games              enable row level security;
alter table public.ttt_moves              enable row level security;
alter table public.ttt_move_checks        enable row level security;
alter table public.seat_owners            enable row level security;

create policy "lines are readable"            on public.ttt_lines      for select using (true);
create policy "settings: from a seat"         on public.ttt_settings   for select to authenticated using (public.ttt_is_seated(session_id));
create policy "games: from a seat"            on public.ttt_games      for select to authenticated using (public.ttt_is_seated(session_id));
create policy "moves: from a seat"            on public.ttt_moves      for select to authenticated using (public.ttt_is_seated(session_id));
create policy "boards: from a seat"           on public.ttt_boards     for select to authenticated using (public.ttt_can_see_board(id));
create policy "board axes: from a seat"       on public.ttt_board_axes for select to authenticated using (public.ttt_can_see_board(board_id));

revoke all on
  public.ttt_lines, public.ttt_threshold_profiles, public.ttt_difficulty_bands, public.ttt_config,
  public.ttt_settings, public.ttt_boards, public.ttt_board_axes, public.ttt_board_cells,
  public.ttt_games, public.ttt_moves, public.ttt_move_checks, public.seat_owners
from anon, authenticated;

grant select on public.ttt_lines to anon, authenticated;
grant select on public.ttt_settings, public.ttt_boards, public.ttt_board_axes, public.ttt_games, public.ttt_moves
  to authenticated;

alter table public.ttt_settings replica identity full;
alter table public.ttt_games    replica identity full;
alter table public.ttt_moves    replica identity full;

do $$
declare
  t text;
begin
  foreach t in array array['ttt_settings', 'ttt_games', 'ttt_moves'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- The public RPCs, for signed-in callers only. join_session and leave_session
-- keep the grants 0008 gave them.
revoke all on function public.ttt_create_session(text, text)        from public, anon;
revoke all on function public.ttt_update_settings(uuid, text)       from public, anon;
revoke all on function public.ttt_start_game(uuid)                  from public, anon;
revoke all on function public.ttt_rematch(uuid)                     from public, anon;
revoke all on function public.ttt_submit_move(uuid, int, uuid)      from public, anon;
revoke all on function public.ttt_pass(uuid)                        from public, anon;
revoke all on function public.ttt_my_seat(uuid)                     from public, anon;

grant execute on function public.ttt_create_session(text, text)     to authenticated;
grant execute on function public.ttt_update_settings(uuid, text)    to authenticated;
grant execute on function public.ttt_start_game(uuid)               to authenticated;
grant execute on function public.ttt_rematch(uuid)                  to authenticated;
grant execute on function public.ttt_submit_move(uuid, int, uuid)   to authenticated;
grant execute on function public.ttt_pass(uuid)                     to authenticated;
grant execute on function public.ttt_my_seat(uuid)                  to authenticated;

-- The read policies call these as the reading role, so that role needs to be
-- able to run them. Each only answers about the caller. sessions and players
-- are read by both browser roles; the board policies apply to authenticated
-- only.
revoke all on function public.ttt_is_seated(uuid)                   from public;
revoke all on function public.session_visible(uuid)                 from public;
revoke all on function public.ttt_can_see_board(uuid)               from public, anon;
grant execute on function public.ttt_is_seated(uuid)                to anon, authenticated;
grant execute on function public.session_visible(uuid)              to anon, authenticated;
grant execute on function public.ttt_can_see_board(uuid)            to authenticated;

revoke all on function public.ttt_forbid_change()                                from public, anon, authenticated;
revoke all on function public.ttt_moves_before_update()                          from public, anon, authenticated;
revoke all on function public.ttt_keep_board_whole()                             from public, anon, authenticated;
revoke all on function public.ttt_check_board_complete()                         from public, anon, authenticated;
revoke all on function public.ttt_check_game_seated()                            from public, anon, authenticated;
revoke all on function public.ttt_check_seat_owned()                             from public, anon, authenticated;
revoke all on function public.ttt_games_after_delete()                           from public, anon, authenticated;
revoke all on function public.ttt_active_profile()                               from public, anon, authenticated;
revoke all on function public.ttt_board_meets(int[], text, text)                 from public, anon, authenticated;
revoke all on function public.ttt_build_board(uuid[], uuid[], text, text)        from public, anon, authenticated;
revoke all on function public.ttt_generate_board(text, text)                     from public, anon, authenticated;
revoke all on function public.ttt_cell_accepts(uuid, int, uuid)                  from public, anon, authenticated;
revoke all on function public.ttt_winning_line(smallint[])                       from public, anon, authenticated;
revoke all on function public.ttt_board_has_answers(uuid, smallint[], uuid[])    from public, anon, authenticated;
revoke all on function public.ttt_settle(uuid, text)                             from public, anon, authenticated;
revoke all on function public.ttt_begin_board(uuid)                              from public, anon, authenticated;
revoke all on function public.ttt_acting_seat(uuid)                              from public, anon, authenticated;
revoke all on function public.ttt_leave(uuid, uuid)                              from public, anon, authenticated;

commit;
