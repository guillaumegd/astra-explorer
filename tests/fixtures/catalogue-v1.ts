// Stable, language-agnostic ids. Displayed labels live in lib/i18n — never
// render these directly, they also key the ambience sound profiles.
export type BodyKind =
  | 'red-dwarf'
  | 'giant-star'
  | 'blue-star'
  | 'white-dwarf'
  | 'rocky-planet'
  | 'ocean-world'
  | 'desert-planet'
  | 'volcanic-world'
  | 'ice-planet'
  | 'gas-giant'
  | 'rocky-moon'
  | 'asteroid';
export type BodyIdentity = {
  id: number;
  systemId: number;
  systemName: string;
  parentId: number | null;
  name: string;
  kind: BodyKind;
  type: number;
  seed: number;
  radius: number;
  color: string;
  rings: boolean;
};

const families: {
  kind: BodyKind;
  type: number;
  range: [number, number];
  colors: string[];
}[] = [
  {
    kind: 'red-dwarf',
    type: 0,
    range: [0.003, 0.009],
    colors: ['#ff9875', '#ffbd92'],
  },
  {
    kind: 'giant-star',
    type: 0,
    range: [0.012, 0.03],
    colors: ['#ffdd9a', '#ffc381'],
  },
  {
    kind: 'blue-star',
    type: 0,
    range: [0.008, 0.02],
    colors: ['#80baff', '#bbdcff'],
  },
  {
    kind: 'white-dwarf',
    type: 0,
    range: [0.0015, 0.0035],
    colors: ['#e2edff', '#d4e1ff'],
  },
  {
    kind: 'rocky-planet',
    type: 1,
    range: [0.002, 0.007],
    colors: ['#71a679', '#c5af84', '#9295b4'],
  },
  {
    kind: 'ocean-world',
    type: 4,
    range: [0.0025, 0.009],
    colors: ['#398eac', '#3572bc'],
  },
  {
    kind: 'desert-planet',
    type: 5,
    range: [0.0015, 0.006],
    colors: ['#d38c5b', '#cbab78'],
  },
  {
    kind: 'volcanic-world',
    type: 6,
    range: [0.0015, 0.005],
    colors: ['#ff7831', '#ffc453'],
  },
  {
    kind: 'ice-planet',
    type: 7,
    range: [0.0015, 0.006],
    colors: ['#aadada', '#c3d6ee'],
  },
  {
    kind: 'gas-giant',
    type: 2,
    range: [0.005, 0.015],
    colors: ['#d7ae82', '#85c4cc', '#d09bba'],
  },
  {
    kind: 'rocky-moon',
    type: 3,
    range: [0.0008, 0.003],
    colors: ['#a9a398', '#a88874', '#c2c7d0'],
  },
  {
    kind: 'asteroid',
    type: 8,
    range: [0.00025, 0.0012],
    colors: ['#82776b', '#a08a7c', '#6f7880'],
  },
];

// Every property comes from the ID, never from camera distance or cache lifetime.
export function describeBodyV1(id: number): BodyIdentity {
  let state = (id + 1) >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = Math.imul(state ^ (state >>> 15), 1 | state);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < 4; i++) random();
  const choice = random();
  const slot = id % 8;
  const systemId = Math.floor(id / 8);
  const family =
    families[
      slot === 0
        ? Math.floor(choice * 4)
        : slot === 6
          ? 10
          : slot === 7
            ? 11
            : 4 + Math.floor(choice * 6)
    ];
  const color = family.colors[Math.floor(random() * family.colors.length)];
  // Log-uniform sizes avoid concentrating all bodies around the same average radius.
  const radius =
    (family.range[0] * (family.range[1] / family.range[0]) ** random()) /
    (family.type === 0 ? 40 : 160);
  return {
    id,
    systemId,
    systemName: `SYS-${String(systemId + 1).padStart(5, '0')}`,
    parentId: slot === 0 ? null : systemId * 8 + (slot === 6 ? 5 : 0),
    name: `AST-${String(id + 1).padStart(6, '0')}`,
    kind: family.kind,
    type: family.type,
    seed: random() * 100,
    radius,
    color,
    rings: family.type === 2 && random() > 0.45,
  };
}
