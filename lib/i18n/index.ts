import { en } from './locales/en';
import { fr } from './locales/fr';
import { es } from './locales/es';
import { ptPT } from './locales/pt-PT';
import type { Dictionary, Locale } from './types';

export type { Dictionary, Locale };

export const defaultLocale: Locale = 'en';

export const locales: Locale[] = ['en', 'fr', 'es', 'pt-PT'];

export const dictionaries: Record<Locale, Dictionary> = {
  en,
  fr,
  es,
  'pt-PT': ptPT,
};

// Native, self-referential names — a French speaker looks for "Français",
// not "French".
export const localeNames: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
  'pt-PT': 'Português',
};

// Matches Intl.NumberFormat's own locale identifiers, not our internal codes.
const numberFormatLocale: Record<Locale, string> = {
  en: 'en-US',
  fr: 'fr-FR',
  es: 'es-ES',
  'pt-PT': 'pt-PT',
};

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(numberFormatLocale[locale]).format(value);
}

const STORAGE_KEY = 'astra-locale';

function matchBrowserTag(tag: string): Locale | null {
  const primary = tag.toLowerCase().split('-')[0];
  if (primary === 'pt') return 'pt-PT';
  const found = locales.find((locale) => locale.toLowerCase() === primary);
  return found ?? null;
}

export function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return defaultLocale;
  const candidates = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
  for (const tag of candidates) {
    const match = matchBrowserTag(tag);
    if (match) return match;
  }
  return defaultLocale;
}

export function loadStoredLocale(): Locale | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored && (locales as string[]).includes(stored)
      ? (stored as Locale)
      : null;
  } catch {
    return null;
  }
}

export function storeLocale(locale: Locale) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Private browsing or storage disabled: the choice just won't persist.
  }
}

// Resolves a real preference on the client only: a stored choice first, then
// the browser's own language list, falling back to English.
export function resolveInitialLocale(): Locale {
  return loadStoredLocale() ?? detectLocale();
}
