export default function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}) {
  return (
    <label
      className={`flex items-start justify-between gap-4 ${
        disabled ? 'opacity-50' : 'cursor-pointer'
      }`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-chalk-100">
          {label}
        </span>
        {description && (
          <span className="mt-1 block text-sm leading-snug text-chalk-400">
            {description}
          </span>
        )}
      </span>

      <span className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          aria-hidden="true"
          className="block h-7 w-12 rounded-full bg-pitch-700 transition-colors peer-checked:bg-lime-400 peer-focus-visible:ring-2 peer-focus-visible:ring-lime-400 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-pitch-950"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1 left-1 h-5 w-5 rounded-full bg-chalk-100 transition-transform duration-200 peer-checked:translate-x-5 peer-checked:bg-pitch-950"
        />
      </span>
    </label>
  )
}
