import "./_group.css";

// Concept 2 — Reduction Drop (revised).
// A sauce droplet held up on a spoon — the one concentrated thing that
// remains after a long recipe reduces. Level bands inside the drop show
// the original volume (many faint lines at top) collapsing down to a
// single amber pool at the base: the distilled essence of the recipe.
// Uses the same "many → one" narrative as before but now coded as a
// clearly culinary shape, not an engineering funnel.

const DROP_PATH = "M 48 4 C 20 28,16 46,16 60 A 32 32 0 0 0 80 60 C 80 46,76 28,48 4 Z";

function Mark({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="drop-clip">
          <path d={DROP_PATH} />
        </clipPath>
      </defs>
      {/* Drop background */}
      <path d={DROP_PATH} fill="#f0f4f6" />
      {/* Level bands — many faint lines at top, reducing to bold amber fill */}
      <g clipPath="url(#drop-clip)">
        <rect x="0" y="22" width="96" height="5" rx="2" fill="#93a2b0" opacity="0.3" />
        <rect x="0" y="32" width="96" height="5" rx="2" fill="#93a2b0" opacity="0.45" />
        <rect x="0" y="42" width="96" height="7" rx="2.5" fill="#3f9aa3" opacity="0.65" />
        <rect x="0" y="53" width="96" height="10" rx="3" fill="#d68a00" opacity="0.8" />
        <rect x="0" y="64" width="96" height="32" fill="#d68a00" />
      </g>
      {/* Drop outline */}
      <path d={DROP_PATH} stroke="#1b2430" strokeWidth="2.5" />
      {/* Sheen — small highlight ellipse near top-left of drop */}
      <ellipse cx="35" cy="30" rx="5" ry="8" fill="white" opacity="0.3" transform="rotate(-20 35 30)" />
    </svg>
  );
}

const NAV_DROP = "M 12 2 C 5 8,4 14,4 17 A 8 8 0 0 0 20 17 C 20 14,19 8,12 2 Z";

function NavMark({ size = 22, dark = false }: { size?: number; dark?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id="nav-drop-clip">
          <path d={NAV_DROP} />
        </clipPath>
      </defs>
      <path d={NAV_DROP} fill={dark ? "#2a3b4d" : "#ffe8bf"} />
      <g clipPath="url(#nav-drop-clip)">
        <rect x="0" y="7" width="24" height="3" fill="#3f9aa3" opacity="0.7" />
        <rect x="0" y="14" width="24" height="11" fill="#d68a00" />
      </g>
      <path d={NAV_DROP} stroke="#1b2430" strokeWidth="1.5" />
    </svg>
  );
}

export default function Funnel() {
  return (
    <div className="logo-sheet">
      <div>
        <p className="logo-eyebrow">Concept 2 of 3 — revised</p>
        <p className="logo-name">Reduction Drop</p>
        <p className="logo-blurb">
          A sauce droplet held up on a spoon: the one concentrated thing
          that remains after a long recipe boils down. Level bands inside
          show the original volume — many faint lines at top — collapsing
          to a single amber pool at the base. Same "many → one" story,
          now unmistakably a kitchen shape.
        </p>
      </div>

      <div className="logo-row">
        <div className="logo-tile is-hero">
          <Mark size={160} />
        </div>
        <div className="logo-tile is-lockup">
          <NavMark size={42} />
          <div className="logo-lockup-text">
            <span className="logo-wordmark">Reduction</span>
            <span className="logo-tagline">every recipe, as one diagram</span>
          </div>
        </div>
        <div className="logo-tile is-dark is-lockup">
          <NavMark size={42} dark />
          <div className="logo-lockup-text">
            <span className="logo-wordmark">Reduction</span>
            <span className="logo-tagline">every recipe, as one diagram</span>
          </div>
        </div>
      </div>

      <div className="logo-row">
        <div>
          <div className="logo-tile is-small">
            <NavMark size={30} />
          </div>
          <p className="logo-caption">nav size</p>
        </div>
        <div>
          <div className="logo-tile is-fav">
            <NavMark size={22} />
          </div>
          <p className="logo-caption">favicon</p>
        </div>
        <div>
          <div className="logo-tile is-small is-dark">
            <NavMark size={30} dark />
          </div>
          <p className="logo-caption">on dark</p>
        </div>
        <div>
          <div className="logo-tile is-small" style={{ background: "var(--warm-bg)" }}>
            <NavMark size={30} />
          </div>
          <p className="logo-caption">on warm</p>
        </div>
      </div>
    </div>
  );
}
