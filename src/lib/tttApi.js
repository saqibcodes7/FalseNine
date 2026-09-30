/**
 * Every call Football Tic-Tac-Toe makes to the backend, in one place.
 *
 * Each function takes the Supabase client to act through (see tttClient.js):
 * which anonymous user is making the call decides whose seat it acts for. None
 * of the game actions send a player id. The server works out the acting seat
 * from auth.uid(), under the lobby's lock, and a player id proves nothing.
 *
 * The one exception is leave_session, which every game shares and which still
 * takes a player id for Football Imposter's sake. For a Tic-Tac-Toe lobby the
 * server refuses to leave any seat but the caller's own, and the id sent here
 * is always the one ttt_my_seat gave back for this caller.
 *
 * The columns below are all the browser reads. Row level security decides
 * which rows: a Tic-Tac-Toe lobby is only readable from a seat in it. Nothing
 * here touches seat_owners, ttt_board_cells, ttt_move_checks or any football
 * table, none of which the browser can read anyway.
 */

export const TTT_MODE = 'tic_tac_toe'

export const TTT_SESSION_COLUMNS = 'id, code, game_mode, host_player_id, status, created_at, started_at, ended_at'

export const TTT_PLAYER_COLUMNS = 'id, session_id, display_name, is_host, is_active, joined_at'

/**
 * The per-lobby tables, in the shape useLiveSession takes. Each has a
 * session_id, which is how rows are fetched and how Realtime is filtered, and
 * all three are published to Realtime.
 */
export const TTT_TABLES = [
  { key: 'settings', table: 'ttt_settings', columns: 'session_id, difficulty', order: 'session_id' },
  {
    key: 'games',
    table: 'ttt_games',
    columns:
      'id, session_id, board_number, board_id, x_player_id, o_player_id, x_name, o_name, starter_mark, turn_mark, status, end_reason, winner_mark, winning_line, started_at, ended_at',
    order: 'board_number',
  },
  {
    key: 'moves',
    table: 'ttt_moves',
    columns: 'id, game_id, session_id, move_number, mark, kind, cell, footballer_name, created_at',
    order: 'created_at',
  },
]

/** PostgREST returns a table-returning function as an array of rows. */
const firstRow = (data) => (Array.isArray(data) ? (data[0] ?? null) : (data ?? null))

export async function createGame(client, { name, difficulty }) {
  const { data, error } = await client.rpc('ttt_create_session', {
    p_display_name: name,
    p_difficulty: difficulty,
  })
  return { row: firstRow(data), error }
}

export async function joinGame(client, { code, name }) {
  const { data, error } = await client.rpc('join_session', {
    p_code: code,
    p_display_name: name,
    p_game_mode: TTT_MODE,
  })
  return { row: firstRow(data), error }
}

/** This caller's own seat in the lobby, or null. The only source of "who am I". */
export async function fetchMySeat(client, sessionId) {
  const { data, error } = await client.rpc('ttt_my_seat', { p_session_id: sessionId })
  return { seat: data ?? null, error }
}

export async function setDifficulty(client, sessionId, difficulty) {
  const { error } = await client.rpc('ttt_update_settings', {
    p_session_id: sessionId,
    p_difficulty: difficulty,
  })
  return { error }
}

export async function startGame(client, sessionId) {
  const { error } = await client.rpc('ttt_start_game', { p_session_id: sessionId })
  return { error }
}

export async function rematch(client, sessionId) {
  const { error } = await client.rpc('ttt_rematch', { p_session_id: sessionId })
  return { error }
}

/**
 * Name a footballer for a square. `footballerId` is the id of a row picked
 * from football_search_players: never a typed name. The result says only
 * 'claimed' or 'wrong', and nothing about why.
 */
export async function submitMove(client, sessionId, cell, footballerId) {
  const { data, error } = await client.rpc('ttt_submit_move', {
    p_session_id: sessionId,
    p_cell: cell,
    p_football_player_id: footballerId,
  })
  return { result: firstRow(data), error }
}

export async function passTurn(client, sessionId) {
  const { error } = await client.rpc('ttt_pass', { p_session_id: sessionId })
  return { error }
}

/** `seatId` is this caller's own seat, from fetchMySeat. */
export async function leaveGame(client, sessionId, seatId) {
  const { error } = await client.rpc('leave_session', {
    p_session_id: sessionId,
    p_player_id: seatId ?? null,
  })
  return { error }
}

/**
 * The autocomplete. Returns id, known_as, full_name and birth_year, which is
 * all the function gives out: nothing a criterion is built from.
 */
export async function searchFootballers(client, query, limit) {
  const { data, error } = await client.rpc('football_search_players', {
    p_query: query,
    p_limit: limit,
  })
  return { rows: data ?? [], error }
}

/**
 * A board's rows and columns, and the difficulty it was made at. Boards never
 * change once made, so callers may keep these.
 */
export async function fetchBoard(client, boardId) {
  const [axes, board] = await Promise.all([
    client.from('ttt_board_axes').select('board_id, axis, position, category_type, label, short_label').eq('board_id', boardId),
    client.from('ttt_boards').select('id, difficulty').eq('id', boardId).maybeSingle(),
  ])
  return { axes: axes.data ?? [], difficulty: board.data?.difficulty ?? null, error: axes.error ?? board.error }
}

/** The eight lines, which squares make each one. Readable by anyone. */
export async function fetchLines(client) {
  const { data, error } = await client.from('ttt_lines').select('line, cells')
  return { lines: data ?? [], error }
}
