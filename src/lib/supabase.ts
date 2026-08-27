/**
 * Supabase client + mode detection
 *
 * โหมดการทำงาน:
 * - JSON mode (default): ใช้ localStorage-backed mock ที่เลียนแบบ Supabase API
 * - Supabase mode: ใช้ Supabase จริง (ต้องตั้ง URL + Anon Key + ติดตั้ง @supabase/supabase-js)
 *
 * กฎการเลือกโหมด:
 * 1. ถ้า VITE_USE_MOCK === 'true' → JSON mode (force)
 * 2. ถ้า URL หรือ Key ว่าง → JSON mode (fallback อัตโนมัติ ไม่ throw)
 * 3. ถ้า URL + Key ครบ → Supabase mode
 *
 * ใน Bolt / dev / production-without-Supabase: ใช้ JSON mode ได้ทันที
 * ไม่ต้องแก้ `.env` — แค่ copy `.env.example` → `.env` แล้วรันได้เลย
 *
 * ใน JSON mode: bundle จะเล็ก เพราะ @supabase/supabase-js ถูก mark เป็น external
 * ใน vite.config.ts และไม่ถูก load
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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

type SupabaseClientLike = SupabaseClient | JsonSupabaseClient;

function createRealSupabaseClient(): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

export const supabase: SupabaseClientLike = isJsonMode
  ? createJsonSupabaseClient()
  : createRealSupabaseClient();

export default supabase;
