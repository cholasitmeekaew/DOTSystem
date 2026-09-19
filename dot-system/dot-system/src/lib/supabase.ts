/**
 * Supabase client + mode detection
 *
 * โหมดการทำงาน:
 * - JSON mode (default): ใช้ localStorage-backed mock ที่เลียนแบบ Supabase API
 * - Supabase mode: ใช้ Supabase จริง (lazy-load @supabase/supabase-js)
 *
 * กฎการเลือกโหมด:
 * 1. ถ้า VITE_USE_MOCK === 'true' → JSON mode (force)
 * 2. ถ้า URL หรือ Key ว่าง → JSON mode (fallback อัตโนมัติ ไม่ throw)
 * 3. ถ้า URL + Key ครบ → Supabase mode
 */
import { createJsonSupabaseClient, type JsonSupabaseClient } from './jsonDb';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || '';
const useMockFlag = import.meta.env.VITE_USE_MOCK;

export type DBMode = 'json' | 'supabase';

function detectMode(): DBMode {
  if (useMockFlag === 'true') return 'json';
  if (useMockFlag === 'false') return 'supabase';
  return supabaseUrl && supabaseAnonKey ? 'supabase' : 'json';
}

export const dbMode: DBMode = detectMode();
export const isJsonMode = dbMode === 'json';
export const isSupabaseMode = dbMode === 'supabase';

/**
 * Cache สำหรับ real Supabase client — โหลดแบบ lazy
 */
let realSupabase: any = null;
let loadingPromise: Promise<any> | null = null;

async function loadSupabaseClient(): Promise<any> {
  if (realSupabase) return realSupabase;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      realSupabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // ใช้ username/password แบบ custom ไม่ใช้ Supabase Auth
          // (login flow ของเราค้นหา officer ใน table เอง)
          storage: window.localStorage,
          storageKey: 'dot-auth',
        },
      });
      return realSupabase;
    } catch (err) {
      console.error('[supabase] Failed to load @supabase/supabase-js — falling back to JSON mode:', err);
      // Fallback เป็น mock เพื่อไม่ให้ app crash
      realSupabase = createJsonSupabaseClient();
      return realSupabase;
    }
  })();
  return loadingPromise;
}

/**
 * Proxy ที่ lazy-load Supabase client ตอนเข้าถึงครั้งแรก
 * ใน JSON mode: return mock โดยตรง (ไม่ load SDK)
 */
function createSupabaseProxy(): any {
  if (isJsonMode) {
    return createJsonSupabaseClient();
  }
  // Supabase mode: return proxy ที่ load ตอน runtime
  return new Proxy({} as any, {
    get(_t, prop) {
      // Trigger lazy load
      if (!realSupabase) {
        loadSupabaseClient();
        // ถ้ายังโหลดไม่เสร็จ → return mock ชั่วคราวเพื่อไม่ให้ crash
        // (queries จะทำงานกับ mock แทน — ไม่ ideal แต่ปลอดภัย)
        return (createJsonSupabaseClient() as any)[prop];
      }
      return realSupabase[prop];
    },
  });
}

export const supabase: any = createSupabaseProxy();

/**
 * Force-initialize Supabase client (call นี้เมื่อต้องการให้พร้อมใช้)
 * เช่น ตอน login form submit
 */
export async function ensureSupabaseClient(): Promise<any> {
  if (isJsonMode) return supabase;
  return loadSupabaseClient();
}

export default supabase;
