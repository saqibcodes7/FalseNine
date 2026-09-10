/**
 * The cards in the binder. `art` names a file in /public/assets/art (webp +
 * png). Flip `status` to 'live' and give the card a `path` when a game ships.
 */
export const GAMES = [
  {
    id: 'imposter',
    name: 'Football Imposter',
    tagline: 'One of you has no idea who the player is. Find them.',
    players: '3 to 12 players',
    status: 'live',
    path: '/imposter',
    art: 'imposter',
  },
  {
    id: 'tic-tac-toe',
    name: 'Football Tic-Tac-Toe',
    tagline: 'Name a player who fits both. Three in a row wins.',
    players: '2 players',
    status: 'soon',
    path: null,
    art: 'tictactoe',
  },
  {
    id: 'heads-up',
    name: 'Football Heads Up',
    tagline: 'Phone on your forehead. Your mates describe. You guess.',
    players: '2 to 8 players',
    status: 'soon',
    path: null,
    art: 'coming-soon',
  },
]
