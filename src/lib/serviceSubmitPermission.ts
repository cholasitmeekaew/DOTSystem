/* =============================================================
 * serviceSubmitPermission.ts
 * -------------------------------------------------------------
 * ใครมีสิทธิ์ "สร้างรายการแจ้งค่าบริการ" ในระบบ
 *
 * ทำไมถึงเก็บในโค้ด ไม่เก็บใน DB
 * ------------------------------
 * ตาราง system_settings มี policy แบบ "update using (true)"
 * (migration 0029) = ทุกคนที่ล็อกอินเข้ามาได้แก้ไขทุกคอลัมน์ได้
 * ถ้าเก็บรหัสผู้มีสิทธิ์ไว้ตรงนั้น เจ้าหน้าที่ทั่วไปก็แก้เป็นรหัสตัวเอง
 * แล้วสร้างรายการได้ทันที → ระบบจำกัดสิทธิ์จะโกงได้
 * เก็บในโค้ดจึงแข็งแรงกว่า เพราะการเปลี่ยนต้อง deploy โค้ดใหม่
 *
 * ⚠️ ข้อจำกัดที่ต้องทราบ
 * --------------------
 * ระบบนี้ไม่มี Supabase Auth (ล็อกอินด้วยตาราง officers + localStorage)
 * ทำให้ฝั่งฐานข้อมูลระบุไม่ได้ว่า "ใครกำลังเรียก" auth.uid() จึงเป็น NULL เสมอ
 * กลไกนี้จึงเป็นการ "ซ่อนปุ่ม/ฟอร์ม" ระดับ UI ไม่ใช่ขอบเขตความปลอดภัยจริง
 * ใครมีสิทธิ์แก้โค้ดหรือเปิด DevTools ก็ยังยิง insert เข้า service_records ได้โดยตรง
 * ถ้าต้องการบังคับจริงระดับ DB ต้องเพิ่ม Supabase Auth ก่อน
 * ============================================================= */

import type { Officer } from './types';

/**
 * officer_id ที่มีสิทธิ์สร้างรายการแจ้งค่าบริการ
 * ใส่รหัส UUID ของตัวเองได้ที่นี่ที่เดียว ถ้ายังว่างจะ fallback เป็น "หัวหน้ากรม"
 */
export const SERVICE_SUBMIT_OFFICER_IDS: string[] = [
  // TODO: ใส่ officer_id ของผู้ที่ได้รับอนุญาต เช่น
  // 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx',
];

/** ข้อความที่แสดงให้คนที่ไม่มีสิทธิ์เห็น */
export const SERVICE_SUBMIT_DENIED_MESSAGE =
  'ไม่สามารถแจ้งในระบบได้ กรุณาแจ้งในช่องแจ้งค่าบริการในเซิร์ฟเวอร์ดิสคอร์ด (Discord)';

export interface ServiceSubmitPermission {
  /** รวมรหัสใน allowlist + หัวหน้ากรม (fallback) */
  allowedIds: string[];
  /** ยังไม่ได้ตั้ง allowlist อยู่ → ใช้หัวหน้ากรมแทน */
  usingFallback: boolean;
}

/** ตรวจว่าเจ้าหน้าที่คนนี้สร้างรายการแจ้งค่าบริการได้ไหม */
export function canSubmitServiceRecord(
  officer: Pick<Officer, 'id' | 'rank'> | null | undefined,
): boolean {
  if (!officer) return false;

  const ids = SERVICE_SUBMIT_OFFICER_IDS.map((s) => s.trim()).filter(Boolean);
  if (ids.includes(officer.id)) return true;

  // ยังไม่ได้ตั้ง allowlist → ปล่อยให้หัวหน้ากรม (deny by default)
  if (ids.length === 0) return officer.rank === 'commissioner';

  // ตั้ง allowlist แล้ว = ต้องมีอยู่ในรายชื่อเท่านั้น หัวหน้ากรมไม่มีสิทธิ์เกิน
  return false;
}

export function serviceSubmitPermissionInfo(): ServiceSubmitPermission {
  const ids = SERVICE_SUBMIT_OFFICER_IDS.map((s) => s.trim()).filter(Boolean);
  return { allowedIds: ids, usingFallback: ids.length === 0 };
}
