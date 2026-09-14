/**
 * JSON.stringify replacer for catalogue fingerprints. V8 takes pow, log and the
 * trigonometric functions from the platform maths library, so the last bit of
 * an anchor or a radius differs between macOS, Linux arm64 and Linux x64. Ten
 * significant digits are far below anything visible, and toPrecision is exact
 * decimal formatting, identical everywhere.
 */
export const portableNumbers = (_key, value) =>
  typeof value === 'number' ? Number(value.toPrecision(10)) : value;
