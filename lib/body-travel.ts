/** Retreat, transfer at cruise distance, then approach the tracked destination.
 * Logarithmic distances keep the approach smooth across astronomical scales. */
export function sampleBodyTravel(t: number, start: number, cruise: number, end: number) {
  const smooth = (x: number) => {
    x = Math.max(0, Math.min(1, x));
    return x * x * x * (x * (x * 6 - 15) + 10);
  };
  const transfer = smooth((t - 0.25) / 0.2);
  const approach = smooth((t - 0.45) / 0.55);
  const logMix = (a: number, b: number, k: number) =>
    Math.exp(Math.log(a) * (1 - k) + Math.log(b) * k);
  return {
    progress: transfer,
    distance: t < 0.25
      ? logMix(start, cruise, smooth(t / 0.25))
      : logMix(cruise, end, approach),
  };
}
