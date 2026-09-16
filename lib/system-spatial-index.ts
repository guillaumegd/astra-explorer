/**
 * Incremental index over system anchors.  It deliberately indexes systems,
 * rather than individual particles: a system's conservative envelope keeps
 * orbital members discoverable without rebuilding the index every frame.
 */
export type IndexedSystem = {
  rootId: number;
  bodies: { id: number }[];
  anchor: readonly [number, number, number];
  envelope: number;
};

type Entry = IndexedSystem;

export function createSystemSpatialIndex(cellSize = 0.75) {
  if (!Number.isFinite(cellSize) || cellSize <= 0)
    throw new RangeError('cellSize must be positive');
  const cells = new Map<string, Entry[]>();
  const seen = new Set<number>();
  let indexed = 0;
  const scratch: IndexedSystem[] = [];
  const key = (x: number, y: number, z: number) => `${x}:${y}:${z}`;
  const cell = (value: number) => Math.floor(value / cellSize);
  const add = (system: IndexedSystem) => {
    const [x, y, z] = system.anchor;
    const reach = Math.max(0, system.envelope);
    const minX = cell(x - reach),
      maxX = cell(x + reach);
    const minY = cell(y - reach),
      maxY = cell(y + reach);
    const minZ = cell(z - reach),
      maxZ = cell(z + reach);
    for (let ix = minX; ix <= maxX; ix++)
      for (let iy = minY; iy <= maxY; iy++)
        for (let iz = minZ; iz <= maxZ; iz++) {
          const id = key(ix, iy, iz);
          const bucket = cells.get(id);
          if (bucket) bucket.push(system);
          else cells.set(id, [system]);
        }
  };
  /**
   * Systems whose conservative bounds intersect a sphere. `out` is
   * caller-owned to avoid allocations in the frame loop.
   */
  const systemsNear = (
    x: number,
    y: number,
    z: number,
    reach: number,
    out: IndexedSystem[],
  ) => {
    out.length = 0;
    seen.clear();
    const minX = cell(x - reach),
      maxX = cell(x + reach);
    const minY = cell(y - reach),
      maxY = cell(y + reach);
    const minZ = cell(z - reach),
      maxZ = cell(z + reach);
    for (let ix = minX; ix <= maxX; ix++)
      for (let iy = minY; iy <= maxY; iy++)
        for (let iz = minZ; iz <= maxZ; iz++)
          for (const system of cells.get(key(ix, iy, iz)) ?? []) {
            if (seen.has(system.rootId)) continue;
            const [sx, sy, sz] = system.anchor;
            if (
              Math.hypot(x - sx, y - sy, z - sz) >
              reach + system.envelope
            )
              continue;
            seen.add(system.rootId);
            out.push(system);
          }
    return out;
  };
  return {
    /** Systems are append-only in the runtime catalogue, so synchronisation is O(new systems). */
    sync(systems: readonly IndexedSystem[]) {
      while (indexed < systems.length) add(systems[indexed++]);
    },
    systemsNear,
    /** Appends body IDs of the systems returned by `systemsNear`. */
    near(
      x: number,
      y: number,
      z: number,
      reach: number,
      bodyLimit: number,
      out: number[],
    ) {
      out.length = 0;
      for (const system of systemsNear(x, y, z, reach, scratch))
        for (const body of system.bodies)
          if (body.id < bodyLimit) out.push(body.id);
      return out;
    },
    stats() {
      return { systems: indexed, cells: cells.size };
    },
  };
}
