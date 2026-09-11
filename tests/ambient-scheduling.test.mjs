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

test('pulsar modulation uses one bounded smoothed gain and adds no nodes during updates', () => {
  const { context, nodes } = mockContext();
  const graph = buildAmbientGraph(context);
  const count = nodes.length;
  graph.setProximity(1, 'pulsar');
  graph.setPulse(0);
  const pulseNode = nodes.find((n) => n.gain.events.at(-1)?.value === 0.88);
  assert.ok(pulseNode);
  const initial = pulseNode.gain.events.length;
  for (let i = 0; i < 100; i++) graph.setPulse(0);
  assert.equal(
    pulseNode.gain.events.length,
    initial,
    'paused signal does not grow automation',
  );
  for (const value of [-1, 0.5, 1, 100, NaN]) graph.setPulse(value);
  assert.equal(nodes.length, count);
  for (const event of pulseNode.gain.events) {
    assert.ok(Number.isFinite(event.value));
    assert.ok(event.value >= 0.88 && event.value <= 1);
    assert.equal(event.method, 'target');
  }
  graph.setVolume(0);
  assert.ok(nodes.some((n) => n.gain.events.at(-1)?.value === 0));
  graph.dispose();
});
