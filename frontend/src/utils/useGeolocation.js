import { useCallback, useState } from 'react';

/**
 * One-shot location capture, with the failures spelled out.
 *
 * The hook never fires on its own. `navigator.geolocation.getCurrentPosition` shows the
 * browser's own permission prompt the first time it is called, and firing that at
 * someone who opened the dialog to type up a receipt from last week is both useless
 * and slightly alarming — dismissed once, the permission stays dismissed.
 *
 * LocationField does call `locate` on open for a new record, but only after asking the
 * Permissions API whether the answer is already 'granted', so opening a form can never
 * be what raises the prompt. Until then it takes a press.
 *
 * The reasons are separated because they need different answers from the user. A denied
 * permission is fixed in the browser's site settings, an insecure origin cannot be fixed
 * by the user at all, and a timeout just wants pressing again — telling all three
 * "location unavailable" would be useless in every case.
 */

// Wait this long for a fix before giving up. Long enough for a cold GPS start on a
// phone, short enough that a button that has visibly been "locating…" for this long is
// not going to succeed.
const TIMEOUT_MS = 15000;

// Nothing older than this: standing at a petrol station, a fix from two minutes ago is
// still where you are, but yesterday's cached position is not.
const MAX_AGE_MS = 120000;

// Above this the fix is honest about being vague. Shown as a warning rather than
// rejected — a 300 m fix still says which town, and the server decides on its own
// whether it is good enough to name a place.
export const VAGUE_ACCURACY_M = 250;

export const isGeolocationAvailable = () => (
  typeof navigator !== 'undefined'
  && 'geolocation' in navigator
  // Secure context, which for geolocation means HTTPS or localhost. Checking up front
  // matters because Chrome rejects the call with the same PERMISSION_DENIED it uses for
  // a real refusal, and telling someone to check their browser settings when the actual
  // problem is a plain-HTTP origin sends them somewhere they cannot fix it.
  && typeof window !== 'undefined' && window.isSecureContext
);

export const useGeolocation = () => {
  const [position, setPosition] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);

  const clear = useCallback(() => {
    setPosition(null);
    setStatus('idle');
    setError(null);
  }, []);

  const locate = useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setStatus('error');
      setError('This browser cannot report a location.');
      return;
    }
    if (!window.isSecureContext) {
      setStatus('error');
      setError('Location needs a secure (HTTPS) connection. This page is served over plain HTTP, so the browser will not allow it.');
      return;
    }

    setStatus('locating');
    setError(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setPosition({
          latitude: Number(coords.latitude.toFixed(6)),
          longitude: Number(coords.longitude.toFixed(6)),
          accuracy_m: coords.accuracy != null ? Math.round(coords.accuracy) : null,
        });
        setStatus('ready');
      },
      (failure) => {
        setStatus('error');
        if (failure.code === failure.PERMISSION_DENIED) {
          setError('Location permission was declined. You can allow it in your browser’s site settings, or just type the name instead.');
        } else if (failure.code === failure.POSITION_UNAVAILABLE) {
          setError('No position could be determined — this often means no GPS or network fix indoors.');
        } else {
          setError('Locating timed out. Try again, or type the name instead.');
        }
      },
      { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: MAX_AGE_MS },
    );
  }, []);

  return { position, setPosition, status, error, locate, clear };
};
