/**
 * แถบดำไล่ระดับด้านล่างการ์ด
 *
 * ใช้กับการ์ดที่มีภาพพื้นหลัง (รูปเจ้าหน้าที่, ภาพลวดลาย, แสงเรือง)
 * เพื่อให้ตัวอักษรสีขาวที่วางทับอยู่บนภาพอ่านออกชัดเจน
 * ไม่ว่าภาพนั้นจะสว่างหรือมืดแค่ไหน
 *
 * ใช้งาน: <div className="... relative overflow-hidden"> ... <BackdropScrim /> ... </div>
 */
export function BackdropScrim({
  className = '',
  /** ความเข้มของแถบ (0–1) */
  intensity = 0.75,
}: {
  className?: string;
  intensity?: number;
}) {
  return (
    <div
      aria-hidden="true"
      className={`absolute inset-x-0 bottom-0 pointer-events-none ${className}`}
      style={{
        height: '55%',
        background: `linear-gradient(to top,
          rgba(2, 6, 23, ${intensity}) 0%,
          rgba(2, 6, 23, ${intensity * 0.75}) 25%,
          rgba(2, 6, 23, ${intensity * 0.4}) 55%,
          rgba(2, 6, 23, 0) 100%)`,
      }}
    />
  );
}
