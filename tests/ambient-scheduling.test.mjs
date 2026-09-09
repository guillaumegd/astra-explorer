import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAmbientGraph } from '../lib/ambient-audio.ts';

function mockContext() {
  const nodes = [];
  const parameter = () => ({
    value: 0,
    events: [],
    setValueAtTime(value, at) {
      this.events.push({ method: 'set', value, at });
    },
    setTargetAtTime(value, at) {
      this.events.push({ method: 'target', value, at });
    },
    linearRampToValueAtTime(value, at) {
      this.events.push({ method: 'linear', value, at });
    },
    exponentialRampToValueAtTime(value, at) {
      this.events.push({ method: 'exponential', value, at });
    },
  });
  const node = () => {
    const result = {
      connect() {},
      disconnect() {},
      setPeriodicWave() {},
      addEventListener() {},
      start(at = 0) {
        this.started = at;
      },
      stop(at) {
        this.stopped = at;
      },
    };
    for (const name of [
      'gain',
      'frequency',
      'detune',
      'pan',
      'Q',
      'threshold',
      'knee',
      'ratio',
      'attack',
      'release',
    ])
      result[name] = parameter();
    nodes.push(result);
    return result;
  };
  const context = {
    currentTime: 100,
    sampleRate: 1000,
    destination: node(),
    createGain: node,
    createDynamicsCompressor: node,
    createBiquadFilter: node,
    createConvolver: node,
    createBufferSource: node,
    createOscillator: node,
    createStereoPanner: node,
    createPeriodicWave() {},
    createBuffer(channels, length) {
      const data = Array.from(
        { length: channels },
        () => new Float32Array(length),
      );
      return { getChannelData: (i) => data[i] };
    },
  };
  return { context, nodes };
}

test('a delayed ambient note retains its full attack and reaches zero before stopping', () => {
  const { context, nodes } = mockContext();
  const graph = buildAmbientGraph(context);
  const count = nodes.length;
  graph.note(0, 99);
  const created = nodes.slice(count);
  const oscillator = created.find((n) => n.started !== undefined);
  const envelope = created.find((n) => n.gain.events.length);
  assert.equal(oscillator.started, 100.08);
  assert.deepEqual(envelope.gain.events[0], {
    method: 'set',
    value: 0,
    at: oscillator.started,
  });
  const end = envelope.gain.events.at(-1);
  assert.equal(end.value, 0);
  assert.ok(end.at < oscillator.stopped);
  graph.dispose();
});

test('an ambient note already scheduled ahead keeps its intended musical timing', () => {
  const { context, nodes } = mockContext();
  const graph = buildAmbientGraph(context);
  const count = nodes.length;
  graph.note(0, 101);
  assert.equal(
    nodes.slice(count).find((n) => n.started !== undefined).started,
    101,
  );
  graph.dispose();
});
