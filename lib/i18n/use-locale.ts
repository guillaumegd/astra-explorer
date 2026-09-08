'use client';

import { useEffect, useState } from 'react';
import { dictionaries, resolveInitialLocale, storeLocale } from './index';
import type { Locale } from './types';

// This app has no server-rendered markup to match (the deployed build mounts
// into an empty <div id="root">), so the locale is resolved synchronously on
// the very first render instead of detected after mount. A post-mount swap
// left a brief but real window where the page rendered in the fallback
// language with <html lang="en">, which is exactly what browsers' translate
// prompts key off — they don't re-evaluate once the correct language renders
// a moment later.
export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>(() =>
    resolveInitialLocale(),
  );
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
