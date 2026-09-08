'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Orbit,
  ArrowUpRight,
  RotateCcw,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Radio,
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
import { Switch } from '@/components/ui/switch';
import {
  createAmbientSoundtrack,
  type AmbientSoundtrack,
} from '@/lib/ambient-audio';
import { Slider } from '@/components/ui/slider';
import type { BodyIdentity } from '@/lib/stellar-lod';
import { createGalaxy, type GalaxyEngine, type SystemView } from '@/lib/galaxy';

export default function Home() {
  const mount = useRef<HTMLDivElement>(null);
  const soundtrack = useRef<AmbientSoundtrack | null>(null);
  const [wavesEnabled, setWavesEnabled] = useState(true);
  const [musicEnabled, setMusicEnabled] = useState(false);
  const [musicBusy, setMusicBusy] = useState(false);
  const [musicError, setMusicError] = useState('');
  const [volume, setVolume] = useState(35);
  const engine = useRef<GalaxyEngine | null>(null);
  const [density, setDensity] = useState(65000);
  const [speed, setSpeed] = useState(1);
  const [tilt, setTilt] = useState<number | null>(null);
  const [gravity, setGravity] = useState(1.5);
  const [paused, setPaused] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [panel, setPanel] = useState(true);
  const [palette, setPalette] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [systemView, setSystemView] = useState<SystemView | null>(null);
  const [selected, setSelected] = useState<BodyIdentity | null>(null);
  const [waves, setWaves] = useState(0);
  useEffect(() => {
    if (!mount.current) return;
    soundtrack.current = createAmbientSoundtrack(() => {
      setMusicEnabled(false);
      setMusicError(
        'Le son est indisponible. Réessayez en activant la musique.',
      );
    });
    try {
      engine.current = createGalaxy(
        mount.current,
        () => setWaves((n) => n + 1),
        setError,
        setSelected,
        (value, kind) => soundtrack.current?.setProximity(value, kind),
        (view) => {
          setSystemView(view);
          if (view && window.innerWidth < 600) setPanel(false);
        },
      );
      queueMicrotask(() => {
        setReady(true);
        setMusicEnabled(false);
        setMusicBusy(false);
        setVolume(35);
        setSelected(null);
        if (window.matchMedia('(max-width: 600px)').matches) setPanel(false);
      });
    } catch {
      queueMicrotask(() =>
        setError(
          'Le rendu 3D ne peut pas démarrer. Activez l’accélération matérielle et rechargez la page.',
        ),
      );
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
    };
  }, []);
  useEffect(() => {
    engine.current?.configure({
      density,
      speed,
      gravity,
      tilt,
      paused,
      palette,
      wavesEnabled,
    });
  }, [density, speed, gravity, tilt, paused, palette, wavesEnabled]);
  const toggleMusic = async () => {
    if (musicBusy || !soundtrack.current) return;
    setMusicBusy(true);
    setMusicError('');
    const sound = soundtrack.current;
    const active = await sound.setEnabled(!musicEnabled);
    if (soundtrack.current === sound) {
      setMusicEnabled(active);
      setMusicBusy(false);
    }
  };
  const reset = () => {
    setDensity(65000);
    setSpeed(1);
    setGravity(1.5);
    setPaused(false);
    setPalette(0);
    engine.current?.reset();
  };
  return (
    <main
      className={`observatory ${immersive ? 'immersive' : ''} ${systemView ? 'system-view' : ''}`}
    >
      <div
        ref={mount}
        className="universe"
        aria-label="Galaxie 3D interactive. Cliquez sur un astre pour le sélectionner, puis zoomez. Majuscule et clic créent une onde."
      />
      <div className="vignette" />
      <header className="topbar chrome">
        {/* oxlint-disable-next-line nextjs/no-html-link-for-pages -- Shared with the standalone static build, without a Next router. */}
        <a className="brand" href="./" aria-label="Astra, accueil">
          <Orbit size={27} />
          <span>
            ASTRA<span className="brand-dot">.</span>
          </span>
          <span className="brand-caption">OBSERVATOIRE INTERACTIF</span>
        </a>
        <div className="top-right">
          <span className="live">
            <i /> SIMULATION EN DIRECT
          </span>
          <span className="edition">EXP. 001</span>
        </div>
      </header>
      <section className="intro chrome">
        <div className="eyebrow">
          <span /> AU-DELÀ DU VISIBLE
        </div>
        <h1>
          Un univers.
          <br />
          <em>À portée de main.</em>
        </h1>
        <p>
          Explorez le mouvement des étoiles.
          <br />
          Une impulsion suffit à tout changer.
        </p>
        <div className="coordinates">
          RA 00h 42m 44s <span> / </span> DEC +41° 16′ 09″
        </div>
      </section>
      <section className="body-inspector" aria-label="Astre sélectionné">
        <div className="body-identity">
          <Crosshair size={16} />
          <div>
            <span className="eyebrow">
              {selected ? selected.kind : 'EXPLORATION LIBRE'}
            </span>
            <strong>
              {selected ? selected.name : 'Chaque point est un monde'}
            </strong>
          </div>
        </div>
        <p>
          {selected
            ? `${selected.systemName} · ${selected.parentId === null ? 'Étoile centrale' : selected.kind === 'Satellite rocheux' ? 'Satellite de AST-' + String(selected.parentId + 1).padStart(6, '0') : 'Orbite autour de l’étoile'}`
            : 'Sélectionnez un point, puis explorez sa surface.'}
        </p>
        <div className="body-actions">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Astre précédent"
            onClick={() => engine.current?.nextBody(-1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            className="inspect-button"
            onClick={() => engine.current?.approach()}
          >
            {selected ? 'Explorer cet astre' : 'Découvrir un astre'}
            <ArrowUpRight size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Astre suivant"
            onClick={() => engine.current?.nextBody(1)}
          >
            <ChevronRight />
          </Button>
        </div>
        {selected && (
          <div className="surface-camera-controls">
            <label id="tilt-label">
              Inclinaison{' '}
              <span>{tilt === null ? 'Auto · 60° max' : `${tilt}° max`}</span>
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
              <button onClick={() => setTilt(0)}>Vue verticale</button>
              <button
                aria-pressed={tilt === null}
                onClick={() => setTilt(null)}
              >
                Automatique
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
            Système stellaire
          </Button>
          {selected && selected.parentId !== null && (
            <Button
              variant="ghost"
              onClick={() => engine.current?.frameSystem('local')}
            >
              Planète et satellites
            </Button>
          )}
        </div>
        {systemView && (
          <output className="system-caption">
            Vue de {systemView.root.name} · {systemView.members.length} astres ·
            Cliquez sur un repère pour explorer
          </output>
        )}
        {systemView && (
          <details className="system-members">
            <summary>Voir les {systemView.members.length} astres</summary>
            <div>
              {systemView.members.map((body) => (
                <button
                  key={body.id}
                  onClick={() => engine.current?.inspectBody(body.id)}
                >
                  {body.name} · {body.kind}
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
            Retour à la galaxie
          </Button>
        )}
      </section>
      <aside
        className={`control-panel chrome ${panel ? '' : 'collapsed'}`}
        aria-label="Paramètres de la galaxie"
      >
        <div className="panel-heading">
          <div>
            <span className="eyebrow">VOTRE UNIVERS</span>
            <h2>Paramètres orbitaux</h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Masquer les paramètres"
            onClick={() => setPanel(false)}
          >
            <X />
          </Button>
        </div>
        <div className="control">
          <div className="control-label">
            <span id="density-label">Densité stellaire</span>
            <output>{new Intl.NumberFormat('fr-FR').format(density)}</output>
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
            <span>Éparse</span>
            <span>Dense</span>
          </div>
        </div>
        <div className="control">
          <div className="control-label">
            <span id="speed-label">Vitesse de rotation</span>
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
            <span>Immobile</span>
            <span>Rapide</span>
          </div>
        </div>
        <div className="setting-toggle">
          <span id="waves-label">Ondes gravitationnelles</span>
          <Switch
            aria-labelledby="waves-label"
            checked={wavesEnabled}
            onCheckedChange={setWavesEnabled}
          />
        </div>
        <div className="control">
          <div className="control-label">
            <span id="gravity-label">Puissance gravitationnelle</span>
            <output>
              {gravity.toFixed(1)}
              <small> ×</small>
            </output>
          </div>
          <Slider
            aria-labelledby="gravity-label"
            disabled={!wavesEnabled}
            min={0.2}
            max={4}
            step={0.1}
            value={[gravity]}
            onValueChange={(v) => setGravity(Array.isArray(v) ? v[0] : v)}
          />
          <div className="scale">
            <span>Subtile</span>
            <span>Intense</span>
          </div>
        </div>
        <div className="palette-row">
          <span>Spectre lumineux</span>
          <div className="palettes">
            {['Boréal', 'Supernova', 'Émeraude'].map((name, i) => (
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
          className="pulse-button"
          disabled={!ready || !!error || !wavesEnabled}
          onClick={() => engine.current?.pulse()}
        >
          <Radio size={17} />
          Créer une onde
          <ArrowUpRight size={16} />
        </Button>
        <div className="panel-footer">
          <span>
            <i /> {paused ? 'Rotation suspendue' : 'Système en équilibre'}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Réinitialiser les paramètres"
            title="Réinitialiser"
            onClick={reset}
          >
            <RotateCcw size={14} />
          </Button>
        </div>
      </aside>
      {!panel && (
        <Button
          className="reopen chrome"
          variant="outline"
          onClick={() => setPanel(true)}
        >
          <SlidersHorizontal /> Paramètres
        </Button>
      )}
      <div className="bottom-hint chrome">
        <span className="mouse-icon" />
        <span>
          {wavesEnabled
            ? 'Clic : sélectionner · Maj + clic : onde'
            : 'Clic : sélectionner · Ondes désactivées'}
        </span>
        <span className="hint-divider" />
        <span className="secondary-hint">Molette ou pincement pour zoomer</span>
      </div>
      <footer className="bottom-bar chrome">
        <div className="telemetry">
          <span>
            <b>{new Intl.NumberFormat('fr-FR').format(density)}</b> PARTICULES
          </span>
          <span className="telemetry-line" />
          <span>
            <b>{String(waves).padStart(2, '0')}</b> IMPULSIONS
          </span>
        </div>
        <span className="footer-note">L’INFINI COMMENCE ICI</span>
      </footer>
      <section className="sound-controls" aria-label="Ambiance sonore">
        <Button
          variant="ghost"
          className="music-button"
          aria-label={
            musicEnabled ? 'Désactiver la musique' : 'Activer la musique'
          }
          aria-pressed={musicEnabled}
          disabled={musicBusy}
          onClick={() => void toggleMusic()}
        >
          {musicEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
          <span>
            {musicBusy
              ? 'Ouverture…'
              : musicEnabled
                ? 'Ambiance active'
                : 'Activer l’ambiance'}
          </span>
        </Button>
        {musicEnabled && (
          <div className="music-volume">
            <span id="music-volume-label" className="sr-only">
              Volume de la musique
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
      <div className="zoom-actions">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Dézoomer"
          onClick={() => engine.current?.zoom(1 / 1.5)}
        >
          <Minus />
        </Button>
        <span>ZOOM</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Zoomer"
          onClick={() => engine.current?.zoom(1.5)}
        >
          <Plus />
        </Button>
      </div>
      <div className="view-actions">
        <Button
          variant="ghost"
          size="icon"
          aria-label={
            paused ? 'Reprendre la rotation' : 'Suspendre la rotation'
          }
          title={paused ? 'Reprendre' : 'Pause'}
          onClick={() => setPaused((v) => !v)}
        >
          {paused ? <Play /> : <Pause />}
        </Button>
        <span />
        <Button
          variant="ghost"
          size="icon"
          aria-label={immersive ? 'Quitter le mode immersif' : 'Mode immersif'}
          title="Mode immersif · Échap pour quitter"
          onClick={() => setImmersive((v) => !v)}
        >
          {immersive ? <Minimize2 /> : <Maximize2 />}
        </Button>
      </div>
      {(!ready || error) && (
        <output className="loading">{error || 'Allumage des étoiles…'}</output>
      )}
    </main>
  );
}
