/**
 * คอลัมน์ของตาราง `officers` ที่ปลอดภัยต่อการส่งออกไปยังเบราว์เซอร์
 *
 * เหตุผลที่ต้องระบุชื่อคอลัมน์ ไม่ใช่ใช้ `select('*')`
 * ─────────────────────────────────────────────────────────────
 * ตาราง `officers` มีคอลัมน์ `password_hash` ซึ่งเป็น hash ของรหัสผ่าน
 * ถ้าใช้ `select('*')` ค่านี้จะถูกส่งกลับไปยังเบราว์เซอร์ทุกครั้งที่โหลดข้อมูล
 * และเพราะระบบนี้ยังไม่ได้เชื่อม Supabase Auth ตัว client ไม่มีสิทธิ์ใด ๆ
 * หน้าสาธารณะที่เปิดให้ไม่ต้องล็อกอินจึงดึง hash ของเจ้าหน้าที่ทุกคนไปได้
 * ผู้ใดก็ตามนำไป crack แบบ offline ได้ทันที (hash เป็น SHA-256 ไม่มี salt)
 *
 * กฎ: ห้ามใช้ `select('*')` กับตาราง `officers` เด็ดขาด
 * ให้ใช้ค่าคงที่จากไฟล์นี้แทน แล้วเติมคอลัมน์พิเศษเมื่อจำเป็น
 */

/** คอลัมน์ที่หน้าสาธารณะใช้ได้ — ตัด `username` ออกด้วย เพราะเป็นรหัสที่ใช้เข้าระบบ */
export const OFFICER_PUBLIC_FIELDS = [
  'id', 'name', 'rank', 'department', 'generation', 'sort_order',
  'photo_url', 'is_on_duty',
].join(', ');

/** คอลัมน์สำหรับหน้าของเจ้าหน้าที่ที่ล็อกอินแล้ว — ยังไม่รวม `password_hash` */
export const OFFICER_STAFF_FIELDS = [
  'id', 'username', 'name', 'rank', 'department', 'status', 'is_on_duty',
  'created_at', 'updated_at', 'photo_url', 'duty_rate', 'service_category',
  'points', 'points_period', 'points_log', 'accumulated_share',
  'generation', 'sort_order', 'last_login_at', 'last_login_ip',
].join(', ');
