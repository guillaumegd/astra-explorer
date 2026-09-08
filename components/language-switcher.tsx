'use client';

import { Select as SelectPrimitive } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { locales, localeNames, type Locale } from '@/lib/i18n';

// Language codes shown on the closed trigger, distinct from localeNames
// (the native names used inside the open list).
const localeCodes: Record<Locale, string> = {
  en: 'EN',
  fr: 'FR',
  es: 'ES',
  'pt-PT': 'PT',
};

export function LanguageSwitcher({
  locale,
  onChange,
  label,
}: {
  locale: Locale;
  onChange: (locale: Locale) => void;
  label: string;
}) {
  return (
    <SelectPrimitive.Root
      items={locales.map((code) => ({ value: code, label: localeNames[code] }))}
      value={locale}
      onValueChange={(value) => onChange(value as Locale)}
    >
      <SelectPrimitive.Trigger className="language-switcher" aria-label={label}>
        <SelectPrimitive.Value>{() => localeCodes[locale]}</SelectPrimitive.Value>
        <SelectPrimitive.Icon className="language-switcher-icon">
          <ChevronDown size={11} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          className="language-switcher-positioner"
          sideOffset={10}
          align="end"
        >
          <SelectPrimitive.Popup className="language-switcher-popup">
            <SelectPrimitive.List>
              {locales.map((code) => (
                <SelectPrimitive.Item
                  key={code}
                  value={code}
                  className="language-switcher-item"
                >
                  <SelectPrimitive.ItemText>
                    {localeNames[code]}
                  </SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="language-switcher-check">
                    <Check size={13} />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
