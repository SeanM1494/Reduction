/**
 * lib/cookCounters.ts — which view people cook in, as anonymous daily counts
 * (Oct 3; the server's COOK_COUNTERS, README "Usage counters"). PURE, so the
 * once-per-visit rule is tested.
 *
 * ONE VISIT is one time a saved recipe's screen is open. Within it each name
 * is reported at most once — "visits that ticked in Step-by-Step", never
 * taps — except a finish, which is once per cook (and a cook is already
 * once per six hours, RecipeScreen's stampCooked). That keeps it to a
 * handful of tiny requests per recipe, whatever happens on screen.
 *
 * Only a saved recipe counts: a preview and the demo never create a visit.
 */

export type CookCounter =
  | 'recipe_opened'
  | 'view_steps'
  | 'ticked_diagram'
  | 'ticked_steps'
  | 'finished_diagram'
  | 'finished_steps';

/** What the recipe screen tells its route (RecipeScreen's `onActivity`). */
export type CookActivity =
  | { kind: 'view'; view: 'overview' | 'cook' }
  | { kind: 'tick'; view: 'overview' | 'cook'; finished: boolean };

export interface CookVisit {
  opened(): void;
  activity(a: CookActivity): void;
}

export function createCookVisit(report: (name: CookCounter) => void): CookVisit {
  const sent = new Set<CookCounter>();
  const once = (name: CookCounter) => {
    if (sent.has(name)) return;
    sent.add(name);
    report(name);
  };
  return {
    opened: () => once('recipe_opened'),
    activity: (a) => {
      if (a.kind === 'view') {
        if (a.view === 'cook') once('view_steps');
        return;
      }
      const where = a.view === 'cook' ? 'steps' : 'diagram';
      once(`ticked_${where}`);
      if (a.finished) report(`finished_${where}`);
    },
  };
}
