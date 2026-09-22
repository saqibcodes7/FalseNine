import premierLeague from './premier_league.json'
import championsLeague from './champions_league.json'
import worldCup from './world_cup.json'

/**
 * Player packs, bundled into the build as static JSON (Phase 1 of the roadmap).
 *
 * A pack is a squad. Every footballer in it sits in one of three tiers, and the
 * difficulty the host picks decides how deep into the squad the game reaches:
 *
 *   casual         the starting XI            household names
 *   ball_aware     starting XI + the bench    anyone who watches regularly
 *   you_know_ball  the whole squad            the niche ones too
 *
 * Tiers are cumulative, so You Know Ball plays with all three lists. Packs are
 * meant to be equally hard at the same difficulty; the pack picks the era and
 * the competition, the difficulty picks how obscure it gets.
 *
 * `id` is what gets written to `sessions.player_pack` and
 * `sessions.difficulty`, so if you rename one you will orphan any lobby created
 * before the rename. Add, don't rename.
 *
 * Every footballer carries a one-word hint: what an imposter is shown instead
 * of the name, if the host turns hints on. They are deliberately vague — the
 * thing people say about that player rather than anything you could look up.
 * Vinícius Júnior is "flair", Bruno Fernandes is "captain", Virgil van Dijk is
 * "aura". No clubs, no countries, no shirt numbers: a clue you can bluff
 * around, not one that hands the game over.
 *
 * The lists were written from general football knowledge and a read of the
 * summer 2026 window, not a live data source. Give them a read before launch;
 * squads move on.
 */
export const PACKS = [
  {
    id: 'premier_league',
    name: 'Premier League',
    blurb: 'The 2026/27 top flight, club by club.',
    tiers: premierLeague,
  },
  {
    id: 'champions_league',
    name: 'Champions League',
    blurb: "Europe's big clubs, minus the English ones.",
    tiers: championsLeague,
  },
  {
    id: 'world_cup',
    name: 'World Cup Heroes',
    blurb: 'Legends of every World Cup since 1954.',
    tiers: worldCup,
  },
]

export const DIFFICULTIES = [
  {
    id: 'casual',
    name: 'Casual',
    level: 'Easy',
    blurb: 'Starting XI only. Names the whole table knows.',
  },
  {
    id: 'ball_aware',
    name: 'Ball Aware',
    level: 'Regular',
    blurb: 'Starting XI plus the bench. For people who actually watch.',
  },
  {
    id: 'you_know_ball',
    name: 'You Know Ball',
    level: 'Hard',
    blurb: 'The whole squad, niche ones included.',
  },
]

export const DEFAULT_PACK_ID = 'premier_league'
export const DEFAULT_DIFFICULTY_ID = 'casual'

export function getPack(id) {
  return PACKS.find((pack) => pack.id === id) || PACKS[0]
}

export function getDifficulty(id) {
  return DIFFICULTIES.find((d) => d.id === id) || DIFFICULTIES[0]
}

/**
 * One entry, whichever shape the pack file is in. The files hold
 * `{ name, hint }`, but an older pack — or a hand-edited one — may still be a
 * bare list of names, and a missing hint should cost you the clue, not the game.
 */
function entry(item) {
  if (typeof item === 'string') return { name: item, hint: null }
  return { name: item?.name ?? '', hint: item?.hint ?? null }
}

/**
 * The footballers in play for a pack at a difficulty: every tier up to and
 * including the chosen one, as `{ name, hint }`. Unknown ids fall back to the
 * defaults rather than throwing, since a stale lobby row should degrade to an
 * easy game, not a blank screen.
 */
export function playersFor(packId, difficultyId) {
  const pack = getPack(packId)
  const depth = DIFFICULTIES.findIndex((d) => d.id === getDifficulty(difficultyId).id)
  return DIFFICULTIES.slice(0, depth + 1)
    .flatMap((d) => pack.tiers[d.id] ?? [])
    .map(entry)
    .filter((p) => p.name)
}

/**
 * What start_game() wants: the same list split into two parallel arrays, so
 * hints[i] belongs to names[i].
 *
 * The whole pack's hints go up with the request, not just one. The server draws
 * the footballer, so if only the winning hint travelled, the payload would name
 * the answer — and the host's own phone would be holding it.
 */
export function candidatesFor(packId, difficultyId) {
  const list = playersFor(packId, difficultyId)
  return {
    names: list.map((p) => p.name),
    hints: list.map((p) => p.hint ?? ''),
  }
}

/**
 * Stable, filename-safe key for a footballer, used later to look up artwork
 * in /public/assets without storing a second field in every pack file.
 * "Kylian Mbappe" -> "kylian-mbappe"
 */
export function playerSlug(name) {
  return String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
