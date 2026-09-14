export type ReferenceScene = {
  name: string;
  density: number;
  bodyId?: string;
  regionId?: string;
  distanceRatio: number;
  elevation: number;
  azimuth: number;
};
const body = (
  name: string,
  bodyId: string,
  distanceRatio = 1.08,
): ReferenceScene => ({
  name,
  bodyId,
  density: 65000,
  distanceRatio,
  elevation: 0.35,
  azimuth: 0.6,
});
export const REFERENCE_SCENES: ReferenceScene[] = [
  ...[10000, 65000, 120000].map((density) => ({
    name: `galaxy-${density}`,
    density,
    distanceRatio: 29.4,
    elevation: 0.62,
    azimuth: 0,
  })),
  body('rocky-ground', 'v2:system:000007:body:002'),
  body('ocean', 'v2:system:000001:body:006'),
  body('gas', 'v2:system:000001:body:004', 2.2),
  body('moon', 'v2:system:000001:body:002'),
  body('asteroid', 'v2:system:000001:body:011', 1.6),
  body('volcano', 'v2:system:000002:body:003'),
  body('ice', 'v2:system:000001:body:001'),
  ...[0.08, 0.8].flatMap((elevation) =>
    [50, 180].map((distanceRatio) => ({
      ...body(
        `black-hole-${elevation}-${distanceRatio}`,
        'v2:system:000000:body:000',
        distanceRatio,
      ),
      elevation,
    })),
  ),
  {
    name: 'nebula-crossing',
    density: 65000,
    regionId: 'v2:region:nebula:000004',
    distanceRatio: 0.5,
    elevation: 0.2,
    azimuth: 0.6,
  },
  {
    name: 'remnant',
    density: 65000,
    regionId: 'v2:region:remnant:000711',
    distanceRatio: 0.8,
    elevation: 0.2,
    azimuth: 0.6,
  },
  body('pulsar', 'v2:system:000462:body:000', 15),
  body('comet', 'v2:system:000037:body:018', 15),
  body('binary', 'v2:system:000006:body:000', 25),
];
export function referencePose(scene: ReferenceScene, frame: number) {
  return {
    simulationTime: 12 + frame / 30,
    rotation: 0.15 + frame / 3000,
    azimuth: scene.azimuth + Math.sin(frame / 120) * 0.12,
    elevation: scene.elevation,
    distanceRatio: scene.distanceRatio * (1 + Math.sin(frame / 90) * 0.03),
  };
}
export function summarize(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = (p: number) =>
    sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null;
  return {
    count: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: at(1),
  };
}
