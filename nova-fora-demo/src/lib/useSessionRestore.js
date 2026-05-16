/**
 * useSessionRestore — sessionStorage-backed snapshot for in-flight wizards.
 *
 * Why this exists: Android Chrome (and to a lesser degree iOS Safari)
 * may evict a tab from RAM when the OS launches a separate intent like
 * the camera. Coming back from the camera means the WebView re-mounts
 * fresh — React state is gone, the user lands on whatever the App's
 * default route renders (typically the home dashboard). Reported by a
 * Pixel-class Android tester on 2026-05-15: "after taking the odometer
 * photo me saca de la app".
 *
 * The fix: persist the wizard's user-journey state to sessionStorage on
 * every meaningful change. On mount, read the snapshot back. If it's
 * present and recent, restore the wizard exactly where it was so the
 * eviction is invisible to the user.
 *
 * sessionStorage (vs localStorage):
 *   - Scoped to the tab / window — closing the tab wipes it. Cross-tab
 *     isolation is automatic (no two-tab "you stole my inspection"
 *     surprises).
 *   - Survives page reload + camera intent + WebView eviction.
 *
 * Usage pattern:
 *
 *   const session = useSessionRestore('nf-inspection-wizard', { ttlMs: 6h });
 *   const initial = session.read();
 *   const [step, setStep] = useState(initial?.step ?? 1);
 *   ...
 *   // Save snapshot whenever persistable state changes:
 *   useEffect(() => {
 *     session.write({ step, dsp, vehicle, ... });
 *   }, [step, dsp, vehicle]);
 *   // Clear when the wizard finishes or is intentionally abandoned:
 *   const onComplete = () => { session.clear(); ... };
 */
import { useMemo } from 'react';

const NOW = () => Date.now();

export function useSessionRestore(storageKey, opts = {}) {
  const ttlMs = opts.ttlMs ?? 6 * 60 * 60 * 1000;  // 6 h default

  return useMemo(() => ({
    read() {
      try {
        if (typeof window === 'undefined' || !window.sessionStorage) return null;
        const raw = window.sessionStorage.getItem(storageKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        // Stale snapshots get nuked — protects against a user that
        // walked away mid-inspection yesterday and came back today.
        if (parsed?.savedAt && NOW() - parsed.savedAt > ttlMs) {
          window.sessionStorage.removeItem(storageKey);
          return null;
        }
        return parsed?.data ?? null;
      } catch (err) {
        // Quota exceeded, JSON malformed, sessionStorage disabled (private
        // mode on some browsers) — silently fall through to a fresh state
        // rather than crash the wizard.
        // eslint-disable-next-line no-console
        console.warn(`[useSessionRestore] read failed for ${storageKey}:`, err);
        return null;
      }
    },
    write(data) {
      try {
        if (typeof window === 'undefined' || !window.sessionStorage) return;
        const envelope = { savedAt: NOW(), data };
        window.sessionStorage.setItem(storageKey, JSON.stringify(envelope));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[useSessionRestore] write failed for ${storageKey}:`, err);
      }
    },
    clear() {
      try {
        if (typeof window === 'undefined' || !window.sessionStorage) return;
        window.sessionStorage.removeItem(storageKey);
      } catch {
        // best-effort
      }
    },
  }), [storageKey, ttlMs]);
}
