import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, setUnauthorizedHandler } from '@/api/client';
import type { Me } from '@/api/types';

export const PERMS = {
  USERS_MANAGE: 'users:manage', POS_READ: 'pos:read', POS_WRITE: 'pos:write', POS_DELETE: 'pos:delete',
  POS_IMPORT: 'pos:import', XML_UPLOAD: 'xml:upload', JOBS_RUN: 'jobs:run', JOBS_READ: 'jobs:read',
  AUDIT_READ: 'audit:read', SYSTEM_READ: 'system:read',
} as const;
export type Perm = (typeof PERMS)[keyof typeof PERMS];

interface AuthState {
  user: Me | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (p: Perm) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const refresh = useCallback(async () => {
    try {
      setUser((await api.get<Me>('/auth/me')).data);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    setUnauthorizedHandler(() => { setUser(null); qc.clear(); });
    return () => setUnauthorizedHandler(null);
  }, [qc]);

  const login = useCallback(async (username: string, password: string) => {
    const { data } = await api.post<Me>('/auth/login', { username, password });
    qc.clear();
    setUser(data);
  }, [qc]);

  const logout = useCallback(async () => {
    let url: string | null = null;
    try {
      await api.post('/auth/logout');
      url = (await api.get<{ url: string | null }>('/auth/sso/logout-url')).data.url;
    } catch { /* ignore */ } finally { setUser(null); qc.clear(); }
    if (url) window.location.href = url;
  }, [qc]);

  const value = useMemo<AuthState>(() => ({
    user, loading, login, logout, refresh,
    can: (p) => !!user?.permissions.includes(p),
  }), [user, loading, login, logout, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
