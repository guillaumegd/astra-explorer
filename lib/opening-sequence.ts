const BASE_DURATION = 7800;
// Stretches the whole timeline without touching its choreography.
const PACE = 2;
export const OPENING_DURATION = BASE_DURATION * PACE;
export const OPENING_STORAGE_KEY = 'astra-opening-seen-v1';

export const TITLE_PARTS = 6; // the logo, then the five letters of ASTRA
const LETTER_START = 300;
const LETTER_STAGGER = 220;
const LETTER_RAMP = 1000;
const REDUCED_LETTERS = [300, 1700] as const;
const INVITATION_IN = [2700, 3450] as const;
const CREDIT_IN = [3550, 4200] as const;
const REVEAL = [5100, 6600] as const;
const CAMERA_END = 7400;
const TITLE_OUT = [6550, 7300] as const;
const INVITATION_OUT = [6300, 7050] as const;
const CREDIT_OUT = [6300, 6900] as const;

const letterStart = (index: number) => LETTER_START + index * LETTER_STAGGER;

const smooth = (elapsed: number, start: number, end: number) => {
  const x = Math.max(0, Math.min(1, (elapsed - start) / (end - start)));
  return x * x * (3 - 2 * x);
};

// One clock drives typography, the aperture, the lens and the handoff.
export function sampleOpening(elapsed: number, reducedMotion = false) {
  const t = elapsed / PACE;
  const titleOut = 1 - smooth(t, ...TITLE_OUT);
  return {
    // index 0 is the logo, staggered in as if it were the first letter of ASTRA.
    letters: Array.from(
      { length: TITLE_PARTS },
      (_, index) =>
        smooth(
          t,
          reducedMotion ? REDUCED_LETTERS[0] : letterStart(index),
          reducedMotion ? REDUCED_LETTERS[1] : letterStart(index) + LETTER_RAMP,
        ) * titleOut,
    ),
    // Title, invitation and credit sit still here — the held beat before the veil opens.
    invitation:
      smooth(t, ...INVITATION_IN) * (1 - smooth(t, ...INVITATION_OUT)),
    credit: smooth(t, ...CREDIT_IN) * (1 - smooth(t, ...CREDIT_OUT)),
    reveal: smooth(t, ...REVEAL),
    camera: reducedMotion ? 1 : smooth(t, REVEAL[0], CAMERA_END),
    chrome: smooth(t, CAMERA_END, BASE_DURATION),
  };
}

// Fades this slow have no single instant. A sound placed where a ramp silently
// begins is heard well before anything shows, so each cue lands where its
// element becomes legible instead.
const ONSET = 0.4;
const APERTURE_ONSET = 0.2;
const onset = (range: readonly [number, number], fraction: number) =>
  range[0] + (range[1] - range[0]) * fraction;

// The same beats as above, in the elapsed milliseconds the player counts, so the
// sound cues cannot drift away from what is on screen when the pacing is retuned.
export function openingCues(reducedMotion = false) {
  const at = (value: number) => value * PACE;
  const aperture = onset(REVEAL, APERTURE_ONSET);
  return {
    // Anchor each note to its own fade start: a visibility offset approaches
    // the next letter's beat because these slow fades overlap.
    // Reduced motion brings the whole title in at once, so it earns one cue, not six.
    letters: reducedMotion
      ? [at(onset(REDUCED_LETTERS, ONSET))]
      : Array.from({ length: TITLE_PARTS }, (_, index) =>
          at(letterStart(index)),
        ),
    invitation: at(onset(INVITATION_IN, ONSET)),
    credit: at(onset(CREDIT_IN, ONSET)),
    // The held beat starts the moment the last of the type settles.
    hold: at(CREDIT_IN[1]),
    holdDuration: at(REVEAL[0] - CREDIT_IN[1]),
    reveal: at(aperture),
    revealDuration: at(REVEAL[1] - aperture),
    // The lens keeps travelling after the veil is fully open.
    flightDuration: at(CAMERA_END - aperture),
  };
}

// A return visit within the hour skips the opening; after that it plays again.
const OPENING_SEEN_TTL = 60 * 60 * 1000;

export function hasSeenOpening() {
  try {
    if (typeof window === 'undefined') return false;
    const seenAt = Number(window.localStorage.getItem(OPENING_STORAGE_KEY));
    // A clock that has run backward must not read as "just seen": bound the
    // age below, not just above.
    const age = Date.now() - seenAt;
    return Number.isFinite(seenAt) && age >= 0 && age < OPENING_SEEN_TTL;
  } catch {
    return false;
  }
}

export function rememberOpening() {
  try {
    window.localStorage.setItem(OPENING_STORAGE_KEY, String(Date.now()));
  } catch {
    /* The sequence still works when browser storage is unavailable. */
  }
}
