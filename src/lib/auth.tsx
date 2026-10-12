import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { PublicUser, Role } from '../../shared/types.ts';
import { api } from './api.ts';

interface AuthState {
  user: PublicUser | null;
  loading: boolean;
  login(username: string, password: string, as?: Role): Promise<PublicUser>;
  logout(): Promise<void>;
  setUser(user: PublicUser): void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ user: PublicUser | null }>('/api/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    const onSignedOut = () => setUser(null);
    window.addEventListener('abugida:signed-out', onSignedOut);
    return () => window.removeEventListener('abugida:signed-out', onSignedOut);
  }, []);

  const login = useCallback(async (username: string, password: string, as?: Role) => {
    const r = await api.post<{ user: PublicUser }>('/api/auth/login', { username, password, as });
    setUser(r.user);
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => undefined);
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, logout, setUser }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function homePath(user: PublicUser): string {
  return user.role === 'student' ? '/student' : user.role === 'parent' ? '/parent' : user.role === 'mentor' ? '/mentor' : '/admin';
}
