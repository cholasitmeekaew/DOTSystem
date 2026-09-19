import { createContext, useContext, useState, ReactNode } from 'react';
import { Officer } from './types';

interface AuthContextType {
  officer: Officer | null;
  setOfficer: (officer: Officer | null) => void;
  logout: () => void;
  isCommissioner: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [officer, setOfficerState] = useState<Officer | null>(() => {
    try {
      const stored = localStorage.getItem('dot_officer');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const setOfficer = (o: Officer | null) => {
    setOfficerState(o);
    if (o) {
      localStorage.setItem('dot_officer', JSON.stringify(o));
    } else {
      localStorage.removeItem('dot_officer');
    }
  };

  const logout = () => {
    setOfficer(null);
  };

  const isCommissioner = officer?.rank === 'commissioner';

  return (
    <AuthContext.Provider value={{ officer, setOfficer, logout, isCommissioner }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
