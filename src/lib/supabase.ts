/**
 * Supabase client + mode detection
 *
 * โหมดการทำงาน:
 * - JSON mode (default): ใช้ localStorage-backed mock ที่เลียนแบบ Supabase API
 * - Supabase mode: ใช้ Supabase จริง (ต้องตั้ง URL + Anon Key และ install @supabase/supabase-js)
 *
 * กฎการเลือกโหมด:
 * 1. ถ้า VITE_USE_MOCK === 'true' → JSON mode (force)
 * 2. ถ้า URL หรือ Key ว่าง → JSON mode (fallback อัตโนมัติ ไม่ throw)
 * 3. ถ้า URL + Key ครบ → Supabase mode
 *
 * ใน Bolt / dev / production-without-Supabase: ใช้ JSON mode ได้ทันที
 * ไม่ต้องแก้ `.env` — แค่ copy `.env.example` → `.env` แล้วรันได้เลย
 *
 * หมายเหตุ: ใน JSON mode จะ return mock client โดยตรง
 * ไม่ load @supabase/supabase-js เพื่อให้ bundle เล็กและทำงานได้แม้ SDK ไม่ได้ install
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
 * Client ที่ component ใช้ — JSON mode ใช้ mock, Supabase mode ใช้ real client
 *
 * ใน JSON mode: ใช้ mock ที่ replicate Supabase API ครบทุก method
 *   → ไม่ต้อง install @supabase/supabase-js เลย
 *   → bundle เล็กกว่า, build เร็วกว่า
 *
 * ใน Supabase mode: ต้องติดตั้ง @supabase/supabase-js ก่อน (pnpm add @supabase/supabase-js)
 *   → ใช้ Proxy เพื่อ lazy-load SDK ตอน runtime (ไม่ block build)
 */
function createSupabaseClientSync(): JsonSupabaseClient {
  // Mock client ที่เลียนแบบ Supabase API
  return createJsonSupabaseClient();
}

function createSupabaseClientProxy(): any {
  let realClient: any = null;
  const promise = import('@supabase/supabase-js').then(({ createClient }) => {
    realClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    return realClient;
  }).catch((err) => {
    console.error('[supabase] Failed to load @supabase/supabase-js — falling back to JSON mode:', err);
    return createJsonSupabaseClient();
  });
  return new Proxy({} as any, {
    get(_t, prop) {
      if (realClient) return realClient[prop];
      // Throw a clear error for now — caller can await promise
      throw new Error(
        `[supabase] Client ยังโหลดไม่เสร็จ (prop: ${String(prop)}). ` +
        'ถ้าต้องการใช้ Supabase จริง กรุณา pnpm add @supabase/supabase-js'
      );
    },
  });
}

export const supabase: any = isSupabaseMode
  ? createSupabaseClientProxy()
  : createSupabaseClientSync();

export default supabase;
