import Panel from '../../ui/Panel'
import Chip from '../../ui/Chip'

/*
 * The table, as numbers. Pass & Play has no names to show — Player 2 is the
 * second person the phone reached — so the roster is a grid of numerals rather
 * than the named list the online game uses.
 *
 * `reveal` turns it into the full picture at the end: everyone's role, out or
 * not. Before then it shows only what the table already knows, which is who is
 * out and, for anyone voted out, what they turned out to be.
 */
export default function PassTable({ game, title = 'The table', reveal = false, className = '' }) {
  const numbers = Array.from({ length: game.settings.players }, (_, i) => i + 1)
  const inCount = numbers.length - game.out.length

  return (
    <Panel
      title={title}
      className={className}
      action={
        <span className="tabular text-footnote font-semibold text-text-3">
          {reveal
            ? `${numbers.length} player${numbers.length === 1 ? '' : 's'}`
            : `${inCount} of ${numbers.length} in`}
        </span>
      }
    >
      <ul className="grid grid-cols-4 gap-2" role="list" data-testid="pass-table">
        {numbers.map((n) => {
          const out = game.out.includes(n)
          const role = game.roles[n - 1]
          const showRole = reveal || out

          return (
            <li
              key={n}
              data-player={n}
              data-out={out ? 'true' : undefined}
              className={[
                'surface-sunken flex flex-col items-center gap-1 px-1 py-2.5',
                out ? 'opacity-60' : '',
              ].join(' ')}
            >
              <span
                className={`tabular text-title3 font-bold ${
                  out ? 'text-text-3 line-through' : 'text-text'
                }`}
              >
                {n}
              </span>

              {showRole ? (
                <Chip tone={role === 'imposter' ? 'flag' : 'neutral'}>
                  {role === 'imposter' ? 'Imposter' : 'Civilian'}
                </Chip>
              ) : (
                <span className="text-caption text-text-3">In</span>
              )}
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
