import { useEffect, useState } from 'react';

/**
 * The few site settings the sign-in screens need before anyone has signed in.
 *
 * Plain fetch rather than apiFetch: the endpoint is unauthenticated, and apiFetch
 * would attach a stale token and try a refresh on 401, which on these pages means
 * signing out whoever is already logged in.
 *
 * Failure is deliberately silent and falls back to the permissive answer. A settings
 * lookup that cannot complete must not be what stops someone signing in.
 */
export const useSiteConfig = () => {
  const [config, setConfig] = useState({ registration_open: true, maintenance_notice: '', loaded: false });

  useEffect(() => {
    let active = true;
    fetch('/api/site/config')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) setConfig({ ...data, loaded: true });
        else if (active) setConfig((previous) => ({ ...previous, loaded: true }));
      })
      .catch(() => { if (active) setConfig((previous) => ({ ...previous, loaded: true })); });
    return () => { active = false; };
  }, []);

  return config;
};
