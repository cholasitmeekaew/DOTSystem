/* =============================================================
 * check-sql.mjs — ตรวจชนิดข้อมูล PostgreSQL ที่พิมพ์ผิด ก่อนนำไปรัน
 * -------------------------------------------------------------
 * เพิ่มหลังเจอ bug จริง: พิมพ์ "timestamz" แทน "timestamptz"
 * ทำให้ทั้งไฟล์รันไม่ได้ แต่มองด้วยตาก็เหมือนถูกต้อง
 *
 * ตรวจแบบเจาะจงเฉพาะชนิดที่ "หน้าตาใกล้" กันจนพิมพ์ผิดได้
 * ไม่พยายามเดาชนิดอื่นทั้งหมด เพราะต้องมี SQL parser จึงจะแม่นพอ
 * และการรายงานผิดจะทำให้ไม่มีใครดูผลลัพธ์อีก
 *
 * ใช้:  node scripts/check-sql.mjs
 * ============================================================= */

import { readFileSync, readdirSync } from 'fs';

/** ชนิดจริง → ชนิดที่พิมพ์ผิดแล้วยังดูใกล้เคียง (ตรวจคำค้นแบบเต็มคำ) */
const TYPOS = {
  timestamz: 'timestamptz',
  timestampz: 'timestamptz',
  timestmpz: 'timestamptz',
  timestsz: 'timestamptz',
  timestampt: 'timestamptz',
  bolean: 'boolean',
  integar: 'integer',
  varcher: 'varchar',
  uuidt: 'uuid',
};

let problems = 0;

for (const f of readdirSync('supabase/migrations').sort()) {
  if (!f.endsWith('.sql')) continue;
  const text = readFileSync(`supabase/migrations/${f}`, 'utf8');
  const lines = text.split('\n');

  lines.forEach((raw, i) => {
    if (raw.trimStart().startsWith('--')) return;   // ข้าม comment

    for (const [wrong, right] of Object.entries(TYPOS)) {
      const re = new RegExp(`(?<![a-z0-9_])${wrong}(?![a-z0-9_])`, 'gi');
      if (!re.test(raw)) continue;
      console.log(`✘ ${f}:${i + 1}  "${wrong}" ไม่ใช่ชนิดข้อมูลที่มีอยู่ — น่าจะหมายถึง "${right}"`);
      console.log(`   ${raw.trim()}`);
      problems++;
    }
  });
}

if (problems === 0) {
  console.log('✓ ตรวจชนิดข้อมูลในไฟล์ SQL แล้ว ไม่พบข้อผิดพลาด');
} else {
  console.log(`\nพบ ${problems} จุด — ห้ามรันจนกว่าจะแก้แล้ว`);
}
process.exit(problems === 0 ? 0 : 1);
