/*
 * Words and tints for Tic-Tac-Toe screens. Plain functions, kept apart from
 * the components so each file exports one kind of thing.
 *
 * The three kinds of criterion mean different things, and each says so:
 *
 *   CLUB         played at least one senior competitive game for the club
 *   NATIONALITY  that is his one football nationality
 *   TROPHY       he won it (a title, a cup, an award). Taking part is not enough.
 */
const KINDS = {
  CLUB: { caption: 'Club', sentence: (label) => `Played for ${label}` },
  NATIONALITY: { caption: 'Nation', sentence: (label) => `Nationality: ${label}` },
  TROPHY: { caption: 'Won', sentence: (label) => `Won the ${label}` },
}

export const criterionCaption = (axis) => KINDS[axis?.category_type]?.caption ?? ''

export const criterionSentence = (axis) => (KINDS[axis?.category_type]?.sentence ?? ((l) => l))(axis?.label ?? '')

/** The accent scope that goes with a mark, for tints and rings. */
export const markAccent = (mark) => (mark === 'O' ? 'accent-teal' : 'accent-gold')

/**
 * The second line of a search result: his full name and the year he was
 * born, which is what tells two footballers with one name apart. Nothing
 * else is shown, because nothing else comes back.
 */
export function footballerMeta(row) {
  const full = row.full_name && row.full_name !== row.known_as ? row.full_name : null
  const born = row.birth_year ? String(row.birth_year) : null
  if (full && born) return `${full} · ${born}`
  if (full) return full
  if (born) return `Born ${born}`
  return ''
}
