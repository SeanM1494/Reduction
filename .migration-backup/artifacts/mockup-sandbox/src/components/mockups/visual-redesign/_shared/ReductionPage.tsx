// Shared markup used by "Current" and every aesthetic variant in this group.
// Structure and copy are held fixed on purpose — only the imported CSS
// (colors + fonts) differs between variants. Content mirrors the real
// Home + RecipeView + Diagram screens (nav, hero, import card, saved
// recipe grid, one recipe section with its dependency table and finish
// strip) using the app's actual seed data for the graham cracker crust.
export function ReductionPage() {
  return (
    <div className="rd-root">
      <nav className="rd-nav">
        <button className="rd-brand" type="button">
          <span className="rd-logo" />
          Reduction
        </button>
        <span className="rd-nav-meta">1 recipe saved</span>
      </nav>

      <div className="rd-shell">
        <header className="rd-hero">
          <h1 className="rd-hero-title">Turn any recipe into a dependency graph.</h1>
          <p className="rd-hero-sub">
            Paste a link, paste text, or snap a photo — Reduction breaks it into
            ingredients and steps you can check off in order.
          </p>
        </header>

        <div className="rd-import">
          <div className="rd-tabs">
            <button className="rd-tab is-on" type="button">Link</button>
            <button className="rd-tab" type="button">Paste</button>
            <button className="rd-tab" type="button">Photo</button>
          </div>
          <div className="rd-urlbar">
            <input
              className="rd-url"
              placeholder="https://example.com/graham-cracker-cheesecake"
              readOnly
            />
            <button className="rd-go" type="button">Import</button>
          </div>
        </div>

        <section>
          <div className="rd-lib-head">
            <h2 className="rd-lib-title">Your recipes</h2>
            <span className="rd-lib-count">1 saved</span>
          </div>
          <div className="rd-grid">
            <button className="rd-card" type="button">
              <span className="rd-card-title">Graham Cracker Cheesecake</span>
              <span className="rd-card-meta">2 sections · 9 steps</span>
              <span className="rd-card-bar">
                <span className="rd-card-fill" style={{ width: "43%" }} />
              </span>
              <span className="rd-card-pct">43% done</span>
            </button>
          </div>
        </section>

        <section className="rd-section">
          <div className="rd-section-head">
            <p className="rd-eyebrow">
              Graham cracker crust <span className="rd-eyebrow-num">1 / 2</span>
            </p>
            <p className="rd-oven">Oven 325°F</p>
          </div>

          <div className="rd-frame">
            <table className="rd-table">
              <tbody>
                <tr>
                  <td className="rd-cell rd-ing is-done">
                    <span className="rd-ing-body">
                      <span className="rd-amount">1½ cups</span>
                      <span className="rd-name">graham cracker crumbs</span>
                    </span>
                    <span className="rd-mark" />
                  </td>
                  <td className="rd-cell rd-op is-done">
                    <span className="rd-op-label">process to crumbs</span>
                    <span className="rd-mark" />
                  </td>
                  <td className="rd-cell rd-op" rowSpan={3}>
                    <span className="rd-op-label">mix</span>
                  </td>
                </tr>
                <tr>
                  <td className="rd-cell rd-ing is-done">
                    <span className="rd-ing-body">
                      <span className="rd-amount">6 tbsp</span>
                      <span className="rd-name">butter, melted</span>
                    </span>
                    <span className="rd-mark" />
                  </td>
                  <td className="rd-cell rd-op is-ready">
                    <span className="rd-op-label">melt</span>
                  </td>
                </tr>
                <tr>
                  <td className="rd-cell rd-ing">
                    <span className="rd-ing-body">
                      <span className="rd-amount">¼ cup</span>
                      <span className="rd-name">sugar</span>
                    </span>
                  </td>
                  <td className="rd-gap" />
                </tr>
              </tbody>
            </table>
          </div>

          <ol className="rd-finish">
            <li className="rd-fin-item">
              <button className="rd-fin" type="button">
                <span className="rd-fin-num">1</span>
                <span className="rd-fin-label">press into 10-in pan</span>
              </button>
            </li>
            <li className="rd-fin-item">
              <button className="rd-fin" type="button">
                <span className="rd-fin-num">2</span>
                <span className="rd-fin-label">bake 325°F</span>
                <span className="rd-fin-time">12 min</span>
              </button>
            </li>
          </ol>
        </section>
      </div>
    </div>
  );
}
