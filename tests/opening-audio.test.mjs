import assert from 'node:assert/strict';
const { createOpeningAudio } = await import(
  process.cwd() + '/lib/opening-audio.ts'
);
const params = () => ({
  value: 0,
  cancelScheduledValues() {},
  setValueAtTime(v) {
    this.value = v;
  },
  linearRampToValueAtTime(v) {
    this.value = v;
  },
  exponentialRampToValueAtTime() {},
});
const sources = [];
let closed = 0;
const gains = [];
const node = () => ({
  connect() {},
  disconnect() {},
  gain: params(),
  frequency: params(),
  Q: params(),
  pan: params(),
  detune: params(),
});
class Context {
  currentTime = 0;
  sampleRate = 1000;
  destination = node();
  resume() {
    return Promise.resolve();
  }
  suspend() {
    return Promise.resolve();
  }
  close() {
    closed++;
    return Promise.resolve();
  }
  createGain() {
    const n = node();
    gains.push(n);
    return n;
  }
  createConvolver() {
    return node();
  }
  createBiquadFilter() {
    return node();
  }
  createStereoPanner() {
    return node();
  }
  createDynamicsCompressor() {
    return {
      ...node(),
      threshold: params(),
      knee: params(),
      ratio: params(),
      attack: params(),
      release: params(),
    };
  }
  createBuffer(channels, length) {
    const data = Array.from(
      { length: channels },
      () => new Float32Array(length),
    );
    return { getChannelData: (i) => data[i] };
  }
  source() {
    const n = {
      ...node(),
      start() {},
      stop(at) {
        n.ends = at;
      },
    };
    sources.push(n);
    return n;
  }
  createBufferSource() {
    return this.source();
  }
  createOscillator() {
    return this.source();
  }
}
globalThis.window = { AudioContext: Context };
const sound = createOpeningAudio();
for (let i = 0; i < 6; i++) sound.tick(i);
sound.breath('invitation');
sound.breath('credit');
sound.drone(1800);
sound.shimmer(2400);
sound.flight(4000);
assert.equal(sources.length, 46);
assert.ok(
  sources.every(
    (s) =>
      (Number.isFinite(s.ends) && typeof s.onended === 'function') ||
      Number.isFinite(s.ends),
  ),
);
sound.setMuted(true);
assert.equal(gains[0].gain.value, 0);
sound.setMuted(false);
assert.equal(gains[0].gain.value, 0.9);
sound.dispose();
sound.dispose();
assert.equal(closed, 1);
console.log({
  sources: sources.length,
  finiteStops: sources.filter((s) => Number.isFinite(s.ends)).length,
  contextCloseCalls: closed,
});
class Broken extends Context {
  createGain() {
    throw new Error('injected graph construction failure');
  }
}
globalThis.window.AudioContext = Broken;
let graphFailure;
try {
  createOpeningAudio();
} catch (e) {
  graphFailure = e.message;
}
assert.equal(graphFailure, undefined);
assert.equal(closed, 2);
console.log({ graphFailureEscapesFactory: graphFailure });
