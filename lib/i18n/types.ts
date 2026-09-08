import type { BodyKind } from '../stellar-lod';

export type Locale = 'fr' | 'en' | 'es' | 'pt-PT';

export type Dictionary = {
  meta: { title: string; description: string };
  canvas: {
    ariaLabel: string;
    contextLost: string;
    renderFailed: string;
  };
  brand: { home: string; caption: string; live: string };
  intro: {
    eyebrow: string;
    titleLine1: string;
    titleLine2: string;
    subtitleLine1: string;
    subtitleLine2: string;
  };
  inspector: {
    ariaLabel: string;
    freeExploration: string;
    everyPointIsAWorld: string;
    selectPrompt: string;
    centralStar: string;
    moonOf: (code: string) => string;
    orbitsTheStar: string;
    previousBody: string;
    nextBody: string;
    exploreBody: string;
    discoverBody: string;
    tilt: string;
    tiltAuto: string;
    tiltMax: (deg: number) => string;
    verticalView: string;
    automatic: string;
    stellarSystem: string;
    planetAndMoons: string;
    systemCaption: (rootName: string, count: number) => string;
    viewMembers: (count: number) => string;
    backToGalaxy: string;
  };
  panel: {
    ariaLabel: string;
    eyebrow: string;
    heading: string;
    hide: string;
    density: string;
    sparse: string;
    dense: string;
    speed: string;
    still: string;
    fast: string;
    spectrum: string;
    paletteNames: [string, string, string];
    rotationPaused: string;
    systemBalanced: string;
    resetAria: string;
    resetTitle: string;
  };
  reopen: string;
  hints: { select: string; zoom: string };
  telemetry: { particles: string; tagline: string };
  sound: {
    ariaLabel: string;
    disableMusic: string;
    enableMusic: string;
    opening: string;
    active: string;
    activate: string;
    volumeLabel: string;
    unavailable: string;
  };
  zoom: { out: string; in: string; label: string };
  view: {
    resumeRotationAria: string;
    pauseRotationAria: string;
    resumeTitle: string;
    pauseTitle: string;
    exitImmersiveAria: string;
    enterImmersiveAria: string;
    immersiveTitle: string;
  };
  loading: string;
  bodyKinds: Record<BodyKind, string>;
  system: { exploreBodyAria: (name: string, kind: string) => string };
  language: { label: string };
};
