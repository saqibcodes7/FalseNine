import { Link } from 'react-router-dom'
import Screen from '../../ui/Screen'
import Panel from '../../ui/Panel'
import ConfigNotice from '../../ui/ConfigNotice'
import { isSupabaseConfigured } from '../../lib/supabase'

/*
 * Football Tic-Tac-Toe's front door: how are the two of you playing? Each
 * way is one big choice with one line under it.
 */
const MODES = [
  {
    path: '/tic-tac-toe/online',
    title: 'Online',
    line: 'Play someone on another phone. Share a code and go.',
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2.5" y="5" width="7.5" height="13" rx="1.8" />
        <rect x="14" y="5" width="7.5" height="13" rx="1.8" />
        <path d="M10 11.5h4" strokeDasharray="1.2 1.8" />
      </svg>
    ),
  },
  {
    path: '/tic-tac-toe/pass',
    title: 'Pass & Play',
    line: 'Two of you, one phone. Hand it over after every turn.',
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="8.25" y="3.5" width="7.5" height="13" rx="1.8" />
        <path d="M4 19.5c2.2 1.3 4.8 1.5 8 1.5s5.8-.2 8-1.5M17.5 17.5l2.5 2-2.5 2M6.5 17.5l-2.5 2 2.5 2" />
      </svg>
    ),
  },
]

const RULES = [
  'Every square is where a row meets a column. Name a footballer who fits both.',
  'Right and the square is yours. Wrong and your turn is gone.',
  'Three in a row wins. Each footballer can only claim one square a board.',
]

export default function TttHome() {
  return (
    <Screen back="/" backLabel="Binder" accent="accent-teal" title="Football Tic-Tac-Toe" subtitle="Two players. Nine squares. How well do you know ball?">
      {!isSupabaseConfigured && (
        <div className="mb-6">
          <ConfigNotice />
        </div>
      )}

      <nav aria-label="How are you playing?" className="space-y-3">
        {MODES.map((mode) => (
          <Link
            key={mode.path}
            to={isSupabaseConfigured ? mode.path : '#'}
            aria-disabled={!isSupabaseConfigured || undefined}
            className={[
              'surface accent-teal pressable flex items-center gap-4 p-4 text-left',
              'transition-[transform,box-shadow] duration-[var(--dur-state)] ease-[var(--ease-out)]',
              isSupabaseConfigured ? 'hover:-translate-y-0.5 focus-visible:-translate-y-0.5' : 'pointer-events-none opacity-50',
            ].join(' ')}
            style={{ '--tint': '10%' }}
          >
            <span className="fill-tinted grid h-12 w-12 shrink-0 place-items-center rounded-[14px]">{mode.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-title3 font-semibold text-text">{mode.title}</span>
              <span className="mt-0.5 block text-subhead leading-snug text-text-2">{mode.line}</span>
            </span>
            <svg aria-hidden="true" viewBox="0 0 12 20" className="h-4 w-2.5 shrink-0 text-text-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 2l8 8-8 8" />
            </svg>
          </Link>
        ))}
      </nav>

      <Panel title="How it plays" className="mt-8" bodyClassName="p-0">
        <ol className="divide-hairline">
          {RULES.map((rule, i) => (
            <li key={rule} className="flex gap-3.5 px-4 py-3.5">
              <span className="accent-teal fill-accent grid h-6 w-6 shrink-0 place-items-center rounded-full text-caption font-bold" aria-hidden="true">
                {i + 1}
              </span>
              <span className="text-subhead leading-relaxed text-text-2">{rule}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </Screen>
  )
}
