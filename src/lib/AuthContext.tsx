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
      if (!stored) return null;
      const parsed = JSON.parse(stored) as Officer;

      // ล้างข้อมูลลับที่ session เก่าอาจยังเก็บไว้ในเครื่องผู้ใช้
      // (ก่อน migration 0043 เคยเขียน password_hash ลงที่นี่)
      // เขียนทับใหม่ทันที ไม่ต้องรอผู้ใช้ล็อกอินใหม่
      const hadSecret =
        'password_hash' in parsed || 'username' in parsed;
      if (hadSecret) {
        const safe = toSafeSession(parsed);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
        return safe;
      }
      return parsed;
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

/**
 * ฟิลด์ที่ห้ามเก็บลง localStorage
 *
 * เคยเกิดขึ้นจริง: session ที่สร้างก่อน migration 0043 ถูกเขียนทั้ง object
 * รวม `password_hash` ลง `dot_officer` — ใครเปิด DevTools ก็เห็น
 *
 * ตอนนี้ `login_officer()` ไม่คืน hash มาแล้ว แต่ข้อมูลเก่าในเครื่องผู้ใช้
 * ยังค้างอยู่จนกว่าจะล็อกอินใหม่ — การกรองตรงนี้ทำให้เก่าไม่ถูกเขียนซ้ำ
 */
const SESSION_SAFE_FIELDS = [
  'id', 'name', 'rank', 'department', 'status', 'is_on_duty',
  'photo_url', 'duty_rate', 'service_category', 'points', 'points_period',
  'points_log', 'accumulated_share', 'generation', 'sort_order',
  'last_login_at', 'last_login_ip', 'created_at', 'updated_at',
] as const;

function toSafeSession(o: Officer): Officer {
  const safe: Record<string, unknown> = {};
  for (const f of SESSION_SAFE_FIELDS) {
    if (f in o) safe[f] = (o as unknown as Record<string, unknown>)[f];
  }
  return safe as unknown as Officer;
}

  const setAuth = useCallback((o: Officer | null, token: string | null = null) => {
    setOfficerState(o);
    if (o) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSafeSession(o)));
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
