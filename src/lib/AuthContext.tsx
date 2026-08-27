import { createContext, useContext, useState, ReactNode, useCallback, useMemo } from 'react';
import type { Officer } from './types';

interface AuthContextType {
  officer: Officer | null;
  setOfficer: (officer: Officer | null) => void;
  logout: () => void;
  /** @deprecated ใช้ useRole().isCommissioner แทน */
  isCommissioner: boolean;
  /** rank === 'inspector' */
  isInspector: boolean;
  /** rank === 'officer' */
  isOfficer: boolean;
  /** login แล้วหรือยัง */
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const STORAGE_KEY = 'dot_officer';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [officer, setOfficerState] = useState<Officer | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? (JSON.parse(stored) as Officer) : null;
    } catch {
      return null;
    }
  });

  const setOfficer = useCallback((o: Officer | null) => {
    setOfficerState(o);
    if (o) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(o));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const logout = useCallback(() => {
    setOfficer(null);
  }, [setOfficer]);

  const value = useMemo<AuthContextType>(
    () => ({
      officer,
      setOfficer,
      logout,
      isCommissioner: officer?.rank === 'commissioner',
      isInspector: officer?.rank === 'inspector',
      isOfficer: officer?.rank === 'officer',
      isAuthenticated: !!officer,
    }),
    [officer, setOfficer, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
