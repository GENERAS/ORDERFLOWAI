import { useCallback, useSyncExternalStore } from 'react';

/**
 * Subscribe to a CSS media query without layout thrashing or effect loops.
 */
export function useMediaQuery(query) {
  const subscribe = useCallback(
    (onChange) => {
      const mediaQueryList = window.matchMedia(query);
      mediaQueryList.addEventListener('change', onChange);
      return () => mediaQueryList.removeEventListener('change', onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
