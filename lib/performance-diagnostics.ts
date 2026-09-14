/** Local, opt-in capture. Times are CPU/wall times, never GPU estimates. */
export function createDiagnostics(capacity = 3600) {
  if (!Number.isInteger(capacity) || capacity < 1)
    throw new RangeError('Invalid capacity');
  type Sample = { kind: string; at: number; values: Record<string, unknown> };
  const samples: Sample[] = [];
  let count = 0;
  const milestones: Sample[] = [];
  let renderedFrames = 0;
  return {
    record(kind: string, at: number, values: Record<string, unknown>) {
      const sample = { kind, at, values };
      samples[count++ % capacity] = sample;
      if (kind === 'frame') renderedFrames++;
      if (
        ![
          'frame',
          'raf',
          'gpu-frame',
          'gpu-pass',
          'cpu-pass',
          'memory',
          'cpu-phase',
        ].includes(kind)
      ) {
        milestones.push(sample);
        if (milestones.length > 64) milestones.shift();
      }
    },
    snapshot() {
      const length = Math.min(count, capacity);
      return {
        schemaVersion: 1,
        renderedFrames,
        milestones: [...milestones],
        dropped: Math.max(0, count - capacity),
        gpu: {
          completeFrame: 'unavailable',
          note: 'Sky capture timing only; CPU submission is not GPU duration.',
        },
        samples: Array.from(
          { length },
          (_, i) => samples[(Math.max(0, count - capacity) + i) % capacity],
        ),
      };
    },
  };
}
