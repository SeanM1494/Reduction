/**
 * lib/libraryViewMode.ts — which way the Library is browsed. Pure, so the
 * runner can test it.
 *
 * `books` is the Recipe Box (the default); `grid` is the box laid out flat,
 * two across. Chosen in Settings, per device, under BOX_STYLE_KEY. (The
 * card stack that was the third way is retired; the books replaced it.)
 */

export type LibraryView = 'grid' | 'books';

/** "Recipe box style" in Settings, per device like the theme. Its own key:
 *  the Library's old in-screen toggle wrote `reduction_library_view`. */
export const BOX_STYLE_KEY = 'reduction_box_style';
export const LEGACY_VIEW_KEY = 'reduction_library_view';

/** Books first: it is the default. */
export const BOX_STYLES: ReadonlyArray<{ view: LibraryView; label: string }> = [
  { view: 'books', label: 'Books' },
  { view: 'grid', label: 'Grid' },
];

/**
 * The style to open on. Books unless Grid was CHOSEN: the Settings key
 * first, then the old toggle's key — which only ever held a value someone
 * tapped (nothing wrote the default), so a stored 'grid' there is a real
 * choice worth carrying over. Its 'stack' is the books now.
 */
export function parseBoxStyle(raw: unknown, legacy?: unknown): LibraryView {
  if (raw === 'grid' || raw === 'books') return raw;
  return legacy === 'grid' ? 'grid' : 'books';
}
