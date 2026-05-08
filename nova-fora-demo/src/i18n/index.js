/**
 * i18n initialization for Nova Fora.
 *
 * Strategy:
 *   - Default language: es (Latin American Spanish, neutral — "tú" form,
 *     "vehículo" / "computadora" / "celular" / "teléfono móvil").
 *   - Fallback: en (US English).
 *   - Detection order: localStorage → browser → default.
 *   - Persistence: localStorage on every change (key `nf-lang`). Authenticated
 *     users also sync to `User.language` via PATCH /auth/me/language so the
 *     preference follows them across devices. The auth bootstrap in App.jsx
 *     calls `i18n.changeLanguage(user.language)` after /auth/me succeeds.
 *   - Namespaces: split by feature so we can lazy-load later if bundles get
 *     heavy. For MVP everything ships in one chunk.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enCommon  from './locales/en/common.json';
import enAuth    from './locales/en/auth.json';
import enLayout  from './locales/en/layout.json';
import enWizard  from './locales/en/wizard.json';
import enFleet   from './locales/en/fleet.json';
import enAdmin   from './locales/en/admin.json';
import enDash    from './locales/en/dashboard.json';

import esCommon  from './locales/es/common.json';
import esAuth    from './locales/es/auth.json';
import esLayout  from './locales/es/layout.json';
import esWizard  from './locales/es/wizard.json';
import esFleet   from './locales/es/fleet.json';
import esAdmin   from './locales/es/admin.json';
import esDash    from './locales/es/dashboard.json';


export const SUPPORTED_LANGUAGES = [
  { code: 'es', shortCode: 'ES', label: 'Español', flag: '🇲🇽', nativeLabel: 'Español' },
  { code: 'en', shortCode: 'EN', label: 'English', flag: '🇺🇸', nativeLabel: 'English' },
];

export const NAMESPACES = ['common', 'auth', 'layout', 'wizard', 'fleet', 'admin', 'dashboard'];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['es', 'en'],
    // Lock to the base language — the codes are 'es' (any LATAM variant) /
    // 'en' (US). User-stored values like 'es-MX' or 'en-US' resolve to these
    // bases automatically.
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',

    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'nf-lang',
    },

    ns: NAMESPACES,
    defaultNS: 'common',

    resources: {
      en: {
        common:    enCommon,
        auth:      enAuth,
        layout:    enLayout,
        wizard:    enWizard,
        fleet:     enFleet,
        admin:     enAdmin,
        dashboard: enDash,
      },
      es: {
        common:    esCommon,
        auth:      esAuth,
        layout:    esLayout,
        wizard:    esWizard,
        fleet:     esFleet,
        admin:     esAdmin,
        dashboard: esDash,
      },
    },

    interpolation: {
      escapeValue: false,  // React already escapes
    },

    react: {
      useSuspense: false,  // resources are bundled, no async load
    },
  });


/**
 * Change language + sync to localStorage. The /auth/me/language PATCH is
 * fired separately by the toggle UI (RoleSwitcher) when the user is logged
 * in — we don't do it here because i18n can be called pre-auth (login page).
 *
 * Side effect: bust the catalog/DVIC caches in api/client so the next fetch
 * pulls localized labels from the backend instead of serving stale text.
 * We import lazily to avoid a circular import (api/client imports nothing
 * from i18n at module load time).
 */
export async function setLanguage(lang) {
  if (!['es', 'en'].includes(lang)) return;
  localStorage.setItem('nf-lang', lang);
  try {
    const { catalog, dvicTemplate } = await import('../api/client.js');
    catalog?.invalidate?.();
    dvicTemplate?.invalidate?.();
  } catch {
    // api/client may not be loaded yet — pre-auth contexts have no cache.
  }
  return i18n.changeLanguage(lang);
}


/** Current 2-letter language code (es | en). */
export function getLanguage() {
  return (i18n.resolvedLanguage || i18n.language || 'es').slice(0, 2);
}


/**
 * Locale-aware date formatter. Always pass a Date or ISO string — never
 * rely on `.toLocaleDateString()` without options or it picks up the user's
 * OS locale instead of the app preference.
 */
export function formatDate(value, opts = { dateStyle: 'medium' }) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '';
  const lang = getLanguage();
  const tag = lang === 'es' ? 'es-MX' : 'en-US';
  return new Intl.DateTimeFormat(tag, opts).format(d);
}


export function formatDateTime(value, opts = { dateStyle: 'medium', timeStyle: 'short' }) {
  return formatDate(value, opts);
}


export function formatNumber(value, opts = {}) {
  if (value == null || isNaN(value)) return '';
  const lang = getLanguage();
  const tag = lang === 'es' ? 'es-MX' : 'en-US';
  return new Intl.NumberFormat(tag, opts).format(value);
}


export default i18n;
