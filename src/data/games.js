/**
 * The games in the collection. `art` names a file in /public/assets/art (webp
 * plus a png fallback), sliced from the card designs by scripts/slice-art.py.
 *
 * `lead` and `tail` split the name the way the card art does it: the first
 * part in white, the last part in gold. `accent` is the hue the whole card
 * sits in, one per game, taken from that card's ground.
 *
 * Flip `status` to 'live' and give the card a `path` when a game ships.
 */
export const GAMES = [
  {
    id: 'imposter',
    name: 'Football Imposter',
    lead: 'Football',
    tail: 'Imposter',
    eyebrow: 'Play · Guess · Outsmart',
    tagline: 'One of you has no idea who the player is. Find them.',
    players: '3–12 players',
    accent: 'accent-crimson',
    status: 'live',
    path: '/imposter',
    art: 'imposter',
  },
  {
    id: 'tic-tac-toe',
    name: 'Football Tic-Tac-Toe',
    lead: 'Football',
    tail: 'Tic-Tac-Toe',
    eyebrow: 'Name · Match · Win',
    tagline: 'Name a player who fits both. Three in a row wins.',
    players: '2 players',
    accent: 'accent-teal',
    status: 'soon',
    path: null,
    art: 'tictactoe',
  },
  {
    id: 'draft',
    name: '5 A-Side Draft',
    lead: '5 A-Side',
    tail: 'Draft',
    eyebrow: 'Bid · Draft · Build',
    tagline: 'Bid against your mates. Build the best five.',
    players: '2–8 players',
    accent: 'accent-royal',
    status: 'soon',
    path: null,
    art: 'draft',
  },
]
