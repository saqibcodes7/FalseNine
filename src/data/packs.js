import premierLeague from './premier_league.json'
import championsLeague from './champions_league.json'
import worldCup from './world_cup.json'

/**
 * Player packs, bundled into the build as static JSON (Phase 1 of the roadmap).
 * The `id` is what gets written to `sessions.player_pack`, so if you rename one
 * you will orphan any lobby created before the rename. Add, don't rename.
 *
 * These lists were written from general football knowledge and are not tied to
 * a live data source, so give them a read before launch — squads move on.
 */
export const PACKS = [
  {
    id: 'premier_league',
    name: 'Premier League',
    blurb: 'Current top-flight regulars. The safe opener.',
    difficulty: 'Easy',
    players: premierLeague,
  },
  {
    id: 'champions_league',
    name: 'Champions League',
    blurb: 'Europe-wide. Harder if your football stops at Dover.',
    difficulty: 'Medium',
    players: championsLeague,
  },
  {
    id: 'world_cup',
    name: 'World Cup Legends',
    blurb: 'All-time greats. Rewards the one who watches the old finals.',
    difficulty: 'Hard',
    players: worldCup,
  },
]

export const DEFAULT_PACK_ID = 'premier_league'

export function getPack(id) {
  return PACKS.find((pack) => pack.id === id) || PACKS[0]
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
