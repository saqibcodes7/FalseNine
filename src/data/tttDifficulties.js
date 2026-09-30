/**
 * Football Tic-Tac-Toe difficulties, as the backend accepts them.
 *
 * The ids are the values migration 0010 allows (the ttt_settings and
 * ttt_boards difficulty checks), and the browser has no way to read them
 * from the database: the difficulty bands are server-side only. So they are
 * written out here, once, and every screen takes them from this file.
 *
 * What makes a board Easy or Extreme is decided on the server, from how many
 * footballers fit each square. The blurbs describe that without numbers,
 * because the numbers can be tuned in the database without a release.
 */
export const TTT_DIFFICULTIES = [
  { id: 'easy', name: 'Easy', blurb: 'Every square has plenty of right answers.' },
  { id: 'medium', name: 'Medium', blurb: 'Most squares are gettable. One or two will make you think.' },
  { id: 'hard', name: 'Hard', blurb: 'Some squares only have a handful of right answers.' },
  { id: 'extreme', name: 'Extreme', blurb: 'At least one square has a single right answer.' },
]

/** What ttt_create_session uses when it is not told. */
export const DEFAULT_TTT_DIFFICULTY = 'medium'

export function getTttDifficulty(id) {
  return TTT_DIFFICULTIES.find((d) => d.id === id) ?? TTT_DIFFICULTIES.find((d) => d.id === DEFAULT_TTT_DIFFICULTY)
}
