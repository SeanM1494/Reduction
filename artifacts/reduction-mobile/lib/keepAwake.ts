/**
 * Cook mode keeps the screen on. A phone propped on a counter dims and
 * locks between steps otherwise, and hands covered in dough cannot wake it.
 *
 * On while `active` AND the app is in the foreground; off on leaving cook
 * mode, on unmount and on going to the background, back on when the app
 * returns. Each caller holds its own tag, so one screen releasing never
 * releases another's hold. A failure to take the lock is swallowed: a
 * screen that dims is the old behaviour, never a reason to break cooking.
 *
 * The native half (ExpoKeepAwake) is one of `expo`'s own modules and was
 * already linked into every binary; the direct dependency only lets this
 * file import it, so this needs no native build.
 */
import { useEffect, useId } from 'react';
import { AppState } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

export function useKeepAwakeWhile(active: boolean): void {
  const tag = `reduction-keep-awake-${useId()}`;
  useEffect(() => {
    if (!active) return;
    let held = false;
    const hold = () => {
      if (held) return;
      held = true;
      activateKeepAwakeAsync(tag).catch(() => {
        held = false;
      });
    };
    const release = () => {
      if (!held) return;
      held = false;
      deactivateKeepAwake(tag).catch(() => {});
    };
    if (AppState.currentState === 'active') hold();
    const sub = AppState.addEventListener('change', (s) => (s === 'active' ? hold() : release()));
    return () => {
      sub.remove();
      release();
    };
  }, [active, tag]);
}
