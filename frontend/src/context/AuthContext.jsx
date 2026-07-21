import React, { useState, useEffect, useCallback } from 'react';
import AuthContext from './auth-context';
import {
  apiFetch,
  clearStoredSession,
  getRefreshToken,
  getToken,
  onPaymentRequired,
  onSessionExpired,
  persistSession,
  refreshAccessToken,
} from '../utils/api';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(getToken());
  const [refreshToken, setRefreshToken] = useState(getRefreshToken());
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState(null);

  const clearSession = useCallback(() => {
    setUser(null);
    setToken(null);
    setRefreshToken(null);
    setSubscription(null);
    clearStoredSession();
  }, []);

  const refreshSubscription = useCallback(async () => {
    const res = await apiFetch('/api/billing/me');
    if (!res.ok) return null;
    const data = await res.json();
    setSubscription(data);
    return data;
  }, []);

  // A 402 means the server rejected a write because the plan lapsed. Re-read the
  // subscription so the banner and the read-only state catch up immediately.
  useEffect(() => {
    onPaymentRequired(() => {
      refreshSubscription().catch(() => {});
    });
    return () => onPaymentRequired(null);
  }, [refreshSubscription]);

  // utils/api owns the refresh call (it single-flights it, because the endpoint
  // rotates the refresh token). This keeps React state in step when it gives up.
  useEffect(() => {
    onSessionExpired(() => {
      setUser(null);
      setToken(null);
      setRefreshToken(null);
    });
    return () => onSessionExpired(null);
  }, []);

  const refreshAuthToken = useCallback(async () => {
    const data = await refreshAccessToken();
    if (!data) {
      clearSession();
      return null;
    }
    setToken(data.access_token);
    setRefreshToken(data.refresh_token);
    setUser(data.user);
    return data.access_token;
  }, [clearSession]);

  useEffect(() => {
    let active = true;

    const restoreSession = async () => {
      if (!getToken() && !getRefreshToken()) {
        if (active) setLoading(false);
        return;
      }

      if (!getToken() && getRefreshToken()) {
        const refreshed = await refreshAuthToken();
        if (!refreshed) {
          if (active) setLoading(false);
          return;
        }
      }

      // apiFetch retries through a refresh on its own if the access token expired.
      const res = await apiFetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (active) setUser(data);
        await refreshSubscription().catch(() => {});
      } else {
        clearSession();
      }

      if (active) setLoading(false);
    };

    restoreSession().catch(() => {
      clearSession();
      if (active) setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [refreshAuthToken, clearSession, refreshSubscription]);

  useEffect(() => {
    if (!refreshToken) return undefined;

    const intervalId = window.setInterval(() => {
      refreshAuthToken().catch(() => clearSession());
    }, 10 * 60 * 1000);

    return () => window.clearInterval(intervalId);
  }, [refreshToken, refreshAuthToken, clearSession]);

  const login = (userData, accessToken, nextRefreshToken) => {
    setUser(userData);
    setToken(accessToken);
    setRefreshToken(nextRefreshToken);
    persistSession(accessToken, nextRefreshToken);
    refreshSubscription().catch(() => {});
  };

  const updateUser = (newUserData) => {
    setUser((prev) => ({ ...prev, ...newUserData }));
  };

  const logout = async () => {
    const currentRefreshToken = getRefreshToken();
    if (currentRefreshToken) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: currentRefreshToken }),
        });
      } catch {
        // Best effort logout; the local session is cleared either way.
      }
    }
    clearSession();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        refreshToken,
        login,
        logout,
        updateUser,
        refreshAuthToken,
        subscription,
        refreshSubscription,
        canWrite: subscription ? subscription.can_write : true,
        authenticated: !!user,
        loading,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
