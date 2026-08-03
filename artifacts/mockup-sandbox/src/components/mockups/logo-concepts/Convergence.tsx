import "./_group.css";

// Concept 1 — Convergence Grid.
// A trail of small, fading cells (the many ingredients/steps a recipe
// starts as) collapses diagonally into one bold, solid cell -- the same
// "many rows become one clear step" idea already baked into the app's
// dependency table. Reads as a mark on its own, at nav size, and as a
// favicon without losing the concept.
function Mark({ size = 96 }: { size?: number }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="18" height="18" rx="4" fill="#93a2b0" opacity="0.35" />
      <rect x="27" y="16" width="22" height="22" rx="4" fill="#3f9aa3" opacity="0.55" />
      <rect x="52" y="30" width="26" height="26" rx="5" fill="#d68a00" opacity="0.8" />
      <rect x="40" y="58" width="40" height="34" rx="7" fill="#1b2430" />
    </svg>
  );
}

function NavMark({ size = 22 }: { size?: number }) {
  // Simplified 2-shape reading for tiny sizes (nav bar, favicon).
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="9" height="9" rx="2" fill="#d68a00" opacity="0.7" />
      <rect x="10" y="10" width="13" height="13" rx="3" fill="#1b2430" />
    </svg>
  );
}

export default function Convergence() {
  return (
    <div className="logo-sheet">
      <div>
        <p className="logo-eyebrow">Concept 1 of 3</p>
        <p className="logo-name">Convergence Grid</p>
        <p className="logo-blurb">
          A trail of small, fading cells collapses into one solid square --
          the many ingredients and steps a recipe starts as, reduced down to
          one clear thing to do next. It's a direct extension of the app's
          own dependency-table language, not a new metaphor bolted on.
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
