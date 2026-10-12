/* =============================================================
 * check-migrations.mjs — เช็คว่า migration ไหนยังไม่ถูก apply
 * -------------------------------------------------------------
 * วิธีใช้:  node scripts/check-migrations.mjs
 *
 * อ่านชื่อตารางจากไฟล์ .sql ใน supabase/migrations/ แล้วลอง query
 * ด้วย anon key — ถ้าตารางยังไม่มี PostgREST จะตอบว่า schema cache ไม่เจอ
 *
 * ปลอดภัย: อ่านอย่างเดียว ไม่เขียน ไม่ลบอะไร
 * ข้อจำกัด: ตรวจได้แค่ "ตารางมีหรือไม่" ไม่ได้ตรวจว่า column ครบไหม
 *            (บาง migration ทำแค่ alter column)
 * ============================================================= */

import { readFileSync, readdirSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n').filter(Boolean)
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);

const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** เก็บตาราง → migration ที่สร้าง (เอาไฟล์เลขของ migration เท่านั้น) */
const tableToMig = new Map();
for (const f of readdirSync('supabase/migrations').sort()) {
  const mig = f.slice(0, 4);
  if (!/^\d{4}$/.test(mig)) continue;          // ข้าม APPLY_* / SEED_* / VERIFY_*
  const sql = readFileSync(`supabase/migrations/${f}`, 'utf8').replace(/--.*/g, '');
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)/gi)) {
    tableToMig.set(m[1].toLowerCase(), mig);
  }
}

const missing = {};
let present = 0;

for (const [table, mig] of tableToMig) {
  const { error } = await sb.from(table).select('*').limit(1);
  const notFound = error && /does not exist|schema cache|PGRST/i.test(error.message);
  if (notFound) (missing[mig] ??= []).push(table);
  else present += 1;
}

console.log(`ตรวจ ${tableToMig.size} ตาราง → มีแล้ว ${present} · ยังไม่มี ${Object.values(missing).flat().length}\n`);
if (Object.keys(missing).length === 0) {
  console.log('✓ ทุก migration ที่สร้างตาราง ถูก apply ครบแล้ว');
} else {
  for (const mig of Object.keys(missing).sort()) {
    console.log(`  ${mig}  →  ${missing[mig].join(', ')}`);
  }
  console.log('\nดูไฟล์: supabase/migrations/APPLY_0027-0030.sql (ตัวอย่างรูปแบบ)');
}
