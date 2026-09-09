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
  SlidersHorizontal,
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
import { LanguageSwitcher } from '@/components/language-switcher';
import {
  createAmbientSoundtrack,
  type AmbientSoundtrack,
} from '@/lib/ambient-audio';
import { Slider } from '@/components/ui/slider';
import type { BodyIdentity } from '@/lib/stellar-lod';
import {
  createGalaxy,
  type GalaxyEngine,
  type GalaxyMessages,
  type SkyPointing,
  type SystemView,
} from '@/lib/galaxy';
import { formatNumber } from '@/lib/i18n';
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
  const [panel, setPanel] = useState(true);
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
  // yet: the opening primes it silently and raises it on the galaxy.
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
        setSelected,
        (value, kind) => soundtrack.current?.setProximity(value, kind),
        (view) => {
          setSystemView(view);
          if (view && window.innerWidth < 600) setPanel(false);
        },
        setPointing,
        () => setReady(true),
      );
      queueMicrotask(() => {
        setMusicBusy(false);
        setVolume(35);
        setSelected(null);
        if (window.matchMedia('(max-width: 600px)').matches) setPanel(false);
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

    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setImmersive(false);
    };
    window.addEventListener('keydown', key);
    return () => {
      engine.current?.dispose();
      soundtrack.current?.dispose();
      soundtrack.current = null;
      window.removeEventListener('keydown', key);
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
      timer = setTimeout(() => { if (!opening) setIdle(true); }, 10000);
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
  }, [opening]);
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
    setDensity(65000);
    setSpeed(1);
    setPaused(false);
    setPalette(0);
    engine.current?.reset();
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
    setPanel(false);
    setImmersive(false);
    setIdle(false);
    setOpeningRun((value) => value + 1);
    setOpening(true);
    openingRevealed.current = false;
    // Back to silence, as on a first visit: the galaxy raises it again.
    soundtrack.current?.setVolume(0, 0.6);
    engine.current?.overview();
  };
  const openingVisible = opening && !error;
  return (
    <main
      className={`observatory ${immersive || idle ? 'immersive' : ''} ${systemView ? 'system-view' : ''} ${openingVisible ? 'is-opening' : ''}`}
    >
      <div ref={mount} className="universe" aria-label={t.canvas.ariaLabel} inert={openingVisible} />
      <div className="vignette" />
      <header inert={openingVisible} className="topbar chrome">
        {/* oxlint-disable-next-line nextjs/no-html-link-for-pages -- Shared with the standalone static build, without a Next router. */}
        <a className="brand" href="./" aria-label={t.brand.home}>
          <Orbit size={27} />
          <span>
            ASTRA<span className="brand-dot">.</span>
          </span>
          <span className="brand-caption">{t.brand.caption}</span>
        </a>
        <div className="top-right">
          <span className="live">
            <i /> {t.brand.live}
          </span>
          <span className="edition">EXP. 001</span>
          <LanguageSwitcher
            locale={locale}
            onChange={setLocale}
            label={t.language.label}
          />
        </div>
      </header>
      <section inert={openingVisible} className="intro chrome">
        <div className="eyebrow">
          <span /> {t.intro.eyebrow}
        </div>
        <h1>
          {t.intro.titleLine1}
          <br />
          <em>{t.intro.titleLine2}</em>
        </h1>
        <p>
          {t.intro.subtitleLine1}
          <br />
          {t.intro.subtitleLine2}
        </p>
        <div className="coordinates">
          RA {formatRightAscension(pointing.ra)} <span> / </span> DEC{' '}
          {formatDeclination(pointing.dec)}
        </div>
      </section>
      <section inert={openingVisible} className="body-inspector" aria-label={t.inspector.ariaLabel}>
        <div className="body-identity">
          <Crosshair size={16} />
          <div>
            <span className="eyebrow">
              {selected ? t.bodyKinds[selected.kind] : t.inspector.freeExploration}
            </span>
            <strong>
              {selected ? selected.name : t.inspector.everyPointIsAWorld}
            </strong>
          </div>
        </div>
        <p>
          {selected
            ? `${selected.systemName} · ${
                selected.parentId === null
                  ? t.inspector.centralStar
                  : selected.kind === 'rocky-moon'
                    ? t.inspector.moonOf(
                        'AST-' +
                          String(selected.parentId + 1).padStart(6, '0'),
                      )
                    : t.inspector.orbitsTheStar
              }`
            : t.inspector.selectPrompt}
        </p>
        <div className="body-actions">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t.inspector.previousBody}
            onClick={() => engine.current?.nextBody(-1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            className="inspect-button"
            onClick={() => engine.current?.approach()}
          >
            {selected ? t.inspector.exploreBody : t.inspector.discoverBody}
            <ArrowUpRight size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t.inspector.nextBody}
            onClick={() => engine.current?.nextBody(1)}
          >
            <ChevronRight />
          </Button>
        </div>
        {selected && (
          <div className="surface-camera-controls">
            <label id="tilt-label">
              {t.inspector.tilt}{' '}
              <span>
                {tilt === null
                  ? t.inspector.tiltAuto
                  : t.inspector.tiltMax(tilt)}
              </span>
            </label>
            <Slider
              aria-labelledby="tilt-label"
              min={0}
              max={60}
              step={1}
              value={[tilt ?? 60]}
              onValueChange={(value) =>
                setTilt(Array.isArray(value) ? value[0] : value)
              }
            />
            <div>
              <button onClick={() => setTilt(0)}>
                {t.inspector.verticalView}
              </button>
              <button
                aria-pressed={tilt === null}
                onClick={() => setTilt(null)}
              >
                {t.inspector.automatic}
              </button>
            </div>
          </div>
        )}
        <div className="system-actions">
          <Button
            variant="ghost"
            onClick={() => engine.current?.frameSystem('stellar')}
          >
            <Orbit size={13} />
            {t.inspector.stellarSystem}
          </Button>
          {selected && selected.parentId !== null && (
            <Button
              variant="ghost"
              onClick={() => engine.current?.frameSystem('local')}
            >
              {t.inspector.planetAndMoons}
            </Button>
          )}
        </div>
        {systemView && (
          <output className="system-caption">
            {t.inspector.systemCaption(
              systemView.root.name,
              systemView.members.length,
            )}
          </output>
        )}
        {systemView && (
          <details className="system-members">
            <summary>
              {t.inspector.viewMembers(systemView.members.length)}
            </summary>
            <div>
              {systemView.members.map((body) => (
                <button
                  key={body.id}
                  onClick={() => engine.current?.inspectBody(body.id)}
                >
                  {body.name} · {t.bodyKinds[body.kind]}
                </button>
              ))}
            </div>
          </details>
        )}
        {selected && (
          <Button
            variant="ghost"
            className="overview-button"
            onClick={() => engine.current?.overview()}
          >
            {t.inspector.backToGalaxy}
          </Button>
        )}
      </section>
      <aside inert={openingVisible}
        className={`control-panel chrome ${panel ? '' : 'collapsed'}`}
        aria-label={t.panel.ariaLabel}
      >
        <div className="panel-heading">
          <div>
            <span className="eyebrow">{t.panel.eyebrow}</span>
            <h2>{t.panel.heading}</h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t.panel.hide}
            onClick={() => setPanel(false)}
          >
            <X />
          </Button>
        </div>
        <div className="control">
          <div className="control-label">
            <span id="density-label">{t.panel.density}</span>
            <output>{formatNumber(density, locale)}</output>
          </div>
          <Slider
            aria-labelledby="density-label"
            min={10000}
            max={120000}
            step={1000}
            value={[density]}
            onValueChange={(v) => setDensity(Array.isArray(v) ? v[0] : v)}
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
            onValueChange={(v) => setSpeed(Array.isArray(v) ? v[0] : v)}
          />
          <div className="scale">
            <span>{t.panel.still}</span>
            <span>{t.panel.fast}</span>
          </div>
        </div>
        <div className="palette-row">
          <span>{t.panel.spectrum}</span>
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
        <div className="panel-footer">
          <span>
            <i />{' '}
            {paused ? t.panel.rotationPaused : t.panel.systemBalanced}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t.panel.resetAria}
            title={t.panel.resetTitle}
            onClick={reset}
          >
            <RotateCcw size={14} />
          </Button>
        </div>
      </aside>
      {!panel && (
        <Button
          inert={openingVisible}
          className="reopen chrome"
          variant="outline"
          onClick={() => setPanel(true)}
        >
          <SlidersHorizontal /> {t.reopen}
        </Button>
      )}
      <div inert={openingVisible} className="bottom-hint chrome">
        <span className="mouse-icon" />
        <span>{t.hints.select}</span>
        <span className="hint-divider" />
        <span className="secondary-hint">{t.hints.zoom}</span>
      </div>
      <footer inert={openingVisible} className="bottom-bar chrome">
        <div className="telemetry">
          <span>
            <b>{formatNumber(density, locale)}</b> {t.telemetry.particles}
          </span>
          <span className="telemetry-line" />
          <a
            className="credit"
            href="https://www.guillaumegirard.fr"
            target="_blank"
            rel="noopener noreferrer"
          >
            Guillaume Girard
          </a>
        </div>
        <Button className="replay-opening" variant="ghost" onClick={replayOpening}><Play />{t.opening.replay}</Button>
        <span className="footer-note">{t.telemetry.tagline}</span>
      </footer>
      <section inert={openingVisible} className="sound-controls" aria-label={t.sound.ariaLabel}>
        <Button
          variant="ghost"
          className="music-button"
          aria-label={musicEnabled ? t.sound.disableMusic : t.sound.enableMusic}
          aria-pressed={musicEnabled}
          disabled={musicBusy}
          onClick={() => void toggleMusic()}
        >
          {musicEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
          <span>
            {musicBusy
              ? t.sound.opening
              : musicEnabled
                ? t.sound.active
                : t.sound.activate}
          </span>
        </Button>
        {musicEnabled && (
          <div className="music-volume">
            <span id="music-volume-label" className="sr-only">
              {t.sound.volumeLabel}
            </span>
            <Slider
              aria-labelledby="music-volume-label"
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
          </div>
        )}
        {musicError && <output className="music-error">{musicError}</output>}
      </section>
      <div inert={openingVisible} className="zoom-actions">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t.zoom.out}
          onClick={() => engine.current?.zoom(1 / 1.5)}
        >
          <Minus />
        </Button>
        <span>{t.zoom.label}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t.zoom.in}
          onClick={() => engine.current?.zoom(1.5)}
        >
          <Plus />
        </Button>
      </div>
      <div inert={openingVisible} className="view-actions">
        <Button
          variant="ghost"
          size="icon"
          aria-label={
            paused ? t.view.resumeRotationAria : t.view.pauseRotationAria
          }
          title={paused ? t.view.resumeTitle : t.view.pauseTitle}
          onClick={() => setPaused((v) => !v)}
        >
          {paused ? <Play /> : <Pause />}
        </Button>
        <span />
        <Button
          variant="ghost"
          size="icon"
          aria-label={
            immersive ? t.view.exitImmersiveAria : t.view.enterImmersiveAria
          }
          title={t.view.immersiveTitle}
          onClick={() => setImmersive((v) => !v)}
        >
          {immersive ? <Minimize2 /> : <Maximize2 />}
        </Button>
      </div>
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
