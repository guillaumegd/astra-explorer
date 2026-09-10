'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
import {
  createAmbientSoundtrack,
  type AmbientSoundtrack,
} from '@/lib/ambient-audio';
import { Slider } from '@/components/ui/slider';
import { describeBody, type BodyIdentity } from '@/lib/stellar-lod';
import { localSystemRoot } from '@/lib/system-framing';
import {
  createGalaxy,
  type GalaxyEngine,
  type CameraView,
  type GalaxyMessages,
  type SkyPointing,
  type SystemView,
} from '@/lib/galaxy';
import { formatNumber, locales, localeNames } from '@/lib/i18n';
import { useLocale } from '@/lib/i18n/use-locale';
import type { Dictionary } from '@/lib/i18n/types';

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
  const moreButton = useRef<HTMLButtonElement>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const panelSurface = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const dock = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState(0);
  const [ready, setReady] = useState(false);
  const [opening, setOpening] = useState(() => !hasSeenOpening());
  const [openingRun, setOpeningRun] = useState(0);
  const [error, setError] = useState('');
  const [systemView, setSystemView] = useState<SystemView | null>(null);
  const [selected, setSelected] = useState<BodyIdentity | null>(null);
  const [pointing, setPointing] = useState<SkyPointing>({ ra: 0, dec: 0.62 });
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
    soundtrack.current = createAmbientSoundtrack(() => {
      setMusicEnabled(false);
      setMusicError(tRef.current.sound.unavailable);
    });
    try {
      engine.current = createGalaxy(
        mount.current,
        buildGalaxyMessages(tRef.current),
        setError,
        (body) => {
          setSelected(body);
        },
        (value, kind) => soundtrack.current?.setProximity(value, kind),
        (view) => {
          setSystemView(view);
        },
        setPointing,
        () => setReady(true),
        setCameraView,
      );
      queueMicrotask(() => {
        setMusicBusy(false);
        setVolume(35);
        setSelected(null);
      });
    } catch {
      queueMicrotask(() => setError(tRef.current.canvas.renderFailed));
    }
    // Ambient music defaults to on. With the opening running it is primed from
    // the gate click and raised only once the galaxy is out; without one there
    // is no such moment, so the first gesture both unblocks and raises it.
    const unblock = () => {
      enableMusic(musicRef.current.volume / 100);
    };
    const gestureEvents = ['pointerdown', 'keydown', 'touchstart'] as const;
    if (!musicRef.current.opening) {
      unblock();
      gestureEvents.forEach((type) => window.addEventListener(type, unblock));
    }

    return () => {
      engine.current?.dispose();
      soundtrack.current?.dispose();
      soundtrack.current = null;

      gestureEvents.forEach((type) =>
        window.removeEventListener(type, unblock),
      );
    };
  }, []);
  useEffect(() => {
    engine.current?.configure({ density, speed, tilt, paused, palette });
  }, [density, speed, tilt, paused, palette]);
  useEffect(() => {
    engine.current?.setMessages(galaxyMessages);
  }, [galaxyMessages]);
  // Fades the interface out after a stretch of inactivity for an uninterrupted,
  // contemplative view; any activity brings it right back.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const focusedControl =
          dock.current?.contains(document.activeElement) &&
          document.activeElement?.matches(':focus-visible');
        if (!panel && !focusedControl && !opening) setIdle(true);
      }, 10000);
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
  }, [panel, opening]);
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
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !panel && !event.defaultPrevented)
        setImmersive(false);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [panel]);
  useEffect(() => {
    if (panel) panelHeading.current?.focus();
  }, [panel]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
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
    if (selected && selected.id >= value) setNotice(t.controls.densityNotice);
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
  const localRoot = useMemo(() => {
    if (!selected) return null;
    const start = selected.systemId * 8;
    return localSystemRoot(
      selected,
      Array.from({ length: Math.min(8, density - start) }, (_, i) =>
        describeBody(start + i),
      ),
    );
  }, [selected, density]);
  const hidden = immersive || (idle && !panel);
  const openingVisible = opening && !error;
  const musicLabel = musicEnabled ? t.sound.disableMusic : t.sound.enableMusic;
  const title =
    panel === 'language' ? t.language.label : panel ? t.controls[panel] : '';
  return (
    <main
      className={`observatory ${hidden ? 'is-quiet' : ''} ${openingVisible ? 'is-opening' : ''}`}
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
                if (selected) {
                  setPanel(null);
                  engine.current?.overview();
                } else engine.current?.approach();
              }}
              aria-label={
                selected ? t.inspector.backToGalaxy : t.inspector.discoverBody
              }
            >
              {selected ? <ChevronLeft /> : <Orbit />}
              <span>{selected ? t.controls.galaxy : t.controls.discover}</span>
            </Button>
            {selected && (
              <>
                <Button
                  variant="ghost"
                  className="scale-control"
                  aria-label={t.inspector.stellarSystem}
                  title={t.inspector.stellarSystem}
                  aria-pressed={systemView?.root.id === selected.systemId * 8}
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
            label={t.view.enterImmersiveAria}
            aria-pressed={immersive}
            onClick={() => {
              setPanel(null);
              setImmersive(true);
            }}
          >
            <Maximize2 />
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
      {hidden && !openingVisible && (
        <div className="quiet-controls">
          <IconButton
            label={musicLabel}
            aria-pressed={musicEnabled}
            disabled={musicBusy}
            onClick={() => void toggleMusic()}
          >
            {musicEnabled ? <Volume2 /> : <VolumeX />}
          </IconButton>
          <IconButton
            label={t.view.exitImmersiveAria}
            onClick={() => {
              setImmersive(false);
              setIdle(false);
              requestAnimationFrame(() => immersiveButton.current?.focus());
            }}
          >
            <Minimize2 />
          </IconButton>
        </div>
      )}
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
              {panel === 'advanced' && (
                <>
                  <div className="control">
                    <div className="control-label">
                      <span id="density-label">{t.controls.count}</span>
                      <output>{formatNumber(density, locale)}</output>
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
                  <div>
                    <dt>RA</dt>
                    <dd>{formatRightAscension(pointing.ra)}</dd>
                  </div>
                  <div>
                    <dt>DEC</dt>
                    <dd>{formatDeclination(pointing.dec)}</dd>
                  </div>
                  {selected && (
                    <div>
                      <dt>{t.controls.system}</dt>
                      <dd>{selected.systemName}</dd>
                    </div>
                  )}
                </dl>
              )}
              {panel === 'details' && selected && (
                <>
                  <div className="body-identity">
                    <span>{t.bodyKinds[selected.kind]}</span>
                    <strong>{selected.name}</strong>
                    <p>
                      {selected.systemName} ·{' '}
                      {selected.parentId === null
                        ? t.inspector.centralStar
                        : selected.kind === 'rocky-moon'
                          ? t.inspector.moonOf(
                              'AST-' +
                                String(selected.parentId + 1).padStart(6, '0'),
                            )
                          : t.inspector.orbitsTheStar}
                    </p>
                  </div>
                  {systemView && (
                    <details className="detail-section">
                      <summary>{t.controls.members}</summary>
                      <div className="option-list">
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
                  {cameraView === 'close' && (
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
