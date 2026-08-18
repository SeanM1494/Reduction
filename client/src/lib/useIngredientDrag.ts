/**
 * client/src/lib/useIngredientDrag.ts — press and hold to move an ingredient.
 *
 * WHY A HOLD, AND NOT A DRAG
 *
 * The diagram scrolls horizontally inside `.rd-frame` and the ingredient
 * column is sticky, so a plain drag starting on an ingredient is
 * indistinguishable from a scroll until it is too late to be either. The hold
 * disambiguates, and it buys the moment needed to light up the valid targets
 * before anything moves.
 *
 * STOPPING THE BROWSER FROM SCROLLING, WHICH IS THE WHOLE TRICK
 *
 * `touch-action: none` cannot be used: set up front it kills frame scrolling
 * in edit mode, and set at pickup it does nothing, because the browser latches
 * touch-action when the gesture starts, not when a style changes. So no
 * `preventDefault` happens during the hold — if the finger moves more than
 * MOVE_SLOP the hold is abandoned and the browser scrolls, natively and
 * uninterrupted, exactly as it would have.
 *
 * Once the hold completes we attach a *non-passive* `touchmove` listener to
 * the document and preventDefault every move. That works only because pickup
 * requires the finger to have stayed inside MOVE_SLOP, which is inside the
 * browser's own pan slop — no native scroll has begun, so there is still
 * something to prevent. Attach it later than that and the gesture is already
 * gone.
 *
 * A mouse gets none of this. There is no scroll ambiguity for a pointer whose
 * scrolling lives on a wheel, so waiting 350ms would only feel broken.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Recipe } from "../../../shared/layout";
import { noTargetsReason, validMoveTargets } from "../../../shared/edits";

/** Long enough that a scroll does not trip it, short enough that it does not
 *  feel like the app missed the touch. Between the ~250ms of touch drag-and-
 *  drop conventions and the 500ms of a system long-press, nearer the former
 *  because this is the primary way to move something rather than a shortcut. */
export const HOLD_MS = 350;

/** Movement before pickup that means "this was a scroll after all". Inside the
 *  browser's own pan slop, so abandoning here is always still possible. */
const MOVE_SLOP = 10;

/** A mouse has no scroll ambiguity, so it drags as soon as it clearly moves. */
const MOUSE_SLOP = 4;

/** How near an edge the pointer has to get before things scroll themselves,
 *  and how fast.
 *
 *  Both axes matter, for different reasons. Horizontally, the frame scrolls
 *  and a step outside the current window is otherwise unreachable. Vertically,
 *  the *page* scrolls — and it has to be done here because the drag suppresses
 *  native touch scrolling for its whole duration, so on a short screen a step
 *  one row further down would be unreachable too. Measured on an iPhone SE the
 *  next step down is already off screen when an ingredient is centred, so this
 *  is not a nicety. */
const EDGE_PX = 44;
const EDGE_SPEED = 14;
const PAGE_EDGE_PX = 56;
const PAGE_EDGE_SPEED = 10;

export interface DragGhost {
  x: number;
  y: number;
  width: number;
  label: string;
}

/**
 * The ghost is `position: fixed`, and a fixed element is not clipped by any
 * ancestor's overflow — so left unclamped it paints past the right edge of
 * the viewport whenever the finger nears it. Chromium neither grows
 * scrollWidth nor scrolls for that, which is why a page-level h-scroll sweep
 * calls it clean; Safari zooms the whole layout viewport out to fit, and the
 * diagram suddenly spans the screen with no margin until you pinch back.
 *
 * Measured before clamping: on an iPhone 13 the ghost reached right=462
 * against a 390px viewport, and 380 against 320 on an SE.
 *
 * These are the offsets .rd-drag-ghost carries in CSS (margin: -18px 0 0
 * -22px), which put it under the fingertip rather than on it. They live here
 * too because the clamp has to know where the box actually lands.
 */
const GHOST_OFFSET_X = 22;
const GHOST_OFFSET_Y = 18;
/** Roughly the ghost's height; only used to keep it on screen vertically. */
const GHOST_HEIGHT = 44;

function clampGhost(x: number, y: number, width: number): { x: number; y: number } {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  // left edge of the painted box is (x - GHOST_OFFSET_X)
  const minX = GHOST_OFFSET_X;
  const maxX = Math.max(minX, vw - width + GHOST_OFFSET_X);
  const minY = GHOST_OFFSET_Y;
  const maxY = Math.max(minY, vh - GHOST_HEIGHT + GHOST_OFFSET_Y);
  return {
    x: Math.min(Math.max(x, minX), maxX),
    y: Math.min(Math.max(y, minY), maxY),
  };
}

export interface IngredientDrag {
  /** Held but not yet picked up — drives the ring that fills over HOLD_MS. */
  pressing: string | null;
  /** Picked up and moving. */
  dragging: string | null;
  validTargets: Set<string>;
  /** Set when a pickup found nowhere legal to go, phrased for a person. */
  blockedReason: string | null;
  hoverTarget: string | null;
  ghost: DragGhost | null;
  onPointerDown: (e: React.PointerEvent, ingredientId: string) => void;
  cancel: () => void;
}

interface Options {
  recipe: Recipe;
  enabled: boolean;
  onMove: (ingredientId: string, toStepId: string) => void;
}

export function useIngredientDrag({ recipe, enabled, onMove }: Options): IngredientDrag {
  const [pressing, setPressing] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [validTargets, setValidTargets] = useState<Set<string>>(() => new Set());
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);
  const [ghost, setGhost] = useState<DragGhost | null>(null);

  /** Everything the gesture needs that must not trigger a render when it
   *  changes. Kept in one ref so teardown is a single reset. */
  const g = useRef<{
    id: string | null;
    pointerId: number | null;
    pointerType: string;
    startX: number;
    startY: number;
    holdTimer: number | null;
    frame: HTMLElement | null;
    label: string;
    width: number;
    edgeRaf: number | null;
    edgeDir: number;
    pageDir: number;
    blockTouch: ((e: TouchEvent) => void) | null;
    live: boolean;
  }>({
    id: null, pointerId: null, pointerType: "", startX: 0, startY: 0,
    holdTimer: null, frame: null, label: "", width: 0,
    edgeRaf: null, edgeDir: 0, pageDir: 0, blockTouch: null, live: false,
  });

  const recipeRef = useRef(recipe);
  recipeRef.current = recipe;
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const teardown = useCallback(() => {
    const s = g.current;
    if (s.holdTimer != null) window.clearTimeout(s.holdTimer);
    if (s.edgeRaf != null) cancelAnimationFrame(s.edgeRaf);
    if (s.blockTouch) document.removeEventListener("touchmove", s.blockTouch);
    document.body.classList.remove("rd-dragging-body");
    g.current = {
      id: null, pointerId: null, pointerType: "", startX: 0, startY: 0,
      holdTimer: null, frame: null, label: "", width: 0,
      edgeRaf: null, edgeDir: 0, pageDir: 0, blockTouch: null, live: false,
    };
    setPressing(null);
    setDragging(null);
    setHoverTarget(null);
    setGhost(null);
    setValidTargets(new Set());
    setBlockedReason(null);
  }, []);

  /** Scrolls the frame sideways, and the page down, while the pointer loiters
   *  near an edge. One loop drives both so they cannot fight each other. */
  const runEdgeScroll = useCallback(() => {
    const s = g.current;
    if (!s.live || (s.edgeDir === 0 && s.pageDir === 0)) {
      s.edgeRaf = null;
      return;
    }
    if (s.frame && s.edgeDir !== 0) s.frame.scrollLeft += s.edgeDir * EDGE_SPEED;
    if (s.pageDir !== 0) window.scrollBy(0, s.pageDir * PAGE_EDGE_SPEED);
    s.edgeRaf = requestAnimationFrame(runEdgeScroll);
  }, []);

  const beginDrag = useCallback(
    (clientX: number, clientY: number) => {
      const s = g.current;
      if (!s.id) return;
      s.live = true;

      const targets = validMoveTargets(recipeRef.current, s.id);
      setValidTargets(new Set(targets));
      setBlockedReason(targets.length ? null : noTargetsReason(recipeRef.current, s.id));
      setPressing(null);
      setDragging(s.id);
      const at = clampGhost(clientX, clientY, s.width);
      setGhost({ x: at.x, y: at.y, width: s.width, label: s.label });
      document.body.classList.add("rd-dragging-body");

      // Android/Chrome only; iOS Safari has no Vibration API at all, which is
      // why the ring and the lift are the real acknowledgement and this is a
      // bonus rather than the signal.
      try {
        navigator.vibrate?.(15);
      } catch {
        /* a refused vibration is never a reason to abandon a drag */
      }

      // See the header: this is the only reliable way to stop the page and the
      // frame scrolling for the rest of the gesture, and it only works because
      // nothing has started scrolling yet.
      const block = (e: TouchEvent) => {
        if (e.cancelable) e.preventDefault();
      };
      s.blockTouch = block;
      document.addEventListener("touchmove", block, { passive: false });
    },
    []
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent, ingredientId: string) => {
      if (!enabled) return;
      // Secondary buttons are for menus, not for moving things.
      if (e.pointerType === "mouse" && e.button !== 0) return;

      const cell = (e.currentTarget as HTMLElement) ?? null;
      const rect = cell?.getBoundingClientRect();
      const s = g.current;
      s.id = ingredientId;
      s.pointerId = e.pointerId;
      s.pointerType = e.pointerType;
      s.startX = e.clientX;
      s.startY = e.clientY;
      s.frame = cell?.closest(".rd-frame") as HTMLElement | null;
      s.label = cell?.querySelector(".rd-name")?.textContent?.trim() || "ingredient";
      s.width = rect ? Math.min(rect.width, 200) : 140;

      if (e.pointerType === "mouse") {
        setPressing(ingredientId);
        return;
      }
      setPressing(ingredientId);
      s.holdTimer = window.setTimeout(() => {
        g.current.holdTimer = null;
        beginDrag(s.startX, s.startY);
      }, HOLD_MS);
    },
    [enabled, beginDrag]
  );

  const cancel = useCallback(() => teardown(), [teardown]);

  useEffect(() => {
    if (!pressing && !dragging) return;

    const move = (e: PointerEvent) => {
      const s = g.current;
      if (s.pointerId !== e.pointerId) return;

      if (!s.live) {
        const far = Math.hypot(e.clientX - s.startX, e.clientY - s.startY);
        if (s.pointerType === "mouse") {
          if (far > MOUSE_SLOP) beginDrag(e.clientX, e.clientY);
          return;
        }
        // Moved before the hold completed: this was a scroll. Nothing has been
        // prevented, so the browser is already doing the right thing.
        if (far > MOVE_SLOP) teardown();
        return;
      }

      setGhost((prev) => {
        if (!prev) return prev;
        const at = clampGhost(e.clientX, e.clientY, prev.width);
        return at.x === prev.x && at.y === prev.y ? prev : { ...prev, x: at.x, y: at.y };
      });

      // The ghost is pointer-events:none, so this finds what is under it.
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const stepEl = under?.closest?.("[data-step-id]") as HTMLElement | null;
      const stepId = stepEl?.dataset.stepId ?? null;
      setHoverTarget((prev) => {
        const next = stepId && validTargets.has(stepId) ? stepId : null;
        return next === prev ? prev : next;
      });

      if (s.frame) {
        const r = s.frame.getBoundingClientRect();
        s.edgeDir = e.clientX < r.left + EDGE_PX ? -1 : e.clientX > r.right - EDGE_PX ? 1 : 0;
      }
      s.pageDir =
        e.clientY < PAGE_EDGE_PX ? -1 : e.clientY > window.innerHeight - PAGE_EDGE_PX ? 1 : 0;
      if ((s.edgeDir !== 0 || s.pageDir !== 0) && s.edgeRaf == null) {
        s.edgeRaf = requestAnimationFrame(runEdgeScroll);
      }
    };

    const up = (e: PointerEvent) => {
      const s = g.current;
      if (s.pointerId !== e.pointerId) return;
      const id = s.id;
      const target = hoverTarget;
      const wasLive = s.live;
      teardown();
      if (wasLive && id && target) onMoveRef.current(id, target);
    };

    const cancelled = () => teardown();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") teardown();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancelled);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancelled);
      window.removeEventListener("keydown", key);
    };
  }, [pressing, dragging, hoverTarget, validTargets, beginDrag, teardown, runEdgeScroll]);

  // Leaving edit mode mid-gesture must not leave the document listener on.
  useEffect(() => {
    if (!enabled) teardown();
  }, [enabled, teardown]);
  useEffect(() => teardown, [teardown]);

  return {
    pressing, dragging, validTargets, blockedReason, hoverTarget, ghost,
    onPointerDown, cancel,
  };
}
