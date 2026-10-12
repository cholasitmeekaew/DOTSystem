/* =============================================================
 * check-profile-data.mts
 * -------------------------------------------------------------
 * กันบั๊ก "ทุกอย่างคืนค่า 0 แต่ไม่ error" ใน fetchProfileExtra
 * ซึ่งเคยเกิด 2 ครั้ง:
 *   1. สลับ dutyRes/loginRes เพราะอาศัยลำดับ Promise.all
 *   2. ห่อ builder ในออบเจกต์แล้วส่งเข้า Promise.all (ไม่ใช่ promise)
 *
 * ทั้งสองครั้ง query ไม่ error → หน้าเว็บแสดง "ไม่มีข้อมูล" เงียบ ๆ
 *
 * วิธีตรวจ: เจ้าหน้าที่ที่มีข้อมูลจริงใน duty_logs ต้องได้ attendance > 0
 * ใช้:  set -a && . ./.env && set +a && npx vite-node scripts/check-profile-data.mts
 * ============================================================= */

import { fetchProfileExtra } from '../src/lib/profileData';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!, {
  auth: { persistSession: false },
});

// เจ้าหน้าที่ที่ต้องมีประวัติเวรอย่างน้อย 1 รายการ
const { data: withLogs } = await sb
  .from('duty_logs').select('officer_id').is('deleted_at', null).not('officer_id', 'is', null);
const ids = [...new Set((withLogs ?? []).map((r: { officer_id: string }) => r.officer_id))];

if (ids.length === 0) {
  console.log('• ยังไม่มีข้อมูล duty_logs ให้ตรวจ — ข้าม');
  process.exit(0);
}

const { data: officers } = await sb.from('officers').select('id,name').in('id', ids.slice(0, 5));

let fail = 0;
console.log(`ตรวจ ${officers?.length ?? 0} คน (จาก ${ids.length} คนที่มีเวร)\n`);

for (const o of officers ?? []) {
  // นับที่คาดหวังตรงจาก DB ก่อน แล้วค่อยเทียบกับผลจาก fetchProfileExtra
  const { count: expected } = await sb
    .from('duty_logs').select('id', { count: 'exact' })
    .eq('officer_id', o.id).is('deleted_at', null).limit(60);

  const r = await fetchProfileExtra(o.id, o.name);
  const ok = r.attendance.length === (expected ?? 0);
  if (!ok) fail++;
  console.log(
    `${ok ? '✓' : '✘'} ${o.name.padEnd(24)} ` +
    `คาดหวัง ${String(expected ?? 0).padStart(3)} · ได้ ${String(r.attendance.length).padStart(3)}` +
    (r.errors.length ? ` · errors ${r.errors.length}` : ''),
  );
  if (!ok && r.errors.length) console.log(`   ${r.errors.join(' | ')}`);
}

console.log(fail === 0
  ? '\nผ่าน — ข้อมูลตรงกับฐานข้อมูลทุกคน'
  : `\nมี ${fail} คนที่ข้อมูลไม่ตรง — น่าจะเป็นบั๊กการผูก query ผิดตัวแปร`);
process.exit(fail === 0 ? 0 : 1);
