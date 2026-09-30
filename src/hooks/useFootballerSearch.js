import { useEffect, useState } from 'react'
import { searchFootballers } from '../lib/tttApi'

export const SEARCH_MIN_LENGTH = 2
export const SEARCH_LIMIT = 8
const DEBOUNCE_MS = 220

/**
 * The autocomplete behind every Tic-Tac-Toe answer: football_search_players,
 * debounced, a few results at a time.
 *
 * Only the answer to the newest query is ever shown. Each query's request is
 * abandoned the moment the query changes, and a reply is kept only if it is
 * for exactly what is in the box now, so a slow early reply can never replace
 * a quick later one.
 *
 * The server searches every footballer, never just the ones who fit the
 * square, and returns names and birth years only. The rows are passed on as
 * they come: nothing here could say whether anyone fits anything.
 *
 *   status  'idle'     fewer than two letters typed
 *           'loading'  waiting for the newest query (`rows` still holds the
 *                      previous answer, so the list does not flash empty)
 *           'done'     `rows` answers the query in the box
 *           'error'    the search failed
 */
export function useFootballerSearch(client, query) {
  const [answer, setAnswer] = useState({ query: null, rows: [], error: null })
  const trimmed = query.trim()
  const searchable = trimmed.length >= SEARCH_MIN_LENGTH

  useEffect(() => {
    if (!client || !searchable) return undefined
    let cancelled = false
    const timer = setTimeout(async () => {
      const { rows, error } = await searchFootballers(client, trimmed, SEARCH_LIMIT)
      if (cancelled) return
      if (error) {
        console.error('[tic-tac-toe] footballer search failed', { code: error.code, message: error.message })
      }
      setAnswer({ query: trimmed, rows: error ? [] : rows, error: error ?? null })
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [client, trimmed, searchable])

  if (!searchable) return { status: 'idle', rows: [], query: trimmed }
  if (answer.query !== trimmed) return { status: 'loading', rows: answer.rows, query: trimmed }
  if (answer.error) return { status: 'error', rows: [], query: trimmed }
  return { status: 'done', rows: answer.rows, query: trimmed }
}
