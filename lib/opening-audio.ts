// One-shots for the opening, synthesized like the ambient soundtrack: no
// recordings, so nothing has to be fetched before the curtain lifts.
const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
// Rising minor pentatonic, one note per part of the title, in the same tonal
// world as the chords the ambience cycles through.
const TITLE_MOTIF = [69, 72, 76, 79, 81, 84];
const SPARKLE_NOTES = [84, 88, 91, 93, 96];

export type OpeningAudio = {
  tick: (index: number) => void;
  breath: (kind: 'invitation' | 'credit') => void;
  drone: (durationMs: number) => void;
  shimmer: (durationMs: number) => void;
  flight: (durationMs: number) => void;
  setMuted: (muted: boolean) => void;
  setAwake: (awake: boolean) => void;
  dispose: () => void;
};

// Returns null when the browser has no Web Audio, or when anything below
// fails partway through — the visual opening must never depend on this
// succeeding. Building the graph itself, not just opening the context, is
// wrapped: a failure in createGain/createBuffer must not stop begin() from
// starting the sequence.
export function createOpeningAudio(): OpeningAudio | null {
  const Constructor =
    typeof window === 'undefined' ? undefined : window.AudioContext;
  if (!Constructor) return null;
  let context: AudioContext | undefined;
  try {
    context = new Constructor();
    return build(context);
  } catch {
    void context?.close().catch(() => {
      /* Best effort: nothing left to release if this also fails. */
    });
    return null;
  }
}

function build(context: AudioContext): OpeningAudio {
  void context.resume().catch(() => {
    /* Blocked by the autoplay policy; the opening simply plays silently. */
  });

  // Same deterministic generator the ambient graph uses, so every play sounds alike.
  let seed = 20260909;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const master = context.createGain();
  master.gain.value = 0.9;
  master.connect(context.destination);
  // Catches the star rain, where a couple of dozen voices can overlap.
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -14;
  limiter.knee.value = 10;
  limiter.ratio.value = 6;
  limiter.attack.value = 0.008;
  limiter.release.value = 0.3;
  limiter.connect(master);
  const reverb = context.createConvolver();
  const impulse = context.createBuffer(
    2,
    Math.ceil(context.sampleRate * 2.6),
    context.sampleRate,
  );
  for (let channel = 0; channel < 2; channel++) {
    const samples = impulse.getChannelData(channel);
    let smoothed = 0;
    for (let i = 0; i < samples.length; i++) {
      smoothed = smoothed * 0.6 + (random() * 2 - 1) * 0.4;
      const seconds = i / context.sampleRate;
      samples[i] =
        smoothed * Math.exp(-seconds * 2.1) * Math.min(1, seconds / 0.03);
    }
  }
  reverb.buffer = impulse;
  const wet = context.createGain();
  wet.gain.value = 0.45;
  reverb.connect(wet);
  wet.connect(limiter);
  // Every voice lands on this bus, so one reverb serves the whole sequence.
  const bus = context.createGain();
  bus.connect(limiter);
  bus.connect(reverb);

  const noiseBuffer = context.createBuffer(
    1,
    context.sampleRate * 3,
    context.sampleRate,
  );
  const noiseSamples = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseSamples.length; i++)
    noiseSamples[i] = random() * 2 - 1;

  // Voices tear their own nodes down once the tail has rung out.
  const release = (source: AudioScheduledSourceNode, nodes: AudioNode[]) => {
    source.onended = () => nodes.forEach((node) => node.disconnect());
  };

  let disposed = false;

  return {
    setMuted(muted) {
      if (disposed) return;
      const now = context.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(muted ? 0 : 0.9, now + 0.025);
    },
    tick(index) {
      if (disposed) return;
      const now = context.currentTime;
      const midi = TITLE_MOTIF[Math.min(index, TITLE_MOTIF.length - 1)];
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.125, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
      gain.connect(bus);
      const tone = context.createOscillator();
      tone.type = 'sine';
      tone.frequency.value = frequency(midi);
      tone.connect(gain);
      const air = context.createOscillator();
      air.type = 'triangle';
      air.frequency.value = frequency(midi + 12);
      const airLevel = context.createGain();
      airLevel.gain.value = 0.22;
      air.connect(airLevel);
      airLevel.connect(gain);
      const end = now + 1.6;
      tone.start(now);
      tone.stop(end);
      air.start(now);
      air.stop(end);
      release(tone, [tone, air, airLevel, gain]);
    },

    // Selected audition 3: the original two pure notes, without noise.
    breath(kind) {
      if (disposed) return;
      const now = context.currentTime;
      const credit = kind === 'credit';
      const duration = credit ? 2.2 : 3.2;
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0, now);
      envelope.gain.linearRampToValueAtTime(
        credit ? 0.065 : 0.085,
        now + duration * 0.42,
      );
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      envelope.connect(bus);
      let remaining = 2;
      for (const midi of credit ? [69, 76] : [45, 52]) {
        const tone = context.createOscillator();
        const level = context.createGain();
        level.gain.value = 0.3;
        tone.type = 'sine';
        tone.frequency.value = frequency(midi);
        tone.connect(level);
        level.connect(envelope);
        tone.start(now);
        tone.stop(now + duration + 0.1);
        tone.onended = () => {
          tone.disconnect();
          level.disconnect();
          if (--remaining === 0) envelope.disconnect();
        };
      }
    },

    drone(durationMs) {
      if (disposed) return;
      const now = context.currentTime;
      const span = durationMs / 1000;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.2, now + span * 0.9);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + span + 1.4);
      const warmth = context.createBiquadFilter();
      warmth.type = 'lowpass';
      warmth.frequency.value = 420;
      gain.connect(warmth);
      warmth.connect(bus);
      const end = now + span + 1.5;
      // 55 Hz alone is felt on headphones but lost on laptop speakers, so the
      // octave above carries the weight and the fifth adds the tension.
      const voices: [number, OscillatorType, number, number][] = [
        [33, 'sine', 0.9, -3],
        [45, 'sine', 1, 3],
        [52, 'triangle', 0.3, -6],
      ];
      const nodes: AudioNode[] = [gain, warmth];
      let first: OscillatorNode | null = null;
      for (const [midi, type, level, detune] of voices) {
        const osc = context.createOscillator();
        osc.type = type;
        osc.frequency.value = frequency(midi);
        // A few cents apart, so the voices drift in and out of phase as it holds.
        osc.detune.value = detune;
        const output = context.createGain();
        output.gain.value = level;
        osc.connect(output);
        output.connect(gain);
        osc.start(now);
        osc.stop(end);
        nodes.push(osc, output);
        first ??= osc;
      }
      release(first!, nodes);
    },

    shimmer(durationMs) {
      if (disposed) return;
      const now = context.currentTime;
      const span = durationMs / 1000;
      const count = 26;
      for (let i = 0; i < count; i++) {
        // Dense as the aperture opens, thinning out as the galaxy settles.
        const at = now + (i / count) ** 1.4 * span;
        const midi =
          SPARKLE_NOTES[Math.floor(random() * SPARKLE_NOTES.length)] +
          (random() < 0.3 ? 12 : 0);
        const osc = context.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = frequency(midi);
        const gain = context.createGain();
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.05 + random() * 0.035, at + 0.012);
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          at + 0.9 + random() * 0.7,
        );
        const pan = context.createStereoPanner();
        pan.pan.value = random() * 1.6 - 0.8;
        osc.connect(gain);
        gain.connect(pan);
        pan.connect(bus);
        osc.start(at);
        osc.stop(at + 1.8);
        release(osc, [osc, gain, pan]);
      }
    },

    flight(durationMs) {
      if (disposed) return;
      const now = context.currentTime;
      const span = durationMs / 1000;
      const source = context.createBufferSource();
      source.buffer = noiseBuffer;
      source.loop = true;
      // A band climbing out of the low mids reads as travel without a pitch of
      // its own, so it sits under the star rain instead of competing with it.
      const band = context.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 1.5;
      band.frequency.setValueAtTime(170, now);
      band.frequency.exponentialRampToValueAtTime(2400, now + span * 0.92);
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.075, now + span * 0.85);
      // Lets go as the camera settles, so the arrival lands in the clear.
      gain.gain.exponentialRampToValueAtTime(0.0001, now + span + 0.5);
      source.connect(band);
      band.connect(gain);
      gain.connect(bus);
      const end = now + span + 0.6;
      source.start(now);
      source.stop(end);
      release(source, [source, band, gain]);
    },

    // The sequence freezes while the tab is away, so its clock freezes with it
    // and every scheduled voice picks up where it left off.
    setAwake(awake) {
      if (disposed) return;
      const change = awake ? context.resume() : context.suspend();
      void change.catch(() => {
        /* Nothing to hold onto if the browser already parked the context. */
      });
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      void context.close().catch(() => {
        /* Already closed by the browser; nothing left to release. */
      });
    },
  };
}
