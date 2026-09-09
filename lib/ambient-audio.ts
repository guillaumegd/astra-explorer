import type { BodyKind } from './stellar-lod';
import { ambienceMix, soundProfiles } from './ambience-parameters';

// Original slow progression and motif; no recordings or external audio assets.
const CHORDS = [
  [45, 52, 59, 60, 64],
  [41, 48, 55, 57, 60],
  [48, 55, 59, 62, 64],
  [43, 50, 57, 60, 62],
];
const MOTIF = [1, 3, 2, 4, 2, 3, 1, 2];
const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

// Accepts OfflineAudioContext too, so the actual graph can be rendered and verified without speakers.
export function buildAmbientGraph(context: BaseAudioContext) {
  const nodes: AudioNode[] = [];
  const oscillators = new Set<OscillatorNode>();
  let disposed = false;
  const track = <T extends AudioNode>(node: T): T => {
    nodes.push(node);
    return node;
  };
  const master = track(context.createGain());
  master.gain.value = 0;
  const limiter = track(context.createDynamicsCompressor());
  limiter.threshold.value = -15;
  limiter.knee.value = 12;
  limiter.ratio.value = 5;
  limiter.attack.value = 0.012;
  limiter.release.value = 0.4;
  const highpass = track(context.createBiquadFilter());
  highpass.type = 'highpass';
  highpass.frequency.value = 40;
  const filter = track(context.createBiquadFilter());
  filter.type = 'lowpass';
  filter.frequency.value = 600;
  filter.Q.value = 0.4;
  const pads = track(context.createGain());
  pads.gain.value = 0.42;
  const melody = track(context.createGain());
  melody.gain.value = 0.055;
  const dry = track(context.createGain());
  dry.gain.value = 0.8;
  const wet = track(context.createGain());
  wet.gain.value = 0.5;
  const reverb = track(context.createConvolver());
  const impulse = context.createBuffer(
    2,
    Math.ceil(context.sampleRate * 3.8),
    context.sampleRate,
  );
  let seed = 73512;
  for (let channel = 0; channel < 2; channel++) {
    const samples = impulse.getChannelData(channel);
    let smoothNoise = 0;
    for (let i = 0; i < samples.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      smoothNoise = smoothNoise * 0.65 + ((seed / 4294967296) * 2 - 1) * 0.35;
      const t = i / context.sampleRate;
      samples[i] = smoothNoise * Math.exp(-t * 1.45) * Math.min(1, t / 0.04);
    }
  }
  reverb.buffer = impulse;
  pads.connect(filter);
  melody.connect(filter);
  filter.connect(dry);
  filter.connect(reverb);
  reverb.connect(wet);
  dry.connect(highpass);
  wet.connect(highpass);
  highpass.connect(limiter);
  limiter.connect(master);
  master.connect(context.destination);

  // All families run on one shared looping noise buffer. Crossfading gains avoids
  // pitch sweeps when switching bodies and bounds the number of audio nodes.
  const noiseBuffer = context.createBuffer(
    1,
    context.sampleRate * 8,
    context.sampleRate,
  );
  const samples = noiseBuffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    samples[i] = (seed / 4294967296) * 2 - 1;
  }
  const noise = track(context.createBufferSource());
  noise.buffer = noiseBuffer;
  noise.loop = true;
  noise.start();
  const atmospheres = Object.entries(soundProfiles).map(([kind, profile]) => {
    const output = track(context.createGain());
    output.gain.value = 0;
    output.connect(highpass);
    const send = track(context.createGain());
    send.gain.value = 0.25;
    output.connect(send);
    send.connect(reverb);
    const band = track(context.createBiquadFilter());
    band.type = 'bandpass';
    band.frequency.value = profile.band;
    band.Q.value = profile.q;
    const breath = track(context.createGain());
    breath.gain.value = profile.noise * 0.65;
    noise.connect(band);
    band.connect(breath);
    breath.connect(output);
    const lfo = track(context.createOscillator());
    lfo.frequency.value = profile.breath;
    const depth = track(context.createGain());
    depth.gain.value = profile.noise * 0.35;
    lfo.connect(depth);
    depth.connect(breath.gain);
    const drone = track(context.createOscillator());
    drone.frequency.value = profile.drone;
    const tone = track(context.createGain());
    tone.gain.value = profile.tone;
    drone.connect(tone);
    tone.connect(output);
    lfo.start();
    drone.start();
    return { kind, output, lfo, drone, profile };
  });

  const harmonics = context.createPeriodicWave(
    new Float32Array(5),
    new Float32Array([0, 1, 0.16, 0.055, 0.018]),
  );
  const banks = [0, 1].map(() => {
    const envelope = track(context.createGain());
    envelope.gain.value = 0;
    envelope.connect(pads);
    const voices = Array.from({ length: 5 }, (_, note) => {
      const gain = track(context.createGain());
      gain.gain.value = note === 0 ? 0.065 : 0.045;
      gain.connect(envelope);
      return [-2.5, 2.5].map((detune) => {
        const osc = context.createOscillator();
        osc.setPeriodicWave(harmonics);
        osc.detune.value = detune;
        osc.frequency.value = frequency(CHORDS[0][note]);
        osc.connect(gain);
        osc.start();
        oscillators.add(osc);
        return osc;
      });
    });
    return { envelope, voices };
  });
  let bankIndex = 1;
  let chordIndex = 0;
  let proximity = 0;
  let bodyKind: BodyKind | null = null;
  const smooth = (param: AudioParam, value: number, seconds: number) =>
    param.setTargetAtTime(value, context.currentTime, seconds);
  return {
    setVolume(volume: number, seconds = 0.35) {
      smooth(master.gain, Math.min(1, Math.max(0, volume)) * 0.7, seconds);
    },
    setProximity(value: number, kind: BodyKind | null = null) {
      proximity = value;
      bodyKind = kind;
      const mix = ambienceMix(value);
      smooth(filter.frequency, mix.cutoff, 1.5);
      smooth(pads.gain, mix.pad, 1.5);
      smooth(melody.gain, mix.melody, 1.5);
      smooth(wet.gain, mix.wet, 1.5);
      atmospheres.forEach((layer) =>
        smooth(layer.output.gain, layer.kind === kind ? mix.local : 0, 1.2),
      );
    },
    chord(index: number, at: number) {
      chordIndex = index % CHORDS.length;
      const old = banks[bankIndex];
      bankIndex = 1 - bankIndex;
      const next = banks[bankIndex];
      const chord = CHORDS[chordIndex];
      next.voices.forEach((pair, i) =>
        pair.forEach((osc) =>
          osc.frequency.setValueAtTime(frequency(chord[i]), at),
        ),
      );
      old.envelope.gain.setTargetAtTime(0, at, 1.6);
      next.envelope.gain.setTargetAtTime(0.9, at, 1.6);
    },
    chordInterval() {
      return ambienceMix(proximity).chordInterval;
    },
    note(index: number, at: number) {
      if (disposed || oscillators.size >= 36) return;
      const midi = CHORDS[chordIndex][MOTIF[index % MOTIF.length]] + 12;
      const pan = context.createStereoPanner();
      pan.pan.value = Math.sin(index * 1.7) * 0.4;
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(0.18, at + 0.06);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + 4.8);
      const osc = context.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency(midi);
      osc.connect(envelope);
      envelope.connect(pan);
      pan.connect(melody);
      // Sparse crystalline/mineral accents remain audible as the score recedes.
      const layer = atmospheres.find((entry) => entry.kind === bodyKind);
      if (layer) {
        const accent = context.createGain();
        accent.gain.value = layer.profile.sparkle;
        pan.connect(accent);
        accent.connect(layer.output);
        osc.addEventListener('ended', () => accent.disconnect(), {
          once: true,
        });
      }
      oscillators.add(osc);
      osc.start(at);
      osc.stop(at + 5);
      osc.onended = () => {
        oscillators.delete(osc);
        osc.disconnect();
        envelope.disconnect();
        pan.disconnect();
      };
    },
    interval() {
      return ambienceMix(proximity).noteInterval;
    },
    dispose() {
      disposed = true;
      noise.stop();
      noise.buffer = null;
      atmospheres.forEach(({ lfo, drone }) => {
        lfo.stop();
        drone.stop();
      });
      oscillators.forEach((osc) => {
        osc.stop();
        osc.disconnect();
      });
      oscillators.clear();
      nodes.forEach((node) => node.disconnect());
      reverb.buffer = null;
    },
  };
}

export type AmbientSoundtrack = ReturnType<typeof createAmbientSoundtrack>;
export function createAmbientSoundtrack(onFailure: () => void) {
  let context: AudioContext | null = null;
  let graph: ReturnType<typeof buildAmbientGraph> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let muteTimer: ReturnType<typeof setTimeout> | null = null;
  let enabled = false,
    disposed = false,
    volume = 0.35,
    proximity = 0;
  let bodyKind: BodyKind | null = null;
  let nextChord = 0,
    nextNote = 0,
    chord = 0,
    note = 0,
    request = 0;
  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const clearMute = () => {
    if (muteTimer) clearTimeout(muteTimer);
    muteTimer = null;
  };
  const tick = () => {
    if (!context || !graph || context.state !== 'running' || !enabled) return;
    const now = context.currentTime;
    if (now + 0.15 >= nextChord) {
      graph.chord(chord++, Math.max(now, nextChord));
      nextChord = now + graph.chordInterval();
    }
    if (now + 0.15 >= nextNote) {
      graph.note(note++, Math.max(now, nextNote));
      nextNote = now + graph.interval();
    }
  };
  const startTimer = () => {
    stopTimer();
    tick();
    timer = setInterval(tick, 150);
  };
  const fail = () => {
    if (disposed) return;
    enabled = false;
    stopTimer();
    void context?.suspend().catch(() => {});
    onFailure();
  };
  return {
    async setEnabled(value: boolean) {
      if (disposed) return false;
      const version = ++request;
      enabled = value;
      clearMute();
      if (!value) {
        stopTimer();
        graph?.setVolume(0);
        muteTimer = setTimeout(() => {
          if (!enabled && !disposed) void context?.suspend().catch(() => {});
        }, 900);
        return false;
      }
      try {
        // Called directly from the user's click, before any await, for browser autoplay policies.
        if (!context) {
          context = new AudioContext({ latencyHint: 'playback' });
          graph = buildAmbientGraph(context);
          nextChord = context.currentTime;
          nextNote = context.currentTime + 1;
        }
        await context.resume();
        if (disposed || version !== request || !enabled) return false;
        graph!.setProximity(proximity, bodyKind);
        graph!.setVolume(volume);
        startTimer();
        return true;
      } catch (e) {
        // Autoplay blocked pending a user gesture: stay silent, don't report a failure.
        if (e instanceof DOMException && e.name === 'NotAllowedError') {
          enabled = false;
          stopTimer();
          return false;
        }
        fail();
        return false;
      }
    },
    setVolume(value: number, seconds?: number) {
      volume = Math.min(1, Math.max(0, value));
      if (enabled) graph?.setVolume(volume, seconds);
    },
    setProximity(value: number, kind: BodyKind | null = null) {
      value = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
      if (Math.abs(value - proximity) < 0.01 && kind === bodyKind) return;
      proximity = value;
      bodyKind = kind;
      if (enabled) graph?.setProximity(value, kind);
    },
    dispose() {
      disposed = true;
      enabled = false;
      request++;
      stopTimer();
      clearMute();
      graph?.dispose();
      void context?.close().catch(() => {});
      graph = null;
      context = null;
    },
  };
}
