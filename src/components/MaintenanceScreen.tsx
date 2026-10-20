/* =============================================================
 * MaintenanceScreen.tsx — หน้าแจ้งเตือนระบบปิดปรับปรุง
 * -------------------------------------------------------------
 * แสดงเมื่อ system_settings.maintenance_mode === true
 * ผู้ใช้ที่ไม่ใช่หัวหน้ากรมจะเห็นหน้านี้แทนทุกหน้าในระบบ
 *
 * หัวหน้ากรม (rank === 'commissioner') ไม่ถูกบล็อก
 * เพื่อให้เข้าไปปิดโหมด maintenance ได้จาก Admin Settings
 * ============================================================= */

import { Wrench, LogOut } from 'lucide-react';

interface MaintenanceScreenProps {
  /** ข้อความสาเหตุที่หัวหน้ากรมพิมพ์ไว้ */
  message?: string | null;
  /** ปุ่มออกจากระบบ (ให้กดได้เสมอ เพราะคนนี้เข้าระบบไม่ได้) */
  onLogout?: () => void;
  /** ชื่อผู้ใช้ที่ล็อกอิน (แสดงว่าบัญชีนี้ถูกบล็อก) */
  officerName?: string;
}

export function MaintenanceScreen({ message, onLogout, officerName }: MaintenanceScreenProps) {
  return (
    <div className="min-h-screen bg-navy-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        {/* ไอคอน */}
        <div className="w-20 h-20 rounded-full bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center mx-auto mb-6">
          <Wrench size={36} className="text-amber-400" />
        </div>

        {/* หัวข้อ */}
        <h1 className="text-xl font-bold text-white mb-2">
          ปิดปรับปรุงระบบชั่วคราว
        </h1>
        <p className="text-sm text-gray-400 mb-6">
          ระบบอยู่ระหว่างการบำรุงรักษา กรุณารอสักครู่แล้วลองใหม่อีกครั้ง
        </p>

        {/* ข้อความสาเหตุจากหัวหน้ากรม */}
        {message && (
          <div className="card p-4 border-amber-500/20 mb-6">
            <div className="text-[10px] text-gray-500 mb-1">รายละเอียด</div>
            <p className="text-sm text-amber-300 leading-relaxed whitespace-pre-wrap">
              {message}
            </p>
          </div>
        )}

        {/* ชื่อบัญชีที่ถูกบล็อก */}
        {officerName && (
          <p className="text-[11px] text-gray-600 mb-4">
            บัญชี: {officerName}
          </p>
        )}

        {/* ปุ่มออกจากระบบ */}
        {onLogout && (
          <button
            onClick={onLogout}
            className="btn btn-outline text-xs inline-flex items-center gap-1.5"
          >
            <LogOut size={13} />
            ออกจากระบบ
          </button>
        )}
      </div>
    </div>
  );
}
