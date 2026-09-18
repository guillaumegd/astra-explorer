// When the interface steps aside. There is one bar and nothing else: after a
// stretch without a gesture it fades out whole, leaving the sky alone, and the
// next gesture brings it back. Kept pure so the rule is testable without a DOM.

/** Silence before the interface fades out, in milliseconds. */
export const REST_DELAY = 10000;
/** The drift is for watching: its interface steps aside much sooner. */
export const DRIFT_REST_DELAY = 2000;

export type RestConditions = {
  /** A panel is open: it is being read, and it holds the focus. */
  panel: boolean;
  /** The opening cinematic drives the chrome itself. */
  opening: boolean;
  /** A control carries a visible keyboard focus and must stay reachable. */
  focusedControl: boolean;
  /** The endless tour is running. */
  drifting: boolean;
};

/** How long the interface waits, from the last gesture, before fading out. */
export function restDelay(conditions: Pick<RestConditions, 'drifting'>) {
  return conditions.drifting ? DRIFT_REST_DELAY : REST_DELAY;
}

/** Whether the interface may fade out at all once that delay has run out. */
export function canRest(conditions: RestConditions) {
  return !conditions.panel && !conditions.opening && !conditions.focusedControl;
}

/**
 * Stepping to the next body, or to the next stop of a drift, is part of
 * watching rather than of driving: those keys move the view and leave the
 * interface where it is — away, if it had stepped aside.
 */
export function wakesInterface(key: string) {
  return key !== 'ArrowLeft' && key !== 'ArrowRight';
}
