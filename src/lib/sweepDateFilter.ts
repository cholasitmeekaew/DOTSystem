/**
 * ตัวกรองช่วงวันที่สำหรับการสแกนคะแนน PPS
 *
 * ทำไมต้องมี
 * ──────────
 * เดิมปุ่มสแกนไล่ดูประวัติ "ทั้งหมดในระบบ" ไม่จำกัดช่วงเวลา
 * ถ้าข้อมูลย้อนหลังเยอะหรือมีรายการเก่าที่ไม่ควรนับ
 * หัวหน้ากรมจะเลือกไม่ได้ว่าจะให้/หักเฉพาะช่วงไหน
 *
 * กติกา
 * ────
 * - from / to ว่าง = ไม่จำกัดด้านนั้น
 * - รองรับทั้ง 'YYYY-MM-DD' และ ISO timestamp เต็ม
 * - เทียบจากวันที่ส่วนหน้า (10 ตัวแรก) เพื่อไม่ให้เวลาในวันเดียวกันถูกตัด
 */

/** ตัดให้เหลือแค่ 'YYYY-MM-DD' */
export function toDateOnly(value: string | null | undefined): string {
  if (!value) return '';
  const s = String(value).trim();
  if (!s) return '';
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s.slice(0, 10);
}

/**
 * วันที่นี้อยู่ในช่วงที่เลือกไหม
 *
 * ถ้าไม่ได้ตั้งช่วงวันที่เลย → ผ่านทั้งหมด (ไม่กรองอะไร)
 * ถ้าตั้งช่วงแล้ว → รายการที่ "ไม่มีวันที่" จะไม่ผ่าน
 *
 * กติกาข้อหลังสำคัญ: ถ้าปล่อยให้ผ่าน จะกลายเป็นให้คะแนนนอกช่วงที่เลือก
 * ซึ่งขัดกับเหตุผลที่เพิ่มตัวกรองนี้ — แต่ต้องรายงานจำนวนที่ตกไปด้วย
 * ไม่งั้นผู้ใช้จะคิดว่าไม่มีรายการนั้นอยู่จริง
 *
 * @param value วันที่ของรายการ (รองรับ ISO timestamp)
 * @param from  'YYYY-MM-DD' หรือ '' = ไม่จำกัดต้น
 * @param to    'YYYY-MM-DD' หรือ '' = ไม่จำกัดปลาย
 */
export function isWithinRange(
  value: string | null | undefined,
  from: string,
  to: string,
): boolean {
  const f = toDateOnly(from);
  const t = toDateOnly(to);

  // ไม่ได้จำกัดเลย → ผ่านทั้งหมด
  if (!f && !t) return true;

  // ไม่มีวันที่ในรายการนี้
  const v = toDateOnly(value);
  if (!v) return false;

  // เทียบแบบสตริงก็ได้ เพราะรูปแบบ YYYY-MM-DD เรียงตามลำดับเวลาแล้ว
  if (f && v < f) return false;
  if (t && v > t) return false;
  return true;
}

/**
 * กรองรายการตามช่วงวันที่ พร้อมบอกว่าตกไปกี่รายการ
 *
 * `skipped` คือรายการที่ถูกตัดเพราะไม่มีวันที่ให้เทียบ
 * ต้องเอาไปแจ้งผู้ใช้เสมอ ไม่งั้นข้อมูลจะหายไปเงียบ ๆ
 */
export function filterByRangeDetailed<T>(
  rows: T[],
  from: string,
  to: string,
  dateOf: (row: T) => string | null | undefined,
): { kept: T[]; skipped: number } {
  const hasRange = Boolean(toDateOnly(from) || toDateOnly(to));
  if (!hasRange) return { kept: rows, skipped: 0 };

  const kept: T[] = [];
  let skipped = 0;
  for (const r of rows) {
    if (isWithinRange(dateOf(r), from, to)) kept.push(r);
    else if (!toDateOnly(dateOf(r))) skipped += 1;
  }
  return { kept, skipped };
}

/** กรองรายการที่มีฟิลด์วันที่ */
export function filterByRange<T>(
  rows: T[],
  from: string,
  to: string,
  dateOf: (row: T) => string | null | undefined,
): T[] {
  return filterByRangeDetailed(rows, from, to, dateOf).kept;
}

/**
 * แปลงวันที่ตั้งต้นเป็นช่วง ๆ ที่ใช้บ่อย
 *
 * ใช้กับ input type="date" ซึ่งต้องการ 'YYYY-MM-DD'
 */
export function presetRange(preset: SweepDatePreset, today = new Date()): { from: string; to: string } {
  const iso = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  switch (preset) {
    case 'all':
      return { from: '', to: '' };

    case 'today':
      return { from: iso(today), to: iso(today) };

    case 'last7': {
      const d = new Date(today);
      d.setDate(d.getDate() - 6);   // รวมวันนี้ = 7 วัน
      return { from: iso(d), to: iso(today) };
    }

    case 'last30': {
      const d = new Date(today);
      d.setDate(d.getDate() - 29);
      return { from: iso(d), to: iso(today) };
    }

    case 'thisMonth':
      return {
        from: iso(new Date(today.getFullYear(), today.getMonth(), 1)),
        to: iso(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
      };

    case 'lastMonth': {
      return {
        from: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        to: iso(new Date(today.getFullYear(), today.getMonth(), 0)),
      };
    }

    default:
      return { from: '', to: '' };
  }
}

export type SweepDatePreset =
  | 'all'
  | 'today'
  | 'last7'
  | 'last30'
  | 'thisMonth'
  | 'lastMonth';

/** ข้อความอธิบายช่วงวันที่ที่เลือก ใช้แสดงผลกับผู้ใช้ */
export function describeRange(from: string, to: string): string {
  const f = toDateOnly(from);
  const t = toDateOnly(to);
  if (!f && !t) return 'ทั้งหมด (ไม่จำกัดช่วงวันที่)';
  if (f && t) return f === t ? `${f}` : `${f} → ${t}`;
  if (f) return `ตั้งแต่ ${f}`;
  return `ถึง ${t}`;
}
