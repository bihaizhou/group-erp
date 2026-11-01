import { useEffect, useState } from 'react';

/**
 * Holds a value back until it stops changing, so typing costs one request
 * instead of one per keystroke. `delay` is in milliseconds.
 */
export function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
