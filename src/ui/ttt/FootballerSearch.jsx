import { useId, useState } from 'react'
import { SEARCH_MIN_LENGTH, useFootballerSearch } from '../../hooks/useFootballerSearch'
import { footballerMeta } from './format'

/*
 * Find a footballer by name and pick him. What gets submitted is the id of
 * the row picked, never the text typed.
 *
 * Each result shows what he is known as, his full name and the year he was
 * born, because that is all the server returns: nothing about his clubs, his
 * country or his medals, and nothing about whether he fits the square.
 *
 * A combobox: arrow keys move through the results, Enter picks, and focus
 * stays in the box the whole time. On a phone, a tap picks.
 */
export default function FootballerSearch({ client, selected, onSelect, onType, disabled = false, inputRef }) {
  const id = useId()
  const listId = `${id}-results`
  const [query, setQuery] = useState('')
  const search = useFootballerSearch(client, query)
  const rows = search.rows

  // Which result the arrow keys are on, for this list of results only.
  const listKey = `${search.query}|${rows.map((r) => r.id).join(',')}`
  const [active, setActive] = useState({ key: null, index: -1 })
  const activeIndex = active.key === listKey ? active.index : -1

  function move(step) {
    if (rows.length === 0) return
    const next = activeIndex < 0 ? (step > 0 ? 0 : rows.length - 1) : (activeIndex + step + rows.length) % rows.length
    setActive({ key: listKey, index: next })
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      move(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      move(-1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const row = rows[activeIndex] ?? (rows.length === 1 ? rows[0] : null)
      if (row) onSelect(row)
    }
  }

  const status =
    search.status === 'idle'
      ? `Type at least ${SEARCH_MIN_LENGTH} letters of his name.`
      : search.status === 'error'
        ? 'Search is not working right now. Try again in a moment.'
        : search.status === 'loading' && rows.length === 0
          ? 'Searching…'
          : search.status === 'done' && rows.length === 0
            ? 'No footballers found. Check the spelling.'
            : ''

  return (
    <div>
      <label htmlFor={`${id}-input`} className="mb-2 block text-footnote font-semibold text-text-2">
        Search footballers
      </label>
      <div className="surface-sunken flex items-center gap-2 px-3.5 transition-shadow duration-200 focus-within:shadow-[inset_0_0_0_1.5px_var(--color-gold),inset_0_1px_3px_oklch(0%_0_0/.3)]">
        <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-text-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="7" cy="7" r="4.6" />
          <path d="m10.5 10.5 3.3 3.3" />
        </svg>
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-expanded={rows.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${id}-opt-${activeIndex}` : undefined}
          aria-describedby={`${id}-status`}
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value)
            onType?.()
          }}
          onKeyDown={onKeyDown}
          placeholder="Start typing a name"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          maxLength={80}
          className="block min-w-0 flex-1 bg-transparent py-3.5 text-body text-text outline-none placeholder:text-text-4"
        />
        {search.status === 'loading' && rows.length > 0 && (
          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-text-4 border-t-gold" aria-hidden="true" />
        )}
      </div>

      <p id={`${id}-status`} aria-live="polite" className="mt-2 min-h-[1.25rem] text-footnote text-text-3" data-testid="search-status">
        {status}
        {search.status === 'done' && rows.length > 0 && (
          <span className="sr-only">
            {rows.length} {rows.length === 1 ? 'result' : 'results'}
          </span>
        )}
      </p>

      <ul
        id={listId}
        role="listbox"
        aria-label="Footballers"
        aria-busy={search.status === 'loading'}
        className={`mt-1 space-y-1.5 transition-opacity ${search.status === 'loading' ? 'opacity-60' : ''}`}
        data-testid="search-results"
      >
        {rows.map((row, i) => {
          const isSelected = selected?.id === row.id
          const isActive = i === activeIndex
          const meta = footballerMeta(row)
          return (
            <li
              key={row.id}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={isSelected}
              data-testid="search-result"
              data-footballer-id={row.id}
              onClick={() => onSelect(row)}
              onMouseMove={() => (isActive ? null : setActive({ key: listKey, index: i }))}
              className={[
                'flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-[12px] px-3.5 py-2.5 select-none',
                'transition-[background-color,box-shadow] duration-[var(--dur-press)]',
                isSelected
                  ? 'bg-white/[0.09] shadow-[inset_0_0_0_1.5px_var(--color-gold)]'
                  : isActive
                    ? 'bg-white/[0.07]'
                    : 'bg-white/[0.035]',
              ].join(' ')}
            >
              <span className="min-w-0">
                <span className="block truncate text-callout font-semibold text-text">{row.known_as}</span>
                {meta && <span className="block truncate text-footnote text-text-3">{meta}</span>}
              </span>
              {isSelected && (
                <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-gold" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2.5 8.5 6.2 12.4 13.5 3.8" />
                </svg>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
