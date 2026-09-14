export type PassProbe = {
  measure<T>(name: string, work: () => T, onGpu?: (ms: number) => void): T;
};
type Emit = (kind: string, at: number, values: Record<string, unknown>) => void;
/** Non-overlapping elapsed queries, bounded queue, no blocking readback. */
export function createGpuDiagnostics(gl: WebGL2RenderingContext, emit: Emit) {
  let extension = gl.getExtension('EXT_disjoint_timer_query_webgl2') as {
    TIME_ELAPSED_EXT: number;
    GPU_DISJOINT_EXT: number;
  } | null;
  type Frame = {
    id: number;
    expected: number;
    resolved: number;
    valid: boolean;
    totalMs: number;
    sealed: boolean;
  };
  let current: Frame | null = null;
  const frames: Frame[] = [];
  const pending: {
    query: WebGLQuery;
    frame: Frame | null;
    name: string;
    at: number;
    onGpu?: (ms: number) => void;
  }[] = [];
  const flush = () => {
    for (let i = frames.length - 1; i >= 0; i--) {
      const frame = frames[i];
      if (frame.sealed && frame.resolved === frame.expected) {
        emit('gpu-frame', performance.now(), {
          frameId: frame.id,
          complete: frame.valid,
          gpuMs: frame.valid ? frame.totalMs : null,
          passes: frame.expected,
        });
        frames.splice(i, 1);
      }
    }
  };
  const discard = (reason: string) => {
    for (const entry of pending) {
      gl.deleteQuery(entry.query);
      if (entry.frame) {
        entry.frame.valid = false;
        entry.frame.resolved++;
      }
      emit('gpu-pass', entry.at, {
        frameId: entry.frame?.id ?? null,
        pass: entry.name,
        gpuMs: null,
        reason,
      });
    }
    pending.length = 0;
    flush();
  };
  return {
    status: () => ({
      available: !!extension,
      source: 'EXT_disjoint_timer_query_webgl2',
      pending: pending.length,
      completeFrame:
        'See gpu-frame.complete; sum of non-overlapping passes, not presentation latency',
    }),
    startFrame(id: number) {
      current = {
        id,
        expected: 0,
        resolved: 0,
        valid: !!extension,
        totalMs: 0,
        sealed: false,
      };
      frames.push(current);
    },
    endFrame() {
      if (current) current.sealed = true;
      current = null;
      flush();
    },
    measure<T>(name: string, work: () => T, onGpu?: (ms: number) => void): T {
      const frame = current;
      if (frame) frame.expected++;
      const at = performance.now();
      const canQuery =
        extension &&
        !gl.isContextLost() &&
        pending.length < 64 &&
        !gl.getParameter(extension.GPU_DISJOINT_EXT) &&
        !gl.getQuery(extension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY);
      const query = canQuery ? gl.createQuery() : null;
      if (query && extension) gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      try {
        return work();
      } finally {
        emit('cpu-pass', at, {
          frameId: frame?.id ?? null,
          pass: name,
          cpuMs: performance.now() - at,
        });
        if (query && extension) {
          gl.endQuery(extension.TIME_ELAPSED_EXT);
          pending.push({ query, frame, name, at, onGpu });
        } else {
          if (frame) {
            frame.valid = false;
            frame.resolved++;
          }
          emit('gpu-pass', at, {
            frameId: frame?.id ?? null,
            pass: name,
            gpuMs: null,
            reason: extension
              ? 'busy, disjoint, lost context or queue full'
              : 'extension unavailable',
          });
        }
      }
    },
    poll() {
      if (!extension) return;
      if (gl.isContextLost() || gl.getParameter(extension.GPU_DISJOINT_EXT)) {
        discard('disjoint or context lost');
        return;
      }
      while (
        pending.length &&
        gl.getQueryParameter(pending[0].query, gl.QUERY_RESULT_AVAILABLE)
      ) {
        const entry = pending.shift()!;
        const ms = gl.getQueryParameter(entry.query, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(entry.query);
        const valid = Number.isFinite(ms) && ms >= 0;
        if (entry.frame) {
          entry.frame.resolved++;
          entry.frame.valid &&= valid;
          if (valid) entry.frame.totalMs += ms;
        }
        emit('gpu-pass', entry.at, {
          frameId: entry.frame?.id ?? null,
          pass: entry.name,
          gpuMs: valid ? ms : null,
        });
        if (valid) entry.onGpu?.(ms);
      }
      flush();
    },
    reset() {
      discard('context reset');
      extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    },
    dispose() {
      discard('disposed');
      frames.length = 0;
      current = null;
    },
  };
}
