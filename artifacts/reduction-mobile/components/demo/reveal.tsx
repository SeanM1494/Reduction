/**
 * components/demo/reveal.tsx — bringing what the demo guide rings into view.
 *
 * The guide's card takes the bottom of the screen, and on a small phone the
 * thing it asks for is often below it: "the last step" is the finish strip,
 * under the whole table. The ring stays drawn by the target itself; a
 * `RevealAnchor` inside the ring, once laid out, asks the scroller around
 * it (through `RevealContext`) to scroll just far enough to show it. The
 * guide still never knows where anything is — the target and its scroller
 * work it out between them, in window coordinates, at the moment it counts.
 * Nothing that is not a demo draws a ring, so nothing else ever scrolls.
 */

import React, { createContext, useContext, useRef, type MutableRefObject, type RefObject } from 'react';
import { StyleSheet, View, type ScrollView } from 'react-native';

export type Reveal = (node: View | null) => void;

export const RevealContext = createContext<Reveal | null>(null);

/** Room left between a revealed target and the scroller's edge. */
const MARGIN = 16;

/**
 * The reveal for one vertical scroller: `offset` is kept current by the
 * scroller's onScroll. Scrolls only when the target is not already wholly
 * in view, and never past the top.
 */
export function makeReveal(scroller: RefObject<ScrollView | null>, offset: MutableRefObject<number>): Reveal {
  return (node) => {
    const box = scroller.current as unknown as View | null;
    if (!node || !box?.measureInWindow) return;
    // Read now: a cell in the pinned column is drawn twice and both copies
    // ask at once, and they must land on the same place, not add up.
    const base = offset.current;
    node.measureInWindow((_x, y, _w, h) => {
      box.measureInWindow((_bx, by, _bw, bh) => {
        let dy = 0;
        if (y + h > by + bh - MARGIN) dy = y + h - (by + bh - MARGIN);
        // A target taller than the view shows its top.
        if (y - dy < by + MARGIN) dy = y - (by + MARGIN);
        if (Math.abs(dy) < 1) return;
        const next = Math.max(0, base + dy);
        offset.current = next;
        scroller.current?.scrollTo({ y: next, animated: true });
      });
    });
  };
}

/** Inside a ringed target: once laid out, ask for it to be shown. */
export function RevealAnchor() {
  const reveal = useContext(RevealContext);
  const ref = useRef<View>(null);
  return (
    <View
      ref={ref}
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={reveal ? () => reveal(ref.current) : undefined}
    />
  );
}
