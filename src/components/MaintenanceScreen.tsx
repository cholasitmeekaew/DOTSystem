/* =============================================================
 * MaintenanceScreen.tsx — หน้าแจ้งเตือนระบบปิดปรับปรุง
 * -------------------------------------------------------------
 * 3 โหมด (migration 0053):
 *   standard  → 🟢 บล็อกทุกคน ยกเว้นหัวหน้ากรม
 *   readonly  → 🟡 บล็อกหน้า (ดูได้แต่ทำอะไรไม่ได้)
 *   emergency → 🔴 ล็อกทั้งหมด ยกเว้น Super Admin
 *
 * ข้อความจาก Admin แสดง "ด้านหน้า" (ด้านบนสุด) เห็นทันที
 * ============================================================= */

import { Wrench, EyeOff, ShieldAlert, LogOut } from 'lucide-react';

type MaintMode = 'standard' | 'readonly' | 'emergency';

interface MaintenanceScreenProps {
  mode?: MaintMode;
  title?: string | null;
  message?: string | null;
  onLogout?: () => void;
  officerName?: string;
}

const MODE_CONFIG: Record<MaintMode, {
  icon: React.ReactNode;
  color: string;
  bg: string;
  border: string;
  subtitle: string;
}> = {
  standard: {
    icon: <Wrench size={40} className="text-amber-400" />,
    color: 'text-amber-300',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    subtitle: 'ระบบอยู่ระหว่างการบำรุงรักษา กรุณารอสักครู่แล้วลองใหม่อีกครั้ง',
  },
  readonly: {
    icon: <EyeOff size={40} className="text-yellow-400" />,
    color: 'text-yellow-300',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/30',
    subtitle: 'ขณะนี้เป็นโหมดดูข้อมูลอย่างเดียว ไม่สามารถทำรายการได้',
  },
  emergency: {
    icon: <ShieldAlert size={40} className="text-red-400" />,
    color: 'text-red-300',
    bg: 'bg-red-500/10',
    border: 'border-red-500/40',
    subtitle: 'ระบบกำลังปิดปรับปรุงกรณีเร่งด่วน กรุณารอประกาศอย่างเป็นทางการ',
  },
};

export function MaintenanceScreen({ mode = 'standard', title, message, onLogout, officerName }: MaintenanceScreenProps) {
  const cfg = MODE_CONFIG[mode];
  const heading = title?.trim() || 'ปิดปรับปรุงระบบชั่วคราว';

  return (
    <div className="min-h-screen bg-navy-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* ── ข้อความจาก Admin อยู่ด้านหน้าสุด ── */}
        {message && (
          <div className={`card p-5 border-2 ${cfg.border} ${cfg.bg} mb-5`}>
            <div className="text-[10px] text-gray-500 mb-1">ข้อความแจ้งเตือน</div>
            <p className={`text-base font-semibold leading-relaxed whitespace-pre-wrap ${cfg.color}`}>
              {message}
            </p>
          </div>
        )}

        {/* ── ไอคอน + หัวข้อ ── */}
        <div className="text-center">
          <div className={`w-20 h-20 rounded-full ${cfg.bg} border-2 ${cfg.border} flex items-center justify-center mx-auto mb-5`}>
            {cfg.icon}
          </div>
          <h1 className="text-xl font-bold text-white mb-2">{heading}</h1>
          <p className="text-sm text-gray-400 mb-6">{cfg.subtitle}</p>
        </div>

        {/* ชื่อบัญชีที่ถูกบล็อก */}
        {officerName && (
          <p className="text-[11px] text-gray-600 mb-4 text-center">
            บัญชี: {officerName}
          </p>
        )}

        {/* ปุ่มออกจากระบบ */}
        {onLogout && (
          <div className="text-center">
            <button
              onClick={onLogout}
              className="btn btn-outline text-xs inline-flex items-center gap-1.5"
            >
              <LogOut size={13} />
              ออกจากระบบ
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
