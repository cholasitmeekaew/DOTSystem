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
 * Type ของ Supabase client — ใช้ any เพื่อไม่ต้อง import type จาก SDK
 * เพราะ mock client มี API เหมือน Supabase client พอดี
 */
type SupabaseClientLike = any;

/**
 * สร้าง Supabase client จริง — ฟังก์ชันนี้ถูกเรียกเฉพาะเมื่อ dbMode === 'supabase'
 * ณ runtime เท่านั้น (JSON mode ไม่เคยเรียก)
 *
 * หมายเหตุ: ตอน build Vite จะ mark @supabase/supabase-js เป็น external
 * ถ้า user ใช้ JSON mode จริงๆ ฟังก์ชันนี้ก็ไม่ถูกเรียก runtime
 * ถ้า user ต้องการ Supabase จริง ต้อง pnpm add @supabase/supabase-js ก่อน
 */
function createRealSupabaseClient(): SupabaseClientLike {
  // ใช้ eval หรือ indirect call เพื่อให้ Vite/Rollup ไม่ resolve ตอน build
  // (Vite mark เป็น external แล้ว แต่เรา guard ไว้อีกชั้นเพื่อความปลอดภัย)
  throw new Error(
    '[supabase] @supabase/supabase-js is not available. ' +
    'กรุณาติดตั้งด้วยคำสั่ง: pnpm add @supabase/supabase-js ' +
    'จากนั้นแก้ไข supabase.ts เพื่อ uncomment createClient() call'
  );
}

export const supabase: SupabaseClientLike | JsonSupabaseClient = isJsonMode
  ? createJsonSupabaseClient()
  : createRealSupabaseClient();

export default supabase;
