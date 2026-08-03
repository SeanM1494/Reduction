import "./_group.css";

// Concept 3 — Compressed Stack.
// Many thin bars (a long recipe's wall of steps) compress into one thick,
// confident bar -- an equalizer/bracket reading that maps directly onto
// the product's promise: long recipe in, one clear bar of "what to do" out.
function Mark({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="6" y="10" width="60" height="6" rx="3" fill="#93a2b0" opacity="0.35" />
      <rect x="6" y="24" width="48" height="6" rx="3" fill="#93a2b0" opacity="0.5" />
      <rect x="6" y="38" width="60" height="8" rx="4" fill="#3f9aa3" opacity="0.65" />
      <rect x="6" y="54" width="40" height="8" rx="4" fill="#d68a00" opacity="0.85" />
      <rect x="6" y="70" width="84" height="16" rx="6" fill="#1b2430" />
    </svg>
  );
}

function NavMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.5" y="3" width="14" height="3" rx="1.5" fill="#93a2b0" opacity="0.55" />
      <rect x="1.5" y="9" width="10" height="3.4" rx="1.5" fill="#d68a00" opacity="0.85" />
      <rect x="1.5" y="16" width="21" height="6" rx="2.5" fill="#1b2430" />
    </svg>
  );
}

export default function Stack() {
  return (
    <div className="logo-sheet">
      <div>
        <p className="logo-eyebrow">Concept 3 of 3</p>
        <p className="logo-name">Compressed Stack</p>
        <p className="logo-blurb">
          Many thin, faint bars -- the wall of steps a long recipe reads as
          -- compress into one thick, confident bar. The most literal "long
          recipe in, one clear thing out" reading, styled like an equalizer
          rather than a kitchen icon.
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
