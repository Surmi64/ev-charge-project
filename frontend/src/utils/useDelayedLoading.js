import { useEffect, useRef, useState } from 'react';

/**
 * Decide whether a loading placeholder is worth showing at all.
 *
 * On a fast connection the data lands in a few tens of milliseconds, so a skeleton
 * rendered the instant loading starts appears and vanishes within one or two frames.
 * That flash reads as the page jolting, even though nothing moved — the skeleton and
 * the content occupy identical space.
 *
 * Two rules fix it:
 *   - wait `delay` before showing anything, so quick loads never flash a skeleton;
 *   - once shown, keep it for at least `minVisible`, so a slow load that finishes
 *     just after the delay does not flash it away either.
 *
 * @param {boolean} loading  whether the request is still in flight
 * @returns {boolean} whether to render the placeholder
 */
export function useDelayedLoading(loading, { delay = 220, minVisible = 320 } = {}) {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef(0);
  const visibleRef = useRef(false);

  useEffect(() => {
    let timer;

    if (loading) {
      timer = setTimeout(() => {
        shownAt.current = Date.now();
        visibleRef.current = true;
        setVisible(true);
      }, delay);
    } else if (visibleRef.current) {
      const remaining = Math.max(0, minVisible - (Date.now() - shownAt.current));
      timer = setTimeout(() => {
        visibleRef.current = false;
        setVisible(false);
      }, remaining);
    }

    return () => clearTimeout(timer);
  }, [loading, delay, minVisible]);

  return visible;
}
