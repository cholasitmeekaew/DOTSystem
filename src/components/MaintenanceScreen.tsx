/* =============================================================
 * MaintenanceScreen.tsx — หน้าแจ้งเตือนระบบปิดปรับปรุง
 * -------------------------------------------------------------
 * 3 โหมด: standard / readonly / emergency
 *
 * ข้อความทั้งหมดมาจาก Admin (แก้ได้จากหน้าตั้งค่า):
 *   maintenance_title    → หัวข้อ
 *   maintenance_subtitle → ข้อความรอง (ใต้หัวข้อ)
 *   maintenance_message  → เนื้อหา (กล่องด้านบนสุด)
 *   maintenance_eta      → เวลานับถอยหลัง
 * ============================================================= */

import { useState, useEffect } from 'react';
import { Wrench, EyeOff, ShieldAlert, LogOut, Timer, KeyRound, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { hashPassword } from '../lib/crypto';
import { COMMISSIONER_RANK, type Officer } from '../lib/types';

type MaintMode = 'standard' | 'readonly' | 'emergency';

interface MaintenanceScreenProps {
  mode?: MaintMode;
  title?: string | null;
  subtitle?: string | null;
  message?: string | null;
  eta?: string | null;
  onLogout?: () => void;
  officerName?: string;
  /** เรียกเมื่อหัวหน้ากรม login สำเร็จ → เข้าสู่ระบบหลังบ้าน */
  onBypass?: (officer: Officer) => void;
}

const MODE_CONFIG: Record<MaintMode, {
  icon: React.ReactNode;
  color: string;
  bg: string;
  border: string;
  defaultSubtitle: string;
}> = {
  standard: {
    icon: <Wrench size={40} className="text-amber-400" />,
    color: 'text-amber-300',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    defaultSubtitle: 'ระบบอยู่ระหว่างการบำรุงรักษา กรุณารอสักครู่แล้วลองใหม่อีกครั้ง',
  },
  readonly: {
    icon: <EyeOff size={40} className="text-yellow-400" />,
    color: 'text-yellow-300',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/30',
    defaultSubtitle: 'ขณะนี้เป็นโหมดดูข้อมูลอย่างเดียว ไม่สามารถทำรายการได้',
  },
  emergency: {
    icon: <ShieldAlert size={40} className="text-red-400" />,
    color: 'text-red-300',
    bg: 'bg-red-500/10',
    border: 'border-red-500/40',
    defaultSubtitle: 'ระบบกำลังปิดปรับปรุงกรณีเร่งด่วน กรุณารอประกาศอย่างเป็นทางการ',
  },
};

/**
 * นับถอยหลังจาก ETA → แสดง "hh:mm:ss"
 *
 * ถ้าหมดเวลาแล้ว แสดง "ครบกำหนดแล้ว"
 */
function useCountdown(eta: string | null | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!eta) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [eta]);

  if (!eta) return null;
  const target = new Date(eta).getTime();
  if (Number.isNaN(target)) return null;

  const diff = target - now;
  if (diff <= 0) return 'ครบกำหนดแล้ว';

  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const sec = Math.floor((diff % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}

/**
 * ปุ่มเข้าสู่ระบบสำหรับผู้ดูแล — มุมขวาล่างหน้า Maintenance
 *
 * Super Admin (หัวหน้ากรม) กรอก username + password แล้วเข้าระบบหลังบ้านได้
 * คนอื่นกรอกแล้วระบบ拒绝 (RPC login_officer คืน null)
 */
function QuickBypassLogin({ onBypass }: { onBypass?: (o: Officer) => void }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) return;
    setBusy(true);
    setErr('');
    try {
      const { data, error } = await supabase.rpc('login_officer', {
        p_username: username.trim(),
        p_password_hash: await hashPassword(password),
      });
      if (error || !data) {
        setErr('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
        return;
      }
      const officer = data as unknown as Officer;
      if (officer.rank !== COMMISSIONER_RANK) {
        setErr('เฉพาะหัวหน้ากรมเท่านั้นที่ข้ามได้');
        return;
      }
      onBypass?.(officer);
    } finally {
      setBusy(false);
    }
  }

  if (!onBypass) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {open ? (
        <form
          onSubmit={handleLogin}
          className="card p-4 w-72 border border-gray-700 shadow-2xl"
        >
          <div className="text-xs font-bold text-gray-300 mb-3 flex items-center gap-1.5">
            <KeyRound size={13} className="text-amber-400" />
            เข้าสู่ระบบสำหรับผู้ดูแล
          </div>
          <input
            className="input-field w-full text-sm mb-2"
            placeholder="ชื่อผู้ใช้"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
          <input
            type="password"
            className="input-field w-full text-sm mb-2"
            placeholder="รหัสผ่าน"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {err && <div className="text-[11px] text-red-400 mb-2">{err}</div>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="btn btn-primary flex-1 text-xs inline-flex items-center justify-center gap-1"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : null}
              เข้าสู่ระบบ
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setErr(''); }}
              className="btn btn-outline text-xs"
            >
              ยกเลิก
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="btn btn-outline text-xs inline-flex items-center gap-1.5 shadow-lg"
        >
          <KeyRound size={12} />
          เข้าสู่ระบบสำหรับผู้ดูแล
        </button>
      )}
    </div>
  );
}

export function MaintenanceScreen({
  mode = 'standard', title, subtitle, message, eta, onLogout, officerName, onBypass,
}: MaintenanceScreenProps) {
  const cfg = MODE_CONFIG[mode];
  const heading = title?.trim() || 'ปิดปรับปรุงระบบชั่วคราว';
  const sub = subtitle?.trim() || cfg.defaultSubtitle;
  const countdown = useCountdown(eta);

  return (
    <div className="min-h-screen bg-navy-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* ── ข้อความจาก Admin — ด้านหน้าสุด ── */}
        {message && (
          <div className={`card p-5 border-2 text-left ${cfg.border} ${cfg.bg} mb-5`}>
            <div className="text-[10px] text-gray-500 mb-1">ข้อความแจ้งเตือน</div>
            <p className={`text-base font-semibold leading-relaxed whitespace-pre-wrap ${cfg.color}`}>
              {message}
            </p>
          </div>
        )}

        {/* ── นับถอยหลัง ── */}
        {countdown && (
          <div className={`card p-4 border-2 text-left mb-5 ${cfg.border}`}>
            <div className="flex items-center gap-3">
              <Timer size={24} className={cfg.color} />
              <div>
                <div className="text-[10px] text-gray-500">คาดว่าจะเสร็จภายใน</div>
                <div className={`text-2xl font-mono font-bold tabular-nums ${cfg.color}`}>
                  {countdown}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── ไอคอน + หัวข้อ + ข้อความรอง ── */}
        <div className="text-left">
          <div className={`w-20 h-20 rounded-full ${cfg.bg} border-2 ${cfg.border} flex items-center justify-center mb-5`}>
            {cfg.icon}
          </div>
          <h1 className="text-xl font-bold text-white mb-2">{heading}</h1>
          <p className="text-sm text-gray-400 mb-6">{sub}</p>
        </div>

        {/* ชื่อบัญชีที่ถูกบล็อก */}
        {officerName && (
          <p className="text-[11px] text-gray-600 mb-4 text-left">
            บัญชี: {officerName}
          </p>
        )}

        {/* ปุ่มออกจากระบบ */}
        {onLogout && (
          <div className="text-left">
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

      {/* ปุ่มเข้าสู่ระบบสำหรับผู้ดูแล — มุมขวาล่าง */}
      <QuickBypassLogin onBypass={onBypass} />
    </div>
  );
}
