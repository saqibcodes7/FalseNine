/**
 * The mini-game tiles on the landing page. Flip `status` to 'live' and give the
 * tile a `path` when a game is ready to ship.
 */
export const GAMES = [
  {
    id: 'imposter',
    name: 'Football Imposter',
    tagline: 'One of you has no idea who the player is. Find them.',
    players: '3 to 12 players',
    status: 'live',
    path: '/imposter',
    accent: 'lime',
  },
  {
    id: 'tic-tac-toe',
    name: 'Football Tic-Tac-Toe',
    tagline: 'Name a player who played for both clubs. Three in a row wins.',
    players: '2 players',
    status: 'soon',
    path: null,
    accent: 'slate',
  },
  {
    id: 'heads-up',
    name: 'Football Heads Up',
    tagline: 'Phone on your forehead. Your mates describe. You guess.',
    players: '2 to 8 players',
    status: 'soon',
    path: null,
    accent: 'slate',
  },
]
