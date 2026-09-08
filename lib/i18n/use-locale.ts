'use client';

import { useEffect, useState } from 'react';
import {
  defaultLocale,
  dictionaries,
  resolveInitialLocale,
  storeLocale,
} from './index';
import type { Locale } from './types';

// Starts on the fixed fallback so server and first client render always
// match, then swaps to the stored or browser-detected locale once mounted.
export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);
  useEffect(() => {
    queueMicrotask(() => {
      const resolved = resolveInitialLocale();
      if (resolved !== defaultLocale) setLocaleState(resolved);
    });
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = dictionaries[locale].meta.title;
  }, [locale]);
  const setLocale = (next: Locale) => {
    storeLocale(next);
    setLocaleState(next);
  };
  return { locale, setLocale, t: dictionaries[locale] };
}
