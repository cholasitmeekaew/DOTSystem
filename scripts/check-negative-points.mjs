/**
 * ตรวจว่าระบบรองรับคะแนนติดลบ (หนี้คะแนน) พร้อมหรือยัง
 *
 * รัน: node scripts/check-negative-points.mjs
 * ต้องรัน supabase/migrations/0037_allow_negative_points.sql ก่อน
 * ถ้ายังไม่ได้รัน สคริปต์นี้จะบอกว่ายังขาดอะไร
 */
import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n').filter(Boolean).map((l) => {
    const i = l.indexOf('=');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const PROBE_ID = '00000000-0000-0000-0000-000000000000';

const { data: admin } = await sb
  .from('officers').select('id').eq('rank', 'commissioner').limit(1).single();

// ลองหักให้ติดลบชั่วคราวเพื่อดูว่า DB อนุญาตไหม
const { data: before } = await sb
  .from('officers').select('points').eq('id', admin.id).single();
const original = before.points ?? 0;

const { error } = await sb
  .from('officers').update({ points: -1 }).eq('id', admin.id);

// คืนค่าเดิมเสมอ ไม่ว่าจะผลเป็นอย่างไร
await sb.from('officers').update({ points: original }).eq('id', admin.id);

if (error) {
  console.log('✘ ยังไม่รองรับคะแนนติดลบ — DB ปฏิเสธค่าติดลบ');
  console.log(`  ข้อความ: ${error.message}`);
  console.log('');
  console.log('  วิธีแก้: เปิด Supabase → SQL Editor → รันไฟล์');
  console.log('  supabase/migrations/0037_allow_negative_points.sql');
  process.exit(1);
}

console.log('✓ รองรับคะแนนติดลบแล้ว');
console.log('  หักเกินคงเหลือจะกลายเป็นหนี้ แล้วค่อย ๆ ถูกกู้คืนเมื่อได้คะแนนใหม่');
