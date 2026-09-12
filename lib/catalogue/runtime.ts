import { CATALOGUE_SEED, MAX_BODIES } from './config.ts';
import { generateSystem } from './generate.ts';
import { listNebulae, remnantFor } from './regions.ts';
import type {
  BodyIdentity,
  RegionDefinition,
  SystemDefinition,
} from './types.ts';

export class RuntimeCatalogue {
  readonly bodies: BodyIdentity[] = [];
  readonly systems: SystemDefinition[] = [];
  private readonly byId = new Map<string, BodyIdentity>();
  // Both lists scan every system, and the panels read them on each render.
  private destinations = new Map<
    'phenomena' | 'binaries',
    { count: number; list: BodyIdentity[] }
  >();
  // Nebulae come from a fixed spatial partition, so density never changes them
  // and this list is memoised once, with no key to invalidate.
  private nebulae: RegionDefinition[] | null = null;
  private remnants: { count: number; list: RegionDefinition[] } | null = null;
  readonly seed: number;
  constructor(seed = CATALOGUE_SEED) {
    this.seed = seed;
  }
  ensure(target: number) {
    if (!Number.isFinite(target) || target < 0 || target > MAX_BODIES)
      throw new RangeError('Invalid catalogue budget');
    while (this.bodies.length < target) {
      const system = generateSystem(
        this.systems.length,
        this.bodies.length,
        this.seed,
      );
      this.systems.push(system);
      for (const body of system.bodies) {
        this.bodies.push(body);
        this.byId.set(body.bodyId, body);
      }
    }
  }
  getBody(index: number): BodyIdentity {
    if (!Number.isInteger(index) || index < 0 || index >= MAX_BODIES)
      throw new RangeError('Invalid particle index');
    this.ensure(index + 1);
    return this.bodies[index];
  }
  resolveReference(bodyId: string): BodyIdentity | null {
    // Old compact indices and V1 references are deliberately never interpreted as V2.
    if (!/^v2:system:\d{6}:body:\d{3}$/.test(bodyId)) return null;
    this.ensure(MAX_BODIES);
    return this.byId.get(bodyId) ?? null;
  }
  getSystem(index: number): SystemDefinition {
    if (!Number.isInteger(index) || index < 0)
      throw new RangeError('Invalid system index');
    while (this.systems.length <= index && this.bodies.length < MAX_BODIES)
      this.ensure(Math.min(MAX_BODIES, this.bodies.length + 1));
    if (!this.systems[index]) throw new RangeError('Unknown system');
    return this.systems[index];
  }
  getSystemMembers(index: number) {
    return this.getSystem(index).bodies;
  }
  activeCount(budget: number) {
    const target = Math.max(0, Math.min(MAX_BODIES, Math.floor(budget)));
    this.ensure(target);
    let low = 0,
      high = this.systems.length;
    while (low < high) {
      const mid = (low + high) >>> 1,
        system = this.systems[mid];
      if (system.rootId + system.bodies.length <= target) low = mid + 1;
      else high = mid;
    }
    return low
      ? this.systems[low - 1].rootId + this.systems[low - 1].bodies.length
      : 0;
  }
  private listDestinations(
    key: 'phenomena' | 'binaries',
    budget: number,
    match: (system: SystemDefinition) => boolean,
  ) {
    const count = this.activeCount(budget);
    const cached = this.destinations.get(key);
    if (cached?.count === count) return cached.list;
    const list = this.systems
      .filter((system) => system.rootId < count && match(system))
      .map((system) => system.bodies[0]);
    this.destinations.set(key, { count, list });
    return list;
  }
  getPhenomena(budget: number) {
    return this.listDestinations(
      'phenomena',
      budget,
      (system) => system.bodies[0].capabilities.renderClass !== 'ordinary',
    );
  }
  /** Primary components only; the companion is reached from the system card. */
  getBinaries(budget: number) {
    return this.listDestinations(
      'binaries',
      budget,
      (system) => system.architecture === 'binary',
    );
  }
  listNebulae() {
    if (!this.nebulae) this.nebulae = listNebulae(this.seed);
    return this.nebulae;
  }
  /** Remnants live and die with their pulsar host, so they follow the budget. */
  getRemnants(budget: number) {
    const count = this.activeCount(budget);
    if (this.remnants?.count === count) return this.remnants.list;
    const list: RegionDefinition[] = [];
    for (const system of this.systems) {
      if (system.rootId >= count) break;
      const remnant = remnantFor(system);
      if (remnant) list.push(remnant);
    }
    this.remnants = { count, list };
    return list;
  }
  resolveRegion(regionId: string, budget: number): RegionDefinition | null {
    return (
      this.listNebulae().find((r) => r.regionId === regionId) ??
      this.getRemnants(budget).find((r) => r.regionId === regionId) ??
      null
    );
  }
  /**
   * Base-space query: shear the camera back before calling. Both lists are
   * bounded to a few dozen entries by construction, so a linear sweep beats
   * windowing the grid and allocates nothing when given an output array.
   */
  regionsNear(
    x: number,
    y: number,
    z: number,
    reach: number,
    budget: number,
    out: RegionDefinition[] = [],
  ) {
    out.length = 0;
    for (const list of [this.listNebulae(), this.getRemnants(budget)])
      for (const region of list) {
        const c = region.center;
        if (Math.hypot(x - c[0], y - c[1], z - c[2]) <= region.envelope + reach)
          out.push(region);
      }
    return out;
  }
  resolvePick(index: number, budget: number) {
    return Number.isInteger(index) &&
      index >= 0 &&
      index < this.activeCount(budget)
      ? this.bodies[index]
      : null;
  }
}
/** Shared by React, the scene, CPU motion and the renderer. */
export const catalogue = new RuntimeCatalogue();
export const describeBody = (id: number) => catalogue.getBody(id);
