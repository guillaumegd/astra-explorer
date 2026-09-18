'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Orbit,
  ArrowUpRight,
  RotateCcw,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  MoreHorizontal,
  Info,
  HelpCircle,
  Satellite,
  Check,
  Plus,
  Minus,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  X,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CinematicIntro } from '@/components/cinematic-intro';
import { hasSeenOpening, rememberOpening } from '@/lib/opening-sequence';
import { Dialog } from '@base-ui/react/dialog';
import type { AmbientSoundtrack } from '@/lib/ambient-audio';
import { Slider } from '@/components/ui/slider';
import { type BodyIdentity } from '@/lib/stellar-lod';
import { catalogue } from '@/lib/catalogue/runtime';
import type { RegionDefinition } from '@/lib/catalogue/types';
import { localSystemRoot } from '@/lib/system-framing';
import { canRest, restDelay } from '@/lib/interface-rest';
import {
  bodyDiscoveryKey,
  isRevealAll,
  loadDiscoveries,
  regionDiscoveryKey,
  saveDiscoveries,
  type DiscoveryKey,
} from '@/lib/discoveries';
// The engine (three.js + lib/galaxy.ts) and the ambient audio are not
// needed to paint the shell: they load as their own chunk, in parallel,
// once the mount effect runs, instead of blocking the very first render.
import type {
  GalaxyEngine,
  CameraView,
  GalaxyMessages,
  SkyPointing,
  SystemView,
  RegionView,
  QualityReport,
} from '@/lib/galaxy';
import {
  resolveInitialQuality,
  storeQuality,
  type QualityMode,
} from '@/lib/quality-policy';
import { formatNumber, locales, localeNames } from '@/lib/i18n';
import { useLocale } from '@/lib/i18n/use-locale';
import type { Dictionary } from '@/lib/i18n/types';

/** The kind a notebook key names, as the discovery notice announces it. */
function discoveryLabel(key: DiscoveryKey, t: Dictionary): string | null {
  if (key.startsWith('region:')) {
    const regionId = key.slice('region:'.length);
    const nebula = catalogue.listNebulae().some((r) => r.regionId === regionId);
    return nebula ? t.regions.nebula : t.regions.remnant;
  }
  const body = catalogue.resolveReference(key.slice('body:'.length));
  if (!body) return null;
  return body.binary ? t.binary.label : t.bodyKinds[body.kind];
}

function buildGalaxyMessages(t: Dictionary): GalaxyMessages {
  return {
    canvasHint: t.canvas.ariaLabel,
    contextLost: t.canvas.contextLost,
    bodyKindLabel: (kind) => t.bodyKinds[kind],
    exploreBodyAria: t.system.exploreBodyAria,
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

// Renders the camera's live position in the scene as sky coordinates, so the
// readout tracks the actual viewpoint instead of quoting a fixed, real target.
function formatRightAscension(radians: number): string {
  const twoPi = Math.PI * 2;
  const turns = ((radians % twoPi) + twoPi) % twoPi;
  const totalSeconds = Math.round((turns / twoPi) * 24 * 3600) % (24 * 3600);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
}

function formatDeclination(radians: number): string {
  const degrees = (radians * 180) / Math.PI;
  const sign = degrees < 0 ? '-' : '+';
  const totalArcSeconds = Math.round(Math.abs(degrees) * 3600);
  const d = Math.floor(totalArcSeconds / 3600);
  const m = Math.floor((totalArcSeconds % 3600) / 60);
  const s = totalArcSeconds % 60;
  return `${sign}${pad(d)}° ${pad(m)}′ ${pad(s)}″`;
}

type Panel =
  | 'phenomena'
  | 'options'
  | 'advanced'
  | 'details'
  | 'viewDetails'
  | 'volume'
  | 'language'
  | 'help'
  | 'about';

function IconButton({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      {...props}
      aria-label={label}
      data-tooltip={label}
      className="icon-control"
    >
      {children}
    </Button>
  );
}

// Coordinates are the only continuously refreshed part of the interface.
// Keeping their state here prevents a camera report from re-rendering the
// complete control surface.
function PointingReadout({
  onSubscribe,
}: {
  onSubscribe: (
    listener: ((value: SkyPointing) => void) | null,
  ) => void;
}) {
  const [pointing, setPointing] = useState<SkyPointing>({ ra: 0, dec: 0.62 });
  useEffect(() => {
    const listener = (value: SkyPointing) => setPointing(value);
    onSubscribe(listener);
    return () => onSubscribe(null);
  }, [onSubscribe]);
  return (
    <>
      <div>
        <dt>RA</dt>
        <dd>{formatRightAscension(pointing.ra)}</dd>
      </div>
      <div>
        <dt>DEC</dt>
        <dd>{formatDeclination(pointing.dec)}</dd>
      </div>
    </>
  );
}

export default function Home() {
  const { locale, setLocale, t } = useLocale();
  const mount = useRef<HTMLDivElement>(null);
  const soundtrack = useRef<AmbientSoundtrack | null>(null);
  const [musicEnabled, setMusicEnabled] = useState(false);
  const [soundMuted, setSoundMuted] = useState(false);
  const soundMutedRef = useRef(false);
  const openingRevealed = useRef(false);
  const [musicBusy, setMusicBusy] = useState(false);
  const [musicError, setMusicError] = useState('');
  const [volume, setVolume] = useState(35);
  const engine = useRef<GalaxyEngine | null>(null);
  const [density, setDensity] = useState(65000);
  const [speed, setSpeed] = useState(1);
  const [tilt, setTilt] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [idle, setIdle] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [cameraView, setCameraView] = useState<CameraView>('overview');
  const [dockHeight, setDockHeight] = useState(56);
  const detailsButton = useRef<HTMLButtonElement>(null);
  const languageButton = useRef<HTMLButtonElement>(null);
  const immersiveButton = useRef<HTMLButtonElement>(null);
  const [notice, setNotice] = useState('');
  const [drifting, setDrifting] = useState(false);
  // Read lazily like the quality profile: the notebook is never part of the
  // first paint, so the server's empty set cannot disagree with it.
  const [discoveries, setDiscoveries] = useState<ReadonlySet<DiscoveryKey>>(
    () => loadDiscoveries(),
  );
  const [revealAll] = useState(
    () => typeof window !== 'undefined' && isRevealAll(window.location.search),
  );
  const [discoveryNotice, setDiscoveryNotice] = useState<{
    key: DiscoveryKey;
    label: string;
  } | null>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const panelSurface = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const dock = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState(0);
  const [quality, setQuality] = useState<QualityMode>(() =>
    resolveInitialQuality(),
  );
  const [qualityStatus, setQualityStatus] = useState<QualityReport>({
    mode: 'auto',
    preset: 'balanced',
    targetFps: 30,
    label: 'balanced-30',
    reason: 'start',
  });
  const settingsRef = useRef({
    density,
    speed,
    tilt,
    paused,
    palette,
    quality,
  });
  const [economyActive, setEconomyActive] = useState(false);
  const [ready, setReady] = useState(false);
  // Bumped as background catalogue growth advances what's drawable, purely
  // to re-render the density readout — nothing reads its value.
  const [, bumpGrowth] = useState(0);
  const [opening, setOpening] = useState(() => !hasSeenOpening());
  const [openingRun, setOpeningRun] = useState(0);
  const [error, setError] = useState('');
  const [systemView, setSystemView] = useState<SystemView | null>(null);
  const [selected, setSelected] = useState<BodyIdentity | null>(null);
  const [regionView, setRegionView] = useState<RegionView | null>(null);
  const chooseQuality = useCallback((next: QualityMode) => {
    storeQuality(next);
    setQuality(next);
    const settings = { ...settingsRef.current, quality: next };
    settingsRef.current = settings;
    engine.current?.configure(settings);
  }, []);
  const pointingReadout = useRef<{
    value: SkyPointing;
    listener: ((value: SkyPointing) => void) | null;
  }>({ value: { ra: 0, dec: 0.62 }, listener: null });
  const subscribePointing = useCallback(
    (listener: ((value: SkyPointing) => void) | null) => {
      pointingReadout.current.listener = listener;
    },
    [],
  );
  const galaxyMessages = useMemo(() => buildGalaxyMessages(t), [t]);
  // The mount effect below runs once; it reads translations through this ref
  // so a later locale change doesn't leave its error handlers stuck in
  // whichever language was active when the engine was first created.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });
  const musicStarted = useRef(false);
  // Same reason as tRef above: the mount effect must not re-run to see these.
  const musicRef = useRef({ opening, volume });
  useEffect(() => {
    musicRef.current = { opening, volume };
  });
  // Built from a user gesture, as browsers require, but not necessarily heard
  // yet: the opening primes it silently and raises it on the galaxy. A no-op
  // once this has ever succeeded, so a later replay cannot force the engine
  // back on after the visitor has explicitly muted it via the header.
  const enableMusic = (atVolume: number) => {
    const sound = soundtrack.current;
    if (!sound || musicStarted.current || soundMutedRef.current) return;
    musicStarted.current = true;
    sound.setVolume(atVolume);
    void sound.setEnabled(true).then((active) => {
      if (soundtrack.current !== sound) return;
      if (active && !soundMutedRef.current) setMusicEnabled(true);
      else {
        musicStarted.current = false;
      }
    });
  };
  useEffect(() => {
    if (!mount.current) return;
    let cancelled = false;
    // Ambient music defaults to on. With the opening running it is primed from
    // the gate click and raised only once the galaxy is out; without one there
    // is no such moment, so the first gesture both unblocks and raises it.
    const unblock = () => {
      enableMusic(musicRef.current.volume / 100);
    };
    const gestureEvents = ['pointerdown', 'keydown', 'touchstart'] as const;
    if (!musicRef.current.opening)
      gestureEvents.forEach((type) => window.addEventListener(type, unblock));
    // The engine (three.js + lib/galaxy.ts) and the ambient audio are heavy
    // enough to matter for the first paint, so they load as their own chunk,
    // in parallel with the rest of the shell, instead of being bundled in.
    Promise.all([import('@/lib/galaxy'), import('@/lib/ambient-audio')])
      .then(([{ createGalaxy }, { createAmbientSoundtrack }]) => {
        if (cancelled || !mount.current) return;
        soundtrack.current = createAmbientSoundtrack(
          () => {
            setMusicEnabled(false);
            setMusicError(tRef.current.sound.unavailable);
          },
          ({ start, ready }) =>
            engine.current?.recordAudioGesture(start, ready),
        );
        if (!musicRef.current.opening) unblock();
        try {
          engine.current = createGalaxy(
            mount.current,
            buildGalaxyMessages(tRef.current),
            setError,
            (body) => {
              setSelected(body);
            },
            (value, kind, pulse, binaryAngle, region, distant) =>
              soundtrack.current?.setProximity(
                value,
                kind,
                pulse,
                binaryAngle,
                region,
                distant,
              ),
            (view) => {
              setSystemView(view);
            },
            (value) => {
              pointingReadout.current.value = value;
              pointingReadout.current.listener?.(value);
            },
            () => setReady(true),
            setCameraView,
            setRegionView,
            () => bumpGrowth((n) => n + 1),
            (economy) => {
              soundtrack.current?.setEconomy(economy);
              setEconomyActive(economy);
            },
            setQualityStatus,
            (key) => {
              setDiscoveries((current) => {
                if (current.has(key)) return current;
                const next = new Set(current).add(key);
                saveDiscoveries(next);
                return next;
              });
              const label = discoveryLabel(key, tRef.current);
              if (label) setDiscoveryNotice({ key, label });
            },
            setDrifting,
          );
          // The import resolves after React effects have run, so apply the
          // already-selected persisted profile to this newly created engine.
          engine.current.configure(settingsRef.current);
          queueMicrotask(() => {
            setMusicBusy(false);
            setVolume(35);
            setSelected(null);
          });
        } catch (cause) {
          console.error('ASTRA 3D initialization failed', cause);
          queueMicrotask(() => setError(tRef.current.canvas.renderFailed));
        }
      })
      .catch((cause) => {
        console.error('ASTRA 3D module failed to load', cause);
        if (!cancelled) queueMicrotask(() => setError(tRef.current.canvas.renderFailed));
      });

    return () => {
      cancelled = true;
      engine.current?.dispose();
      soundtrack.current?.dispose();
      soundtrack.current = null;

      gestureEvents.forEach((type) =>
        window.removeEventListener(type, unblock),
      );
    };
  }, []);
  useEffect(() => {
    const settings = {
      density,
      speed,
      tilt,
      paused,
      palette,
      quality,
    };
    settingsRef.current = settings;
    engine.current?.configure(settings);
  }, [density, speed, tilt, paused, palette, quality]);
  useEffect(() => {
    engine.current?.setMessages(galaxyMessages);
  }, [galaxyMessages]);
  useEffect(() => {
    // This only changes the optional soundtrack graph. It never starts audio.
    soundtrack.current?.setEconomy(quality === 'economy');
  }, [quality]);
  // Fades the whole interface out after a stretch of inactivity for an
  // uninterrupted, contemplative view; any gesture brings it right back.
  // Immersive mode follows the same rule, having cleared the screen at once.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const focusedControl = !!(
          dock.current?.contains(document.activeElement) &&
          document.activeElement?.matches(':focus-visible')
        );
        if (canRest({ panel: !!panel, opening, focusedControl, drifting }))
          setIdle(true);
      }, restDelay({ drifting }));
    };
    wake();
    const events = [
      'pointerdown',
      'pointermove',
      'keydown',
      'wheel',
      'touchstart',
    ] as const;
    events.forEach((type) => window.addEventListener(type, wake));
    return () => {
      clearTimeout(timer);
      events.forEach((type) => window.removeEventListener(type, wake));
    };
  }, [panel, opening, drifting]);
  // A tab left for another goes quiet the same way the mute button does, and
  // comes back the same way. A visitor who muted on purpose stays muted.
  useEffect(() => {
    if (!musicEnabled) return;
    const visibility = () => {
      void soundtrack.current?.setEnabled(!document.hidden);
    };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  }, [musicEnabled]);
  const toggleMusic = async () => {
    const muted = !soundMutedRef.current;
    soundMutedRef.current = muted;
    setSoundMuted(muted);
    setMusicError('');
    const sound = soundtrack.current;
    if (!sound) return;
    setMusicBusy(true);
    sound.setVolume(opening && !openingRevealed.current ? 0 : volume / 100);
    const active = await sound.setEnabled(!muted);
    if (soundtrack.current === sound && soundMutedRef.current === muted) {
      setMusicEnabled(active);
      if (active) musicStarted.current = true;
      setMusicBusy(false);
    }
  };
  const reset = () => {
    changeDensity(65000);
    setSpeed(1);
    setPaused(false);
    setPalette(0);
    setTilt(null);
    chooseQuality('auto');
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !panel && !event.defaultPrevented)
        setImmersive(false);
      // After a click on Découvrir focus sits on the button, not the scene:
      // the drift's arrows must still work. The scene handles its own first
      // and marks the event, so a focused canvas never skips twice.
      if (
        drifting &&
        !panel &&
        !event.defaultPrevented &&
        (event.key === 'ArrowRight' || event.key === 'ArrowLeft')
      ) {
        event.preventDefault();
        engine.current?.nextBody(event.key === 'ArrowRight' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [panel, drifting]);
  useEffect(() => {
    if (panel) panelHeading.current?.focus();
  }, [panel]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    engine.current?.setDiscoveries(discoveries);
  }, [discoveries, ready]);
  useEffect(() => {
    if (!discoveryNotice) return;
    const timer = setTimeout(() => setDiscoveryNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [discoveryNotice]);
  useEffect(() => {
    if (!dock.current) return;
    const observer = new ResizeObserver(() =>
      setDockHeight(dock.current!.getBoundingClientRect().height),
    );
    observer.observe(dock.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const surface = panelSurface.current;
    const resize = () => {
      const top =
        panel && surface
          ? surface.getBoundingClientRect().top
          : dock.current?.getBoundingClientRect().top;
      engine.current?.setViewportInset(
        window.innerWidth <= 600 && !immersive && top !== undefined
          ? window.innerHeight - top + 12
          : 0,
      );
    };
    const observer = new ResizeObserver(resize);
    if (surface) observer.observe(surface);
    window.addEventListener('resize', resize);
    resize();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [panel, dockHeight, immersive]);
  const openPanel = (next: Panel) => {
    returnFocus.current =
      next === 'details'
        ? detailsButton.current
        : next === 'language'
          ? languageButton.current
          : moreButton.current;
    setIdle(false);
    setPanel(panel === next ? null : next);
  };
  const changeDensity = (value: number) => {
    if (
      selected &&
      selected.id >=
        (engine.current?.catalogue.activeCountWithin(value) ?? value)
    )
      setNotice(t.controls.densityNotice);
    setDensity(value);
  };
  const finishOpening = () => {
    rememberOpening();
    setOpening(false);
    setIdle(false);
    // The scene was inert throughout; without this, focus falls to <body>.
    requestAnimationFrame(() =>
      mount.current?.querySelector('canvas')?.focus(),
    );
  };
  const replayOpening = () => {
    setPanel(null);
    setImmersive(false);
    setIdle(false);
    setOpeningRun((value) => value + 1);
    setOpening(true);
    openingRevealed.current = false;
    // Back to silence, as on a first visit: the galaxy raises it again.
    soundtrack.current?.setVolume(0, 0.6);
    engine.current?.overview();
  };
  // Bodies and regions are different kinds of destination, so each entry
  // carries its own label and its own way of opening.
  const rareDestinations = useMemo(() => {
    const fromBody = (body: BodyIdentity) => ({
      id: body.bodyId,
      key: bodyDiscoveryKey(body, catalogue.getSystem(body.systemId)),
      name: body.name,
      kindLabel: t.bodyKinds[body.kind],
      open: () => engine.current?.inspectBody(body.id),
    });
    const fromRegion = (region: RegionDefinition, kindLabel: string) => ({
      id: region.regionId,
      key: regionDiscoveryKey(region),
      name: region.name,
      kindLabel,
      open: () => engine.current?.frameRegion(region.regionId),
    });
    const phenomena = catalogue.getPhenomena(density);
    return [
      {
        key: 'black-hole',
        label: t.bodyKinds['black-hole'],
        all: phenomena.filter((b) => b.kind === 'black-hole').map(fromBody),
        limit: Infinity,
      },
      {
        key: 'comet',
        label: t.bodyKinds.comet,
        all: phenomena.filter((b) => b.kind === 'comet').map(fromBody),
      },
      {
        key: 'pulsar',
        label: t.bodyKinds.pulsar,
        all: phenomena.filter((b) => b.kind === 'pulsar').map(fromBody),
        limit: Infinity,
      },
      {
        key: 'binary',
        label: t.binary.label,
        all: catalogue.getBinaries(density).map(fromBody),
        limit: 24,
      },
      {
        key: 'nebula',
        label: t.regions.nebulae,
        all: catalogue
          .listNebulae()
          .map((r) => fromRegion(r, t.regions.nebula)),
        limit: Infinity,
      },
      {
        key: 'remnant',
        label: t.regions.remnants,
        all: catalogue
          .getRemnants(density)
          .map((r) => fromRegion(r, t.regions.remnant)),
        limit: Infinity,
      },
    ];
  }, [density, t]);
  const foundCount = rareDestinations.reduce(
    (sum, { all }) =>
      sum + all.filter((entry) => discoveries.has(entry.key!)).length,
    0,
  );
  // A pulsar reaches its own remnant, and the remnant reaches back.
  const selectedRemnant = useMemo(
    () =>
      selected?.pulsar
        ? (catalogue
            .getRemnants(density)
            .find((r) => r.hostSystem === selected.systemId) ?? null)
        : null,
    [selected, density],
  );

  const localRoot = useMemo(() => {
    if (!selected) return null;
    const members = catalogue.getSystemMembers(selected.systemId);
    return localSystemRoot(selected, members);
  }, [selected]);
  const hidden = idle && !panel;
  const openingVisible = opening && !error;
  // Nothing invisible may hold the keyboard focus: when the bar fades out,
  // the scene takes it back, where the arrows keep working.
  useEffect(() => {
    if (!hidden || openingVisible) return;
    if (!dock.current?.contains(document.activeElement)) return;
    mount.current?.querySelector('canvas')?.focus();
  }, [hidden, openingVisible]);
  // On a cleared screen a press only asks for the interface back; the scene
  // must not read it as the choice of a star.
  useEffect(() => {
    engine.current?.setResting(hidden);
  }, [hidden, ready]);
  const musicLabel = musicEnabled ? t.sound.disableMusic : t.sound.enableMusic;
  const title =
    panel === 'language' ? t.language.label : panel ? t.controls[panel] : '';
  return (
    <main
      className={`observatory ${hidden ? 'is-quiet' : ''} ${openingVisible ? 'is-opening' : ''} ${economyActive ? 'is-economy' : ''} ${drifting ? 'is-drifting' : ''}`}
    >
      <div
        ref={mount}
        className="universe"
        aria-label={t.canvas.ariaLabel}
        inert={openingVisible}
      />
      <div className="vignette" />
      <header className="signature" inert={hidden || openingVisible}>
        <Orbit size={23} aria-hidden="true" />
        <span>
          ASTRA<span className="brand-dot">.</span>
        </span>
      </header>
      <div
        ref={dock}
        className="observation-dock"
        inert={hidden || openingVisible}
      >
        <div className="context-line">
          {!selected && regionView && (
            <div className="body-navigation">
              <Button
                variant="ghost"
                className="context-details"
                onClick={() => openPanel('details')}
                aria-label={t.controls.details}
                aria-haspopup="dialog"
                aria-expanded={panel === 'details'}
              >
                <span>
                  {regionView.region.type === 'nebula'
                    ? t.regions.nebula
                    : t.regions.remnant}
                </span>
                <Info size={14} />
              </Button>
            </div>
          )}
          {selected && (
            <div className="body-navigation">
              <IconButton
                label={t.inspector.previousBody}
                onClick={() => engine.current?.nextBody(-1)}
              >
                <ChevronLeft />
              </IconButton>
              <Button
                ref={detailsButton}
                variant="ghost"
                className="context-details"
                onClick={() => openPanel('details')}
                aria-label={t.controls.details}
                aria-haspopup="dialog"
                aria-expanded={panel === 'details'}
              >
                <span>{t.bodyKinds[selected.kind]}</span>
                <Info size={14} />
              </Button>
              <IconButton
                label={t.inspector.nextBody}
                onClick={() => engine.current?.nextBody(1)}
              >
                <ChevronRight />
              </IconButton>
            </div>
          )}
          <div className="context-actions">
            <Button
              variant="ghost"
              className="destination-control"
              onClick={() => {
                if (drifting) engine.current?.stopDrift();
                else if (selected) {
                  setPanel(null);
                  engine.current?.overview();
                } else engine.current?.startDrift();
              }}
              aria-pressed={drifting}
              aria-label={
                drifting
                  ? t.inspector.stopDrift
                  : selected
                    ? t.inspector.backToGalaxy
                    : t.inspector.discoverBody
              }
            >
              {selected && !drifting ? <ChevronLeft /> : <Orbit />}
              <span>
                {selected && !drifting ? t.controls.galaxy : t.controls.discover}
              </span>
            </Button>
            {selected && (
              <>
                <Button
                  variant="ghost"
                  className="scale-control"
                  aria-label={t.inspector.stellarSystem}
                  title={t.inspector.stellarSystem}
                  aria-pressed={systemView?.root.id === selected.rootId}
                  onClick={() => engine.current?.frameSystem('stellar')}
                >
                  <Orbit />
                  <span>{t.controls.system}</span>
                </Button>
                {localRoot !== null && (
                  <Button
                    variant="ghost"
                    className="scale-control"
                    aria-label={t.inspector.planetAndMoons}
                    title={t.inspector.planetAndMoons}
                    aria-pressed={systemView?.root.id === localRoot}
                    onClick={() => engine.current?.frameSystem('local')}
                  >
                    <Satellite />
                    <span>{t.controls.satellites}</span>
                  </Button>
                )}
                {(cameraView === 'selected' ||
                  cameraView === 'approaching') && (
                  <Button
                    variant="ghost"
                    className="approach-control"
                    disabled={cameraView === 'approaching'}
                    onClick={() => engine.current?.approach()}
                  >
                    {cameraView === 'approaching'
                      ? t.controls.approaching
                      : t.controls.approach}
                    <ArrowUpRight size={14} />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
        <fieldset className="command-bar" aria-label={t.brand.caption}>
          <IconButton
            label={t.zoom.out}
            onClick={() => engine.current?.zoom(1 / 1.5)}
          >
            <Minus />
          </IconButton>
          <IconButton
            label={t.zoom.in}
            onClick={() => engine.current?.zoom(1.5)}
          >
            <Plus />
          </IconButton>
          <span className="command-divider" />
          <IconButton
            label={
              paused ? t.view.resumeRotationAria : t.view.pauseRotationAria
            }
            aria-pressed={paused}
            onClick={() => setPaused((v) => !v)}
          >
            {paused ? <Play /> : <Pause />}
          </IconButton>
          <IconButton
            label={musicLabel}
            aria-pressed={musicEnabled}
            disabled={musicBusy}
            onClick={() => void toggleMusic()}
          >
            {musicEnabled ? <Volume2 /> : <VolumeX />}
          </IconButton>
          <IconButton
            ref={immersiveButton}
            label={
              immersive ? t.view.exitImmersiveAria : t.view.enterImmersiveAria
            }
            aria-pressed={immersive}
            onClick={() => {
              setPanel(null);
              setImmersive(!immersive);
              // Entering clears the screen at once; the next gesture brings
              // this very bar back, the way out of immersion included.
              setIdle(!immersive);
            }}
          >
            {immersive ? <Minimize2 /> : <Maximize2 />}
          </IconButton>
          <IconButton
            ref={languageButton}
            label={t.language.label}
            aria-haspopup="dialog"
            aria-expanded={panel === 'language'}
            onClick={() => openPanel('language')}
          >
            <span className="language-code">
              {locale.slice(0, 2).toUpperCase()}
            </span>
          </IconButton>
          <IconButton
            ref={moreButton}
            label={t.controls.options}
            aria-haspopup="dialog"
            aria-expanded={
              panel !== null && panel !== 'details' && panel !== 'language'
            }
            onClick={() => openPanel('options')}
          >
            <MoreHorizontal />
          </IconButton>
        </fieldset>
      </div>
      <Dialog.Root
        open={panel !== null}
        modal={false}
        disablePointerDismissal
        onOpenChange={(open) => {
          if (!open) setPanel(null);
        }}
      >
        <Dialog.Portal>
          <div
            className="panel-dismiss"
            aria-hidden="true"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setPanel(null);
            }}
          />
          <Dialog.Popup
            ref={panelSurface}
            className="options-surface"
            style={
              { '--dock-height': `${dockHeight}px` } as React.CSSProperties
            }
            initialFocus={panelHeading}
            finalFocus={() =>
              returnFocus.current?.isConnected
                ? returnFocus.current
                : moreButton.current
            }
          >
            <div className="surface-heading">
              {panel !== 'options' &&
                panel !== 'details' &&
                panel !== 'language' && (
                  <IconButton
                    label={t.controls.back}
                    onClick={() => setPanel('options')}
                  >
                    <ChevronLeft />
                  </IconButton>
                )}
              <Dialog.Title ref={panelHeading} tabIndex={-1}>
                {title}
              </Dialog.Title>
              <Dialog.Close
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="icon-control"
                    aria-label={t.controls.close}
                    data-tooltip={t.controls.close}
                  />
                }
              >
                <X />
              </Dialog.Close>
            </div>
            <div className="surface-content" key={panel}>
              {panel === 'options' && (
                <div className="option-list">
                  <Button variant="ghost" onClick={() => setPanel('phenomena')}>
                    <Orbit />
                    <span>{t.controls.phenomena}</span>
                    <ChevronRight />
                  </Button>
                  <Button variant="ghost" onClick={() => setPanel('volume')}>
                    <Volume2 />
                    <span>{t.controls.volume}</span>
                    <ChevronRight />
                  </Button>
                  <Button variant="ghost" onClick={() => setPanel('advanced')}>
                    <MoreHorizontal />
                    <span>{t.controls.advanced}</span>
                    <ChevronRight />
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setPanel('viewDetails')}
                  >
                    <Crosshair />
                    <span>{t.controls.viewDetails}</span>
                    <ChevronRight />
                  </Button>
                  <div className="option-separator" />
                  <Button variant="ghost" onClick={() => setPanel('help')}>
                    <HelpCircle />
                    <span>{t.controls.help}</span>
                    <ChevronRight />
                  </Button>
                  <Button variant="ghost" onClick={() => setPanel('about')}>
                    <Info />
                    <span>{t.controls.about}</span>
                    <ChevronRight />
                  </Button>
                </div>
              )}
              {panel === 'phenomena' && (
                <div className="option-list">
                  {!revealAll && (
                    <p className="discovery-count">
                      {t.discoveries.count(foundCount)}
                    </p>
                  )}
                  {rareDestinations.map(({ key, label, all, limit }) => {
                    // The notebook lists only what this visitor has reached;
                    // ?reveal restores the full catalogue with its counts.
                    const found = revealAll
                      ? all
                      : all.filter((entry) => discoveries.has(entry.key!));
                    const destinations = found.slice(0, limit);
                    if (!all.length) return null;
                    if (!destinations.length)
                      return (
                        <p
                          className="phenomenon-category is-unknown"
                          key={key}
                          aria-label={t.discoveries.unknown}
                        >
                          ???
                        </p>
                      );
                    return (
                      <details className="phenomenon-category" key={key}>
                        <summary>
                          {label} · {found.length}
                        </summary>
                        <div className="option-list">
                          {destinations.map((entry) => (
                            <Button
                              key={entry.id}
                              variant="ghost"
                              aria-label={t.system.exploreBodyAria(
                                entry.name,
                                entry.kindLabel,
                              )}
                              onClick={() => {
                                entry.open();
                                setPanel(null);
                              }}
                            >
                              <span>{entry.name}</span>
                              <ArrowUpRight />
                            </Button>
                          ))}
                        </div>
                      </details>
                    );
                  })}
                  {revealAll &&
                    rareDestinations.every(({ all }) => !all.length) && (
                      <p>{t.phenomena.empty}</p>
                    )}
                  {!revealAll && !foundCount && (
                    <p className="reading-copy">{t.discoveries.empty}</p>
                  )}
                </div>
              )}
              {panel === 'advanced' && (
                <>
                  <div className="control">
                    <div className="control-label">
                      <span id="density-label">{t.controls.count}</span>
                      <output>
                        {formatNumber(
                          catalogue.activeCountWithin(density),
                          locale,
                        )}
                      </output>
                    </div>
                    <Slider
                      aria-labelledby="density-label"
                      min={10000}
                      max={120000}
                      step={1000}
                      value={[density]}
                      onValueChange={(v) =>
                        changeDensity(Array.isArray(v) ? v[0] : v)
                      }
                    />
                    <div className="scale">
                      <span>{t.panel.sparse}</span>
                      <span>{t.panel.dense}</span>
                    </div>
                  </div>
                  <div className="control">
                    <div className="control-label">
                      <span id="speed-label">{t.panel.speed}</span>
                      <output>
                        {speed.toFixed(1)}
                        <small> ×</small>
                      </output>
                    </div>
                    <Slider
                      aria-labelledby="speed-label"
                      min={0}
                      max={3}
                      step={0.1}
                      value={[speed]}
                      onValueChange={(v) =>
                        setSpeed(Array.isArray(v) ? v[0] : v)
                      }
                    />
                    <div className="scale">
                      <span>{t.panel.still}</span>
                      <span>{t.panel.fast}</span>
                    </div>
                  </div>
                  <div className="palette-row">
                    <span>{t.quality.label}</span>
                    <div className="palettes">
                      {(
                        [
                          ['auto', t.quality.automatic],
                          ['economy', t.quality.economy],
                          ['balanced', t.quality.balanced],
                          ['high', t.quality.high],
                          ['ultra', t.quality.ultra],
                        ] as const
                      ).map(([mode, label]) => (
                        <Button
                          key={mode}
                          variant="ghost"
                          className="scale-control"
                          aria-label={`${t.quality.label} : ${label}`}
                          aria-pressed={quality === mode}
                          onClick={() => chooseQuality(mode)}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <output
                    className="quality-effective"
                    aria-live="polite"
                    data-quality-effective={qualityStatus.label}
                  >
                    {t.quality.effective}:{' '}
                    {t.quality.tiers[qualityStatus.preset]} ·{' '}
                    {qualityStatus.targetFps} FPS
                    {quality === 'auto'
                      ? ` · ${t.quality.adaptive}`
                      : qualityStatus.preset === 'rescue'
                        ? ` · ${t.quality.safetyFallback}`
                        : ` · ${t.quality.manual}`}
                  </output>
                  <p className="quality-hint">{t.quality.hint}</p>
                  <div className="palette-row">
                    <span>{t.controls.color}</span>
                    <div className="palettes">
                      {t.panel.paletteNames.map((name, i) => (
                        <Button
                          key={name}
                          className={`swatch swatch-${i} ${palette === i ? 'selected' : ''}`}
                          aria-label={name}
                          title={name}
                          aria-pressed={palette === i}
                          onClick={() => setPalette(i)}
                        />
                      ))}
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    className="reset-control"
                    onClick={reset}
                  >
                    <RotateCcw />
                    {t.controls.reset}
                  </Button>
                </>
              )}
              {panel === 'volume' && (
                <div className="control">
                  <div className="control-label">
                    <label id="volume-label">{t.sound.volumeLabel}</label>
                    <output>{volume}%</output>
                  </div>
                  <Slider
                    aria-labelledby="volume-label"
                    min={0}
                    max={100}
                    step={1}
                    value={[volume]}
                    onValueChange={(v) => {
                      const value = Array.isArray(v) ? v[0] : v;
                      setVolume(value);
                      soundtrack.current?.setVolume(value / 100);
                    }}
                  />
                  <Button
                    variant="ghost"
                    className="sound-toggle"
                    onClick={() => void toggleMusic()}
                    disabled={musicBusy}
                  >
                    {musicEnabled ? <Volume2 /> : <VolumeX />}
                    {musicLabel}
                  </Button>
                </div>
              )}
              {panel === 'language' && (
                <div className="option-list">
                  {locales.map((code) => (
                    <Button
                      variant="ghost"
                      key={code}
                      lang={code}
                      aria-pressed={locale === code}
                      onClick={() => {
                        setLocale(code);
                        setPanel(null);
                      }}
                    >
                      <span>{localeNames[code]}</span>
                      {locale === code && <Check />}
                    </Button>
                  ))}
                </div>
              )}
              {panel === 'help' && (
                <p className="reading-copy">{t.controls.helpText}</p>
              )}
              {panel === 'about' && (
                <div className="reading-copy">
                  <p>{t.controls.aboutText}</p>
                  <Button
                    variant="ghost"
                    className="replay-opening"
                    onClick={replayOpening}
                  >
                    <Play />
                    {t.opening.replay}
                  </Button>
                  <a
                    href="https://www.guillaumegirard.fr"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Guillaume Girard <ArrowUpRight size={14} />
                  </a>
                </div>
              )}
              {panel === 'viewDetails' && (
                <dl className="view-data">
                  <PointingReadout
                    onSubscribe={subscribePointing}
                  />
                  {selected && (
                    <div>
                      <dt>{t.controls.system}</dt>
                      <dd>{selected.systemName}</dd>
                    </div>
                  )}
                </dl>
              )}
              {panel === 'details' && selected && regionView?.occupied && (
                <p className="reading-copy">
                  {t.regions.inside} · {regionView.occupied.name}
                </p>
              )}
              {panel === 'details' && !selected && regionView && (
                <>
                  <div className="body-identity">
                    <span>
                      {regionView.region.type === 'nebula'
                        ? t.regions.nebula
                        : t.regions.remnant}
                    </span>
                    <strong>{regionView.region.name}</strong>
                    {regionView.inside > 0 && <p>{t.regions.inside}</p>}
                  </div>
                  <p className="reading-copy">
                    {regionView.region.type === 'nebula'
                      ? t.regions.nebulaDescription
                      : t.regions.remnantDescription}
                  </p>
                  {regionView.region.hostBodyId !== undefined && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        engine.current?.inspectBody(
                          regionView.region.hostBodyId!,
                        )
                      }
                    >
                      <Orbit />
                      {t.regions.toPulsar}
                      <ArrowUpRight />
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => setPanel('phenomena')}>
                    <Orbit />
                    {t.controls.phenomena}
                    <ChevronRight />
                  </Button>
                </>
              )}
              {panel === 'details' && selected && (
                <>
                  <div className="body-identity">
                    <span>{t.bodyKinds[selected.kind]}</span>
                    <strong>{selected.name}</strong>
                    <p>
                      {selected.systemName} ·{' '}
                      {selected.role === 'central'
                        ? selected.phenomenon || selected.pulsar
                          ? t.phenomena.central
                          : selected.binary
                            ? t.binary.component(
                                selected.binary.component === 0 ? 'A' : 'B',
                              )
                            : t.inspector.centralStar
                        : selected.kind === 'rocky-moon'
                          ? t.inspector.moonOf(
                              catalogue.getBody(
                                selected.parentId ?? selected.rootId,
                              ).name,
                            )
                          : catalogue.getBody(selected.rootId).pulsar
                            ? t.phenomena.pulsarOrbit
                            : catalogue.getBody(selected.rootId).phenomenon
                              ? t.phenomena.orbit
                              : catalogue.getBody(selected.rootId).binary
                                ? t.binary.circumbinaryOrbit
                                : t.inspector.orbitsTheStar}
                    </p>
                  </div>
                  {(selected.phenomenon ||
                    selected.pulsar ||
                    selected.comet) && (
                    <p className="reading-copy">
                      {selected.comet
                        ? t.phenomena.cometDescription
                        : selected.pulsar
                          ? t.phenomena.pulsarDescription
                          : t.phenomena.description}
                    </p>
                  )}
                  {selectedRemnant && (
                    <Button
                      variant="ghost"
                      onClick={() =>
                        engine.current?.frameRegion(selectedRemnant.regionId)
                      }
                    >
                      <Orbit />
                      {t.regions.toRemnant}
                      <ArrowUpRight />
                    </Button>
                  )}
                  {selected.binary && (
                    <>
                      <p className="reading-copy">{t.binary.description}</p>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          engine.current?.inspectBody(
                            selected.binary!.companionId,
                          )
                        }
                      >
                        <Orbit />
                        {t.binary.companion}
                        <ArrowUpRight />
                      </Button>
                    </>
                  )}
                  <Button variant="ghost" onClick={() => setPanel('phenomena')}>
                    <Orbit />
                    {t.controls.phenomena}
                    <ChevronRight />
                  </Button>
                  {systemView && (
                    <details className="detail-section">
                      <summary>{t.controls.members}</summary>
                      <div className="option-list">
                        {systemView.barycentric && (
                          <p className="reading-copy">{t.binary.barycentre}</p>
                        )}
                        {systemView &&
                          systemView.members.map((body) => (
                            <Button
                              variant="ghost"
                              key={body.id}
                              onClick={() =>
                                engine.current?.inspectBody(body.id)
                              }
                            >
                              <span>
                                {t.bodyKinds[body.kind]} · {body.name}
                              </span>
                              <ArrowUpRight />
                            </Button>
                          ))}
                      </div>
                    </details>
                  )}
                  {cameraView === 'close' &&
                    selected.capabilities.renderClass === 'ordinary' && (
                      <details className="detail-section">
                        <summary>{t.controls.camera}</summary>
                        <div className="control camera-control">
                          <div className="control-label">
                            <label id="tilt-label">{t.inspector.tilt}</label>
                            <output>
                              {tilt === null
                                ? t.inspector.tiltAuto
                                : t.inspector.tiltMax(tilt)}
                            </output>
                          </div>
                          <Slider
                            aria-labelledby="tilt-label"
                            min={0}
                            max={60}
                            step={1}
                            value={[tilt ?? 60]}
                            onValueChange={(v) =>
                              setTilt(Array.isArray(v) ? v[0] : v)
                            }
                          />
                          <div className="camera-presets">
                            <Button
                              variant="ghost"
                              aria-pressed={tilt === 0}
                              onClick={() => setTilt(0)}
                            >
                              {t.inspector.verticalView}
                            </Button>
                            <Button
                              variant="ghost"
                              aria-pressed={tilt === null}
                              onClick={() => setTilt(null)}
                            >
                              {t.inspector.automatic}
                            </Button>
                          </div>
                        </div>
                      </details>
                    )}
                </>
              )}
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      {(musicError || notice) && (
        <output className="status-notice">{musicError || notice}</output>
      )}
      {/* Outside the dock, so the quiet interface dims it instead of hiding it. */}
      <output className="discovery-notice" aria-live="polite">
        {discoveryNotice && !openingVisible && (
          <span key={discoveryNotice.key}>
            {t.discoveries.found(discoveryNotice.label)}
          </span>
        )}
      </output>
      {openingVisible && (
        <CinematicIntro
          key={openingRun}
          ready={ready}
          copy={t.opening}
          muted={soundMuted}
          muteLabel={t.sound.disableMusic}
          unmuteLabel={t.sound.enableMusic}
          onToggleMute={() => void toggleMusic()}
          onStart={() => enableMusic(0)}
          onReveal={(seconds = 1.5) => {
            openingRevealed.current = true;
            soundtrack.current?.setVolume(volume / 100, seconds);
          }}
          onProgress={(progress) =>
            engine.current?.setOpeningProgress(progress)
          }
          onFinish={finishOpening}
        />
      )}
      {((!ready && !openingVisible) || error) && (
        <output className="loading">{error || t.loading}</output>
      )}
    </main>
  );
}
