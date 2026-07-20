import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from 'react';
import { translations, type Language, getNestedValue } from './translations';

const STORAGE_KEY = 'tavern-card-helper-lang';

function detectDefaultLanguage(): Language {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && saved in translations) return saved as Language;
  } catch {
    // localStorage unavailable (e.g. SSR or privacy mode)
  }
  return 'zh';
}

export interface I18nContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string, params?: Record<string, string>) => string;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => detectDefaultLanguage());

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, lang);
  }, [lang]);

  const setLang = useCallback((next: Language) => {
    setLangState(next);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string>) => {
      const value = getNestedValue(((translations as unknown as Record<string, unknown>)[lang] ?? translations.zh) as unknown as Record<string, unknown>, key);
      let result = value ?? key;
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          result = result.replaceAll(`{{${k}}}`, v);
        });
      }
      return result;
    },
    [lang],
  );

  const value = useMemo(
    () => ({ lang, setLang, t }),
    [lang, setLang, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useTranslation must be used within I18nProvider');
  }
  return ctx;
}
