import { useEffect, useState } from 'react';

/**
 * Drop-in `useState` replacement that mirrors the value to
 * `localStorage` keyed by `key`. Reads happen lazily *once* on
 * mount via the initialiser form so we never render the default
 * for a tick before the persisted value swaps in (avoids the
 * dropdown-flicker problem). Writes happen in an effect to keep
 * the render path pure.
 *
 * Failure modes (LS quota, private mode, JSON parse) all degrade
 * silently to the in-memory default — the component must not
 * throw because the user picked Safari Private and we tried to
 * persist a number.
 */
export function usePersistedState<T>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Quota exceeded / disabled storage. Nothing actionable —
      // the value lives in memory for the rest of the session.
    }
  }, [key, value]);

  return [value, setValue];
}
