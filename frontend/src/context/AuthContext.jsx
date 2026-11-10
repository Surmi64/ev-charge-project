import React, { useState, useEffect, useCallback, useMemo } from 'react';
import AuthContext from './auth-context';
import {
  apiFetch,
  clearStoredSession,
  endSession,
  getToken,
  mayHaveSession,
  onPaymentRequired,
  onSessionExpired,
  onWorkspaceInvalid,
  persistSession,
  refreshAccessToken,
  setWorkspace,
} from '../utils/api';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(getToken());
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState(null);
  const [workspace, setWorkspaceState] = useState(null);

  const clearSession = useCallback(() => {
    setUser(null);
    setToken(null);
    setSubscription(null);
    setWorkspaceState(null);
    clearStoredSession();
  }, []);

  // Whose records this tab is working on, and what the person may do there. Read
  // after sign-in and after every switch; a failure leaves the own-account default.
  const refreshWorkspace = useCallback(async () => {
    const res = await apiFetch('/api/fleet/context');
    if (!res.ok) {
      setWorkspaceState(null);
      return null;
    }
    const data = await res.json();
    setWorkspaceState(data);
    return data;
  }, []);

  // Every page holds data fetched for the old workspace, so a switch reloads rather
  // than trying to invalidate each one.
  const switchWorkspace = useCallback((ownerId) => {
    setWorkspace(ownerId);
    window.location.assign('/');
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

  // The fleet named in the header is gone (removed, or left elsewhere): api.js has
  // dropped the header, so re-read both and the app falls back to the own account.
  useEffect(() => {
    onWorkspaceInvalid(() => {
      refreshWorkspace().catch(() => {});
      refreshSubscription().catch(() => {});
    });
    return () => onWorkspaceInvalid(null);
  }, [refreshWorkspace, refreshSubscription]);

  // utils/api owns the refresh call (it single-flights it, because the endpoint
  // rotates the refresh token). This keeps React state in step when it gives up.
  useEffect(() => {
    onSessionExpired(() => {
      setUser(null);
      setToken(null);
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
    setUser(data.user);
    return data.access_token;
  }, [clearSession]);

  useEffect(() => {
    let active = true;

    const restoreSession = async () => {
      // The access token is held in memory only, so every page load starts without
      // one and asks the refresh cookie for a new one.
      if (!mayHaveSession()) {
        if (active) setLoading(false);
        return;
      }

      const refreshed = await refreshAuthToken();
      if (!refreshed) {
        if (active) setLoading(false);
        return;
      }

      // apiFetch retries through a refresh on its own if the access token expired.
      const res = await apiFetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (active) setUser(data);
        // Both before loading ends: in a fleet the overlay decides the currency and
        // whether onboarding shows, and a first frame without it would flash both.
        await Promise.all([
          refreshSubscription().catch(() => {}),
          refreshWorkspace().catch(() => {}),
        ]);
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
  }, [refreshAuthToken, clearSession, refreshSubscription, refreshWorkspace]);

  // Keyed on being signed in, not on the user object, which every refresh replaces.
  const signedIn = Boolean(user);
  useEffect(() => {
    if (!signedIn) return undefined;

    const intervalId = window.setInterval(() => {
      refreshAuthToken().catch(() => clearSession());
    }, 10 * 60 * 1000);

    return () => window.clearInterval(intervalId);
  }, [signedIn, refreshAuthToken, clearSession]);

  // The refresh token arrived as a cookie with the same response; only the access
  // token is handed over here.
  const login = (userData, accessToken) => {
    setUser(userData);
    setToken(accessToken);
    persistSession(accessToken);
    refreshSubscription().catch(() => {});
    refreshWorkspace().catch(() => {});
  };

  const updateUser = (newUserData) => {
    setUser((prev) => ({ ...prev, ...newUserData }));
  };

  const logout = async () => {
    await endSession();
    clearSession();
  };

  // In a fleet workspace the records are the owner's, so the settings they are read
  // through — currency, units, what cost per km counts — are the owner's too. `user`
  // carries them overlaid for every formatter and chart; `account` is the person's
  // own row, for the pages that edit it.
  const viewUser = useMemo(() => (
    user && workspace?.preferences ? { ...user, ...workspace.preferences } : user
  ), [user, workspace]);

  return (
    <AuthContext.Provider
      value={{
        user: viewUser,
        account: user,
        workspace,
        refreshWorkspace,
        switchWorkspace,
        inFleetWorkspace: Boolean(workspace && !workspace.is_own),
        canManage: workspace ? workspace.can_manage : true,
        token,
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
