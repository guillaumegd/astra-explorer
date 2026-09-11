/** Per-frame sky capture with measured, hysteretic resolution adaptation.
 * GPU queries are asynchronous; CPU submission is an explicitly labelled fallback. */
export function createCaptureBudget() {
  let costMs = 0,
    capturedTime = NaN;
  let captures = 0;
  let resolution = 512,
    expensive = 0,
    cheap = 0;
  let gl: WebGL2RenderingContext | null = null;
  let extension: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null =
    null;
  let checked = false,
    gpuMeasured = false;
  const pending: WebGLQuery[] = [];
  const adapt = () => {
    expensive = costMs > 3 ? expensive + 1 : 0;
    cheap = costMs < 0.6 ? cheap + 1 : 0;
    if (resolution === 512 && expensive >= 8) {
      resolution = 256;
      expensive = cheap = 0;
    } else if (resolution === 256 && cheap >= 180) {
      resolution = 512;
      expensive = cheap = 0;
    }
  };
  const sample = (ms: number) => {
    if (Number.isFinite(ms) && ms >= 0) {
      costMs += (ms - costMs) * 0.2;
      adapt();
    }
  };
  return {
    poll(context?: WebGLRenderingContext | WebGL2RenderingContext) {
      if (!checked && context) {
        checked = true;
        if ('createQuery' in context) {
          gl = context;
          extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
        }
      }
      if (!gl || !extension) return;
      if (gl.getParameter(extension.GPU_DISJOINT_EXT)) {
        for (const query of pending) gl.deleteQuery(query);
        pending.length = 0;
        gpuMeasured = false;
        return;
      }
      while (
        pending.length &&
        gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)
      ) {
        const query = pending.shift()!;
        const milliseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
        if (!gpuMeasured) {
          costMs = milliseconds;
          adapt();
        } else sample(milliseconds);
        gpuMeasured = true;
        gl.deleteQuery(query);
      }
    },
    // A moving sky is updated on every rendered frame. Adapt spatial quality,
    // never hold successive images at a lower cadence than the rest of the scene.
    due(
      _wallTime: number,
      simulationTime: number,
      force = false,
      dirty = false,
    ) {
      return force || dirty || simulationTime !== capturedTime;
    },
    begin() {
      if (
        !gl ||
        !extension ||
        pending.length >= 3 ||
        gl.getQuery(extension.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)
      )
        return null;
      const query = gl.createQuery();
      if (query) gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      return query;
    },
    end(
      query: WebGLQuery | null,
      wallTime: number,
      simulationTime: number,
      cpuMs: number,
    ) {
      if (query && gl && extension) {
        gl.endQuery(extension.TIME_ELAPSED_EXT);
        pending.push(query);
      }
      if (!gpuMeasured) sample(cpuMs);
      captures++;
      void wallTime;
      capturedTime = simulationTime;
    },
    stats() {
      return {
        costMs,
        source: gpuMeasured ? 'gpu' : 'cpu',
        pending: pending.length,
        resolution,
        captures,
      };
    },
    reset() {
      if (gl) for (const query of pending) gl.deleteQuery(query);
      pending.length = 0;
      gl = null;
      extension = null;
      checked = false;
      costMs = 0;
      captures = 0;
      resolution = 512;
      expensive = cheap = 0;
      capturedTime = NaN;
      gpuMeasured = false;
    },
  };
}
