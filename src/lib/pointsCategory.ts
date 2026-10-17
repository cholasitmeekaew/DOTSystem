/**
 * จำแนกหมวดหมูของรายการคะแนน
 *
 * ประวัติคะแนนเก็บเป็น ledger เดียว ผสมทั้งคะแนนที่ระบบให้เอง
 * คะแนนที่หัวหน้ากรมให้/หักเอง และรายการคืนคะแนน
 * ถ้าไม่แยกหมวด ผู้ใช้จะอ่านยาก เพราะเหตุผลเป็นข้อความยาว ๆ
 * ฟังก์ชันนี้แปลงเป็นหมวด + ป้ายสั้น ๆ เพื่อใช้จัดกลุ่มและกรองใน UI
 */

import type { PointsLogEntry } from './types';

export type PointsCategoryKey =
  | 'duty'        // ออกเวร
  | 'report'      // รายงานได้รับอนุมัติ
  | 'case'        // ปิดเคสย่อย
  | 'payment'     // รับชำระครบ
  | 'absence'     // ขาดเวร
  | 'noreport'    // ไม่ส่งรายงาน
  | 'forced'      // ถูกบังคับออกเวร
  | 'complaint'   // ร้องเรียนผลเป็นจริง
  | 'reversal'    // คืนคะแนน / ยกเลิก
  | 'manual'      // หัวหน้ากรมให้หรือหักเอง
  | 'reset';      // รีเซ็ตงวด

export interface PointsCategory {
  key: PointsCategoryKey;
  /** ป้ายสั้นสำหรับแสดงเป็นหัวข้อกลุ่ม */
  label: string;
  /** คำอธิบายสั้น */
  hint: string;
  /** true = คะแนนบวก (ได้) · false = คะแนนลบ (หัก) */
  positive: boolean;
  textClass: string;
  borderClass: string;
  bgClass: string;
}

export const POINTS_CATEGORIES: Record<PointsCategoryKey, PointsCategory> = {
  duty: {
    key: 'duty', label: 'ออกเวร', hint: '+5 ต่อชั่วโมงที่ทำได้ครบ',
    positive: true,
    textClass: 'text-emerald-300', borderClass: 'border-emerald-500/25', bgClass: 'bg-emerald-500/10',
  },
  report: {
    key: 'report', label: 'รายงานได้รับอนุมัติ', hint: '+10 ต่อรายงาน',
    positive: true,
    textClass: 'text-emerald-300', borderClass: 'border-emerald-500/25', bgClass: 'bg-emerald-500/10',
  },
  case: {
    key: 'case', label: 'ปิดเคสย่อย', hint: '+5 ต่อเคสที่ปิดสำเร็จ',
    positive: true,
    textClass: 'text-emerald-300', borderClass: 'border-emerald-500/25', bgClass: 'bg-emerald-500/10',
  },
  payment: {
    key: 'payment', label: 'รับชำระครบ', hint: '+5 ต่อ 1 รายการที่ชำระแล้ว',
    positive: true,
    textClass: 'text-emerald-300', borderClass: 'border-emerald-500/25', bgClass: 'bg-emerald-500/10',
  },
  absence: {
    key: 'absence', label: 'ขาดเวร', hint: '−5 ต่อสัปดาห์ที่ไม่เข้าเวร',
    positive: false,
    textClass: 'text-red-300', borderClass: 'border-red-500/25', bgClass: 'bg-red-500/10',
  },
  noreport: {
    key: 'noreport', label: 'ไม่ส่งรายงาน', hint: '−5 ต่อเวรที่ออกแล้วไม่ส่งรายงาน',
    positive: false,
    textClass: 'text-red-300', borderClass: 'border-red-500/25', bgClass: 'bg-red-500/10',
  },
  forced: {
    key: 'forced', label: 'ถูกบังคับออกเวร', hint: '−15 ต่อเวรที่ถูกบังคับออก',
    positive: false,
    textClass: 'text-red-300', borderClass: 'border-red-500/25', bgClass: 'bg-red-500/10',
  },
  complaint: {
    key: 'complaint', label: 'ร้องเรียนผลเป็นจริง', hint: '−30 ต่อเรื่องที่ยืนยันแล้ว',
    positive: false,
    textClass: 'text-red-300', borderClass: 'border-red-500/25', bgClass: 'bg-red-500/10',
  },
  reversal: {
    key: 'reversal', label: 'คืนคะแนน', hint: 'คืนคะแนนเมื่อยกเลิกอนุมัติหรือลบรายงาน',
    positive: false,
    textClass: 'text-blue-300', borderClass: 'border-blue-500/25', bgClass: 'bg-blue-500/10',
  },
  reset: {
    key: 'reset', label: 'รีเซ็ตงวด', hint: 'รีเซ็ตคะแนนงวดเดิม',
    positive: false,
    textClass: 'text-gray-300', borderClass: 'border-blue-900/40', bgClass: 'bg-navy-800/60',
  },
  manual: {
    key: 'manual', label: 'หัวหน้ากรมให้/หัก', hint: 'ปรับคะแนนโดยหัวหน้ากรม',
    positive: false,
    textClass: 'text-amber-300', borderClass: 'border-amber-500/25', bgClass: 'bg-amber-500/10',
  },
};

/**
 * จำแนกหมวดจากข้อความเหตุผล
 *
 * ตรวจ "คืนคะแนน/รีเซ็ต" ก่อน เพราะข้อความเหล่านั้นมีคำว่า
 * "ปิดเคส" หรือ "รายงาน" ปนอยู่ แล้วจะถูกจัดผิดหมวด
 */
export function pointsCategoryOf(reason: string): PointsCategoryKey {
  const r = (reason ?? '').trim();

  if (/รีเซ็ต|รีเซ็ตคะแนน|เริ่มงวดใหม่/.test(r)) return 'reset';
  if (/ยกเลิกการอนุมัติ|คืนคะแนน|กลับเป็นยังไม่เสร็จ|ลบรายงาน/.test(r)) return 'reversal';

  if (/บังคับ.*ออกเวร|ถูกบังคับ/.test(r)) return 'forced';
  if (/ร้องเรียน/.test(r)) return 'complaint';
  if (/ไม่เข้าเวร|ขาดเวร|ลงเวลาปฏิบัติหน้าที่ครบ/.test(r)) return 'absence';
  if (/ไม่ส่งรายงาน|ไม่ได้ส่งรายงาน/.test(r)) return 'noreport';

  if (/ค่าบริการ/.test(r)) return 'payment';
  if (/ปิดเคส/.test(r)) return 'case';
  if (/รายงานปฏิบัติงาน.*อนุมัติ|รายงาน.*ได้รับการอนุมัติ/.test(r)) return 'report';
  if (/ปฏิบัติหน้าที่ครบ|ชั่วโมง/.test(r)) return 'duty';

  return 'manual';
}

export interface PointsGroup {
  category: PointsCategory;
  entries: PointsLogEntry[];
  /** ผลรวมของกลุ่ม (บวก = ได้, ลบ = หัก) */
  total: number;
  count: number;
}

/**
 * จัดกลุ่มประวัติคะแนนตามหมวด
 *
 * เรียงตามลำดับที่เป็นหมวดบวกก่อน (ให้คะแนน) แล้วตามด้วยหมวดหัก
 * ภายในหมวดเรียงตามเวลาล่าสุดก่อน (log ถูกส่งมาใหม่สุดอยู่แล้ว)
 */
export function groupPointsLog(
  entries: PointsLogEntry[],
): PointsGroup[] {
  const buckets = new Map<PointsCategoryKey, PointsLogEntry[]>();

  for (const e of entries ?? []) {
    const key = pointsCategoryOf(e.reason);
    const list = buckets.get(key) ?? [];
    list.push(e);
    buckets.set(key, list);
  }

  const groups: PointsGroup[] = [];
  for (const [key, list] of buckets) {
    groups.push({
      category: POINTS_CATEGORIES[key],
      entries: list,
      count: list.length,
      total: list.reduce((sum, e) => sum + Number(e.delta ?? 0), 0),
    });
  }

  // บวกก่อน แล้วเรียงตามค่ารวม (ได้มากสุดขึ้นก่อน, หักมากสุดขึ้นก่อน)
  return groups.sort((a, b) => {
    if (a.category.positive !== b.category.positive) return a.category.positive ? -1 : 1;
    return b.total - a.total;
  });
}
