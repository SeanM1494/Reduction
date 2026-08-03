import "./_group.css";

// Concept 2 — Distillation Funnel.
// The literal culinary sense of "reduction": a wide pour narrowing to a
// single drop. Built from flat, hard-edged bands (not a soft organic
// funnel) so it still feels like the app's geometric, table-driven visual
// system rather than a generic cooking icon.
function Mark({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon points="8,10 88,10 62,40 34,40" fill="#93a2b0" opacity="0.4" />
      <polygon points="34,40 62,40 54,62 42,62" fill="#3f9aa3" opacity="0.65" />
      <polygon points="42,62 54,62 50,74 46,74" fill="#d68a00" opacity="0.85" />
      <circle cx="48" cy="86" r="7" fill="#1b2430" />
    </svg>
  );
}

function NavMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <polygon points="2,3 22,3 15,13 9,13" fill="#d68a00" opacity="0.75" />
      <circle cx="12" cy="19.5" r="3.2" fill="#1b2430" />
    </svg>
  );
}

export default function Funnel() {
  return (
    <div className="logo-sheet">
      <div>
        <p className="logo-eyebrow">Concept 2 of 3</p>
        <p className="logo-name">Distillation Funnel</p>
        <p className="logo-blurb">
          The most literal take on "reduction" -- a wide pour narrowing down
          to a single drop, like a sauce reducing in a pan. Flat geometric
          bands instead of a soft funnel keep it feeling engineered rather
          than like a stock cooking-app icon.
        </p>
      </div>

      <div className="logo-row">
        <div className="logo-tile is-hero">
          <Mark size={140} />
        </div>
        <div className="logo-tile is-lockup">
          <NavMark size={40} />
          <div className="logo-lockup-text">
            <span className="logo-wordmark">Reduction</span>
            <span className="logo-tagline">every recipe, as one diagram</span>
          </div>
        </div>
        <div className="logo-tile is-dark is-lockup">
          <NavMark size={40} />
          <div className="logo-lockup-text">
            <span className="logo-wordmark">Reduction</span>
            <span className="logo-tagline">every recipe, as one diagram</span>
          </div>
        </div>
      </div>

      <div className="logo-row">
        <div>
          <div className="logo-tile is-small">
            <NavMark size={28} />
          </div>
          <p className="logo-caption">nav size</p>
        </div>
        <div>
          <div className="logo-tile is-fav">
            <NavMark size={20} />
          </div>
          <p className="logo-caption">favicon</p>
        </div>
        <div>
          <div className="logo-tile is-small is-dark">
            <NavMark size={28} />
          </div>
          <p className="logo-caption">on dark</p>
        </div>
      </div>
    </div>
  );
}
