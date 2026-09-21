/*
 * The room the cards sit in: the flat ground, two very soft lights, and a
 * vignette. Fixed, behind everything, no animation. `accent` tints the lights
 * so a screen belonging to one game sits in that game's colour.
 */
export default function Backdrop({ accent = 'accent-crimson' }) {
  return (
    <div
      className={`pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-bg ${accent}`}
      aria-hidden="true"
    >
      <div className="glow absolute -top-[18vh] -left-[22vw] h-[62vh] w-[88vw] opacity-40" />
      <div className="glow accent-royal absolute -right-[26vw] bottom-[-14vh] h-[54vh] w-[80vw] opacity-25" />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 80% at 50% 0%, transparent 40%, oklch(0% 0 0 / 0.55) 100%)',
        }}
      />
    </div>
  )
}
