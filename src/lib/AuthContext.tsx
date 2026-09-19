import { createContext, useContext, useState, ReactNode, useCallback, useMemo, useEffect } from 'react';
import type { Officer } from './types';
import { supabase } from './supabase';

interface AuthContextType {
  officer: Officer | null;
  accessToken: string | null;
  setAuth: (officer: Officer | null, accessToken?: string | null) => void;
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
const TOKEN_KEY = 'dot_access_token';

/** ดึง access_token จาก localStorage ของ Supabase (ถ้ามี) */
function readSupabaseToken(): string | null {
  try {
    // Supabase v2 เก็บ token ใน key 'sb-<project>-auth-token'
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.includes('-auth-token')) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          return parsed.access_token ?? parsed.currentSession?.access_token ?? null;
        }
      }
    }
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [officer, setOfficerState] = useState<Officer | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? (JSON.parse(stored) as Officer) : null;
    } catch {
      return null;
    }
  });
  const [accessToken, setAccessToken] = useState<string | null>(readSupabaseToken);

  // sync access token เมื่อ Supabase เก็บ token ใหม่ (เช่น ตอน login)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.includes('-auth-token')) {
        setAccessToken(readSupabaseToken());
      }
    };
    window.addEventListener('storage', onStorage);
    // poll เป็นระยะ (ทุก 1s) เผื่อ Supabase login ในแท็บเดียวกัน
    const interval = setInterval(() => {
      const t = readSupabaseToken();
      setAccessToken((prev) => (prev !== t ? t : prev));
    }, 1000);
    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(interval);
    };
  }, []);

  // ตรวจสถานะบัญชีซ้ำกับ DB — ถูกระงับ/ลบบัญชีระหว่างล็อกอินค้างต้องเด้งออกทันที
  // (หน้า Login กันไว้แล้ว แต่ session เก่าใน localStorage ไม่เคยถูกตรวจซ้ำ)
  useEffect(() => {
    const revalidate = async () => {
      let stored: Officer | null = null;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        stored = raw ? (JSON.parse(raw) as Officer) : null;
      } catch {
        return;
      }
      if (!stored?.id) return;
      try {
        const { data, error } = await supabase
          .from('officers')
          .select('id, status')
          .eq('id', stored.id)
          .maybeSingle();
        if (error) return; // อ่านไม่ได้ = ไม่แตะ session เดิม
        const status = (data as unknown as { status?: string } | null)?.status;
        if (!data || status === 'suspended' || status === 'deleted') {
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(TOKEN_KEY);
          setOfficerState(null);
          setAccessToken(null);
        }
      } catch {
        // ตรวจไม่ได้ = คง session เดิมไว้ก่อน
      }
    };
    revalidate();
    const interval = setInterval(revalidate, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const setAuth = useCallback((o: Officer | null, token: string | null = null) => {
    setOfficerState(o);
    if (o) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(o));
      if (token) {
        localStorage.setItem(TOKEN_KEY, token);
        setAccessToken(token);
      } else {
        // ดึง token ที่ Supabase เพิ่งเก็บไว้
        const t = readSupabaseToken();
        if (t) {
          localStorage.setItem(TOKEN_KEY, t);
          setAccessToken(t);
        }
      }
    } else {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(TOKEN_KEY);
      setAccessToken(null);
    }
  }, []);

  const logout = useCallback(() => {
    setAuth(null, null);
  }, [setAuth]);

  const value = useMemo<AuthContextType>(
    () => ({
      officer,
      accessToken,
      setAuth,
      logout,
      isCommissioner: officer?.rank === 'commissioner',
      isInspector: officer?.rank === 'inspector',
      isOfficer: officer?.rank === 'officer',
      isAuthenticated: !!officer,
    }),
    [officer, accessToken, setAuth, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
