/**
 * ตัดข้อมูลส่วนบุคคลของประชาชนออกจากข้อมูลแจ้งเหตุฉุกเฉิน
 *
 * หน้านี้เปิดให้ทุกเจ้าหน้าที่ดูได้ (เพื่อให้ไปช่วยเหตุได้)
 * แต่เฉพาะหัวหน้ากรมเท่านั้นที่ควรเห็นข้อมูลที่ระบุตัวประชาชนได้
 * จึงตัดออกตั้งแต่ขั้น query — ไม่ใช่แค่ซ่อนด้วย CSS เพราะข้อมูล
 * จะยังถูกส่งมาถึงเบราว์เซอร์ของเจ้าหน้าที่ทั่วไปอยู่ดี
 */

/** คอลัมน์ที่เจ้าหน้าที่ทุกระดับเห็นได้ (ไม่ระบุตัวประชาชน) */
export const EMERGENCY_PUBLIC_FIELDS =
  'id, report_type, status, responded_by, responded_by_name, created_at, updated_at';

/** คอลัมน์เต็มของหัวหน้ากรม (มีผู้ติดต่อ พิกัด รายละเอียด และหลักฐาน) */
export const EMERGENCY_FULL_FIELDS =
  'id, discord_username, report_type, details, location, image_url, status, responded_by, responded_by_name, created_at, updated_at';

/**
 * เติมช่องว่างแทนข้อมูลส่วนบุคคล — ใช้กรณีข้อมูลถูกโหลดมาเต็มอยู่แล้ว
 * (เช่นตอนเปิด Modal จาก state เดิม) เพื่อไม่ให้หลุดไปแสดงที่ไหนทั้งนั้น
 */
export function redactEmergencyPII<T extends {
  discord_username?: string | null;
  details?: string | null;
  location?: string | null;
  image_url?: string | null;
}>(report: T): T {
  return {
    ...report,
    discord_username: '—',
    details: 'ข้อมูลรายละเอียดถูกจำกัดสิทธิ์ (เฉพาะหัวหน้ากรม)',
    location: '',
    image_url: null,
  };
}

/** เลือกคอลัมน์ให้เหมาะกับสิทธิ์ของผู้ดู */
export function emergencyFieldsFor(isCommissioner: boolean): string {
  return isCommissioner ? EMERGENCY_FULL_FIELDS : EMERGENCY_PUBLIC_FIELDS;
}
