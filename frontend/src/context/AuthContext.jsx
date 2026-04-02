import React, { useState, useEffect } from 'react';
import AuthContext from './auth-context';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [refreshToken, setRefreshToken] = useState(localStorage.getItem('refreshToken'));
  const [loading, setLoading] = useState(true);

  const persistSession = (accessToken, nextRefreshToken) => {
    setToken(accessToken);
    setRefreshToken(nextRefreshToken);
    localStorage.setItem('token', accessToken);
    localStorage.setItem('refreshToken', nextRefreshToken);
  };

  const clearSession = () => {
    setUser(null);
    setToken(null);
    setRefreshToken(null);
    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
  };

  const refreshAuthToken = async () => {
    const currentRefreshToken = localStorage.getItem('refreshToken');
    if (!currentRefreshToken) {
      clearSession();
      return null;
    }

    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: currentRefreshToken }),
    });

    if (!res.ok) {
      clearSession();
      return null;
    }

    const data = await res.json();
    persistSession(data.access_token, data.refresh_token);
    setUser(data.user);
    return data.access_token;
  };

  useEffect(() => {
    let active = true;

    const restoreSession = async () => {
      const currentToken = localStorage.getItem('token');
      if (!currentToken && !localStorage.getItem('refreshToken')) {
        if (active) setLoading(false);
        return;
      }

      let workingToken = currentToken;
      if (!workingToken && localStorage.getItem('refreshToken')) {
        workingToken = await refreshAuthToken();
      }

      if (!workingToken) {
        if (active) setLoading(false);
        return;
      }

      const res = await fetch('/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${workingToken}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        if (active) setUser(data);
      } else if (res.status === 401 && localStorage.getItem('refreshToken')) {
        const refreshedToken = await refreshAuthToken();
        if (refreshedToken) {
          const retryRes = await fetch('/api/auth/me', {
            headers: {
              'Authorization': `Bearer ${refreshedToken}`,
            },
          });
          if (retryRes.ok) {
            const data = await retryRes.json();
            if (active) setUser(data);
          } else {
            clearSession();
          }
        }
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
  }, []);

  useEffect(() => {
    if (!refreshToken) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      refreshAuthToken().catch(() => {
        clearSession();
      });
    }, 10 * 60 * 1000);

    return () => window.clearInterval(intervalId);
  }, [refreshToken]);

  const login = (userData, accessToken, nextRefreshToken) => {
    setUser(userData);
    persistSession(accessToken, nextRefreshToken);
  };

  const updateUser = (newUserData) => {
    setUser(prev => ({ ...prev, ...newUserData }));
  };

  const logout = async () => {
    const currentRefreshToken = localStorage.getItem('refreshToken');
    if (currentRefreshToken) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: currentRefreshToken }),
        });
      } catch {
        // Best effort logout; local session is still cleared below.
      }
    }
    clearSession();
  };

  return (
    <AuthContext.Provider value={{ user, token, refreshToken, login, logout, updateUser, refreshAuthToken, authenticated: !!user, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
