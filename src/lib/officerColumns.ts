/**
 * คอลัมน์ของตาราง `officers` ที่ปลอดภัยต่อการส่งออกไปยังเบราว์เซอร์
 *
 * เหตุผลที่ต้องระบุชื่อคอลัมน์ ไม่ใช่ใช้ `select('*')`
 * ─────────────────────────────────────────────────────────────
 * เดิมตาราง `officers` มี `password_hash` (SHA-256 ไม่มี salt)
 * และ anon อ่านตารางนี้ได้โดยไม่ต้องล็อกอิน
 * ผู้ใดก็ตามนำ hash ไป crack แบบ offline ได้ทันที
 *
 * migration 0043 ย้ายข้อมูลเข้าระบบไปไว้ใน schema `private` และลบคอลัมน์ออกแล้ว
 * กฎนี้ยังต้องมีไว้ เพราะ `select('*')` จะดึง `points_log` กับข้อมูลอื่น
 * ที่ไม่จำเป็นออกไปเปล่า ๆ และกันการเผลอเพิ่มคอลัมน์อันตรายกลับเข้ามา
 *
 * กฎ: ห้ามใช้ `select('*')` กับตาราง `officers` เด็ดขาด
 * ให้ใช้ค่าคงที่จากไฟล์นี้แทน แล้วเติมคอลัมน์พิเศษเมื่อจำเป็น
 */

/** คอลัมน์ที่หน้าสาธารณะใช้ได้ — ตัด `username` ออกด้วย เพราะเป็นรหัสที่ใช้เข้าระบบ */
export const OFFICER_PUBLIC_FIELDS = [
  'id', 'name', 'rank', 'department', 'generation', 'sort_order',
  'photo_url', 'is_on_duty',
].join(', ');

/**
 * คอลัมน์สำหรับหน้าของเจ้าหน้าที่ที่ล็อกอินแล้ว
 *
 * ⚠ ห้ามเพิ่ม `username` หรือ `password_hash` กลับเข้ามา
 * ทั้งสองคอลัมน์ถูกลบออกจากตารางแล้วใน migration 0043
 * (ย้ายไปเก็บใน schema `private` ที่ PostgREST มองไม่เห็น)
 *
 * ถ้าใส่คอลัมน์ที่ยังไม่มีในฐานข้อมูล PostgREST จะตอบ 400 ทั้ง request
 * ทำให้ทุกหน้าที่ใช้ค่านี้ (11 ไฟล์) โหลดข้อมูลไม่ขึ้นพร้อมกัน
 * เคยเกิดขึ้นแล้ว 2 ครั้ง จึงต้องยึดกฎนี้:
 *
 *   ⚠ เพิ่มคอลัมน์ใหม่ในรายการนี้ หลังรัน migration เสร็จเท่านั้น
 *     ถ้ายังไม่รัน migration แล้วเพิ่มก่อน → ทุกหน้าจะพังทันที
 *
 *   ถ้าจำเป็นต้องใช้คอลัมน์ใหม่ก่อนรัน migration
 *   ให้ใช้ select('*') แทน (ปลอดภัยได้เพราะ password_hash/username ถูกลบไปแล้วใน 0043)
 *
 * ถ้าหน้าไหนต้องการ username ให้ดึงแยกผ่าน `list_officer_usernames()`
 * (ดู `lib/api/officerUsernames.ts`)
 */
export const OFFICER_STAFF_FIELDS = [
  'id', 'name', 'rank', 'department', 'status', 'is_on_duty',
  'created_at', 'updated_at', 'photo_url', 'duty_rate', 'service_category',
  'points', 'points_period', 'points_log', 'accumulated_share',
  'generation', 'sort_order', 'last_login_at', 'last_login_ip',
].join(', ');
