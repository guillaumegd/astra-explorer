'use client';

import { useEffect, useRef, useState } from 'react';
import { Orbit, Volume2, VolumeX } from 'lucide-react';
import {
  OPENING_DURATION,
  openingCues,
  sampleOpening,
} from '@/lib/opening-sequence';
import { createOpeningAudio, type OpeningAudio } from '@/lib/opening-audio';
import type { Dictionary } from '@/lib/i18n/types';

type Props = {
  ready: boolean;
  copy: Dictionary['opening'];
  muted: boolean;
  muteLabel: string;
  unmuteLabel: string;
  onToggleMute: () => void;
  onStart: () => void;
  onReveal: (seconds?: number) => void;
  onProgress: (progress: number | null) => void;
  onFinish: () => void;
};

export function CinematicIntro({
  ready,
  copy,
  muted,
  muteLabel,
  unmuteLabel,
  onToggleMute,
  onStart,
  onReveal,
  onProgress,
  onFinish,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const audio = useRef<OpeningAudio | null>(null);
  const [started, setStarted] = useState(false);
  const current = useRef({
    ready,
    started,
    muted,
    onStart,
    onReveal,
    onProgress,
    onFinish,
  });
  useEffect(() => {
    current.current = {
      ready,
      started,
      muted,
      onStart,
      onReveal,
      onProgress,
      onFinish,
    };
  });

  useEffect(() => {
    audio.current?.setMuted(muted);
  }, [muted]);

  // The sound is built here rather than on mount: browsers only let an audio
  // context run when it is opened from a gesture, and this click is that gesture.
  const begin = () => {
    audio.current = createOpeningAudio();
    audio.current?.setMuted(muted);
    onStart();
    setStarted(true);
  };

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const host = element.parentElement!;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const letters = element.querySelectorAll<HTMLElement>('.opening-letter');
    const logo = element.querySelector<HTMLElement>('.opening-logo');
    const cues = openingCues(motion.matches);
    const played = new Set<string>();
    let elapsed = 0;
    let previous = performance.now();
    let frame = 0;
    let finished = false;
    let visible = !document.hidden;
    // No skip: the sequence always runs to completion, so "seen" is only ever
    // recorded for a visitor who actually watched it (see onFinish below).
    const finish = () => {
      finished = true;
      host.style.setProperty('--opening-chrome', '1');
      current.current.onProgress(null);
      current.current.onFinish();
    };
    const cue = (name: string, at: number, play: () => void) => {
      if (elapsed < at || played.has(name)) return;
      played.add(name);
      play();
    };
    const visibility = () => {
      visible = !document.hidden;
      previous = performance.now();
      audio.current?.setAwake(visible);
    };
    const animate = (now: number) => {
      if (finished) return;
      const dt = Math.max(0, now - previous);
      previous = now;
      if (current.current.started && current.current.ready && visible) {
        elapsed = Math.min(OPENING_DURATION, elapsed + dt);
        const state = sampleOpening(elapsed, motion.matches);
        element.dataset.elapsed = String(Math.round(elapsed));
        element.dataset.reducedMotion = String(motion.matches);
        if (logo) {
          const opacity = state.letters[0];
          logo.style.opacity = String(opacity);
          logo.style.filter = motion.matches
            ? 'none'
            : `blur(${(1 - opacity) * 2.5}px)`;
        }
        letters.forEach((letter, index) => {
          const opacity = state.letters[index + 1];
          letter.style.opacity = String(opacity);
          letter.style.filter = motion.matches
            ? 'none'
            : `blur(${(1 - opacity) * 2.5}px)`;
        });
        element.style.setProperty(
          '--opening-invitation',
          String(state.invitation),
        );
        element.style.setProperty('--opening-credit', String(state.credit));
        element.style.setProperty('--opening-reveal', String(state.reveal));
        element.style.setProperty(
          '--opening-aperture',
          `${state.reveal * 170}%`,
        );
        host.style.setProperty('--opening-chrome', String(state.chrome));
        const sound = audio.current;
        // Consume muted cues so restoring sound never replays missed effects.
        if (sound) {
          cues.letters.forEach((at, index) =>
            cue(`letter-${index}`, at, () => {
              if (!current.current.muted) sound.tick(index);
            }),
          );
          cue('invitation', cues.invitation, () => {
            if (!current.current.muted) sound.breath('invitation');
          });
          cue('credit', cues.credit, () => {
            if (!current.current.muted) sound.breath('credit');
          });
          cue('hold', cues.hold, () => {
            if (!current.current.muted) sound.drone(cues.holdDuration);
          });
        }
        cue('reveal', cues.reveal, () => {
          current.current.onReveal(1.5);
          if (current.current.muted) return;
          sound?.shimmer(cues.revealDuration);
          sound?.flight(cues.flightDuration);
        });
        current.current.onProgress(state.camera);
        if (elapsed >= OPENING_DURATION) {
          finish();
          return;
        }
      }
      frame = requestAnimationFrame(animate);
    };
    document.addEventListener('visibilitychange', visibility);
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', visibility);
      current.current.onProgress(null);
      host.style.removeProperty('--opening-chrome');
      audio.current?.dispose();
      audio.current = null;
    };
  }, []);

  return (
    <div ref={root} className="cinematic-opening" data-elapsed="0">
      <div className="opening-veil" aria-hidden="true" />
      <div className="opening-copy">
        <h1 className="opening-title" aria-label="ASTRA">
          <Orbit className="opening-logo" aria-hidden="true" />
          {'ASTRA'.split('').map((letter, index) => (
            <span className="opening-letter" aria-hidden="true" key={index}>
              {letter}
            </span>
          ))}
        </h1>
        <p className="opening-invitation">{copy.invitation}</p>
        <p className="opening-credit">
          <span>{copy.credit}</span>{' '}
          <span className="opening-author">Guillaume Girard</span>
        </p>
      </div>
      {/* The one control reachable throughout: on the gate and through playback. */}
      <button
        type="button"
        className="opening-mute"
        aria-label={muted ? unmuteLabel : muteLabel}
        aria-pressed={muted}
        onClick={onToggleMute}
      >
        {muted ? (
          <VolumeX aria-hidden="true" />
        ) : (
          <Volume2 aria-hidden="true" />
        )}
      </button>
      {/* Kept mounted once opened so it can fade rather than cut. */}
      <div
        className="opening-gate"
        data-open={!started || undefined}
        inert={started}
      >
        <button
          type="button"
          className="opening-start"
          disabled={!ready}
          onClick={() => begin()}
        >
          <Orbit aria-hidden="true" />
          <span>{ready ? copy.start : copy.preparing}</span>
        </button>
      </div>
    </div>
  );
}
