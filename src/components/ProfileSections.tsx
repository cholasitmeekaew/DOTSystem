/* =============================================================
 * ProfileSections.tsx — แท็บข้อมูลเสริมของหน้าข้อมูลส่วนตัว
 * -------------------------------------------------------------
 * ทุกอย่างมาจาก fetchProfileExtra() ซึ่งกรองด้วย officer.id ของผู้ล็อกอิน
 * ============================================================= */

import { useState } from 'react';
import {
  Car, DollarSign, Siren, MessageSquare, Activity, Megaphone, ChevronDown,
  ChevronUp, CheckCircle2, XCircle, Clock, Pin, Info, Wrench,
} from 'lucide-react';
import type { ProfileExtra, IncidentRow, ServiceRow } from '../lib/profileData';
import { Globe, LogIn, MonitorSmartphone, Info as InfoIcon } from 'lucide-react';

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

const money = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 0 });

function StatusChip({ status }: { status: string | null }) {
  const s = (status ?? '').toLowerCase();
  const tone = /approved|paid|resolved|completed|released/.test(s)
    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
    : /reject|dismiss|cancel|unpaid/.test(s)
      ? 'bg-red-500/15 text-red-300 border-red-500/40'
      : 'bg-amber-500/15 text-amber-300 border-amber-500/40';
  return (
    <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold ${tone}`}>
      {status ?? '—'}
    </span>
  );
}

/** กล่องข้อความแจ้งว่าข้อมูลชนิดนี้ระบบยังไม่มีที่เก็บ */
function NotStored({ what, why }: { what: string; why: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-blue-900/40 bg-navy-900/40 px-3.5 py-3">
      <Info size={15} className="text-blue-400 mt-0.5 flex-shrink-0" />
      <div className="text-[11px] leading-relaxed">
        <div className="font-semibold text-gray-300">{what}</div>
        <div className="text-gray-500 mt-0.5">{why}</div>
      </div>
    </div>
  );
}

/** หัวข้อย่อยแบบยุบ/ขยาย */
function Accordion({
  title, count, icon: Icon, children, defaultOpen = false, tone = 'text-gray-300',
}: {
  title: string; count: number; icon: typeof Car; children: React.ReactNode;
  defaultOpen?: boolean; tone?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-blue-900/40 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-navy-900/60 hover:bg-navy-800 transition-colors"
      >
        <Icon size={13} className="text-gray-500 flex-shrink-0" />
        <span className={`text-[11px] font-semibold flex-1 text-left ${tone}`}>{title}</span>
        <span className="text-[10px] text-gray-500 font-mono">{count}</span>
        {open ? <ChevronUp size={13} className="text-gray-500" /> : <ChevronDown size={13} className="text-gray-500" />}
      </button>
      {open && <div className="p-2.5 space-y-1.5 border-t border-blue-900/40">{children}</div>}
    </div>
  );
}

/* ============================ ยานพาหนะ ============================ */

function VehiclesTab({ data }: { data: ProfileExtra }) {
  const { impounded, released } = data.vehicles;
  const row = (v: ProfileExtra['vehicles']['impounded'][number]) => (
    <div key={v.id} className="flex items-center gap-2 rounded px-2 py-1.5 bg-navy-900/40 border border-blue-900/30">
      <Car size={12} className="text-cyan-400 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-gray-200 font-mono">{v.license_plate}</div>
        <div className="text-[10px] text-gray-500 truncate">
          {[v.brand_model, v.color, v.owner_name].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-[10px] text-gray-400">{fmtDate(v.impounded_at ?? v.released_at)}</div>
        <div className="text-[10px] text-gray-600 truncate max-w-[140px]">{v.impound_location ?? ''}</div>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <NotStored
        what="ยังไม่มีระบบบันทึกการเบิก/นำรถหน่วยงานออก-คืน"
        why="ตาราง vehicles ที่มีอยู่คือทะเบียนรถของประชาชน ไม่ใช่รถหน่วยงาน และไม่มีตาราง checkout/return — ต้องสร้างตารางใหม่จึงจะบันทึกได้"
      />
      <NotStored
        what="ยังไม่มีระบบบันทึกการแจ้งซ่อม/บำรุงรักษา"
        why="ไม่พบตารางบันทึกงานซ่อมของรถในระบบ"
      />

      <Accordion title="รถที่คุณสั่งยึด" count={impounded.length} icon={Car} tone="text-cyan-300">
        {impounded.length === 0
          ? <div className="text-[11px] text-gray-600 py-1">ไม่พบรายการ</div>
          : impounded.map(row)}
      </Accordion>

      <Accordion title="รถที่คุณปลดยึด" count={released.length} icon={CheckCircle2} tone="text-emerald-300">
        {released.length === 0
          ? <div className="text-[11px] text-gray-600 py-1">ไม่พบรายการ</div>
          : released.map(row)}
      </Accordion>
    </div>
  );
}

/* ============================ ค่าบริการ ============================ */

function ServiceRowItem({ r }: { r: ServiceRow }) {
  const amt = Number(r.amount) || 0;
  const paid = Number(r.paid_amount) || 0;
  return (
    <div className="flex items-center gap-2 rounded px-2 py-1.5 bg-navy-900/40 border border-blue-900/30">
      <DollarSign size={12} className="text-amber-400 flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-gray-200 truncate">{r.service_name ?? '—'}</div>
        <div className="text-[10px] text-gray-500 truncate">
          {[r.roblox_username, fmtDate(r.service_date)].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-[11px] font-bold text-amber-300">{money(amt)}</div>
        <div className="text-[10px] text-gray-500">จ่าย {money(paid)}</div>
      </div>
      <StatusChip status={r.status} />
    </div>
  );
}

function ServicesTab({ data }: { data: ProfileExtra }) {
  const s = data.services.stats;
  const box = (label: string, value: string, tint = 'text-white') => (
    <div className="rounded-lg bg-navy-900/50 border border-blue-900/40 px-3 py-2">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className={`text-sm font-bold mt-0.5 ${tint}`}>{value}</div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        {box('เคสที่ลงบันทึก', `${s.createdCount} เคส`)}
        {box('ยอดรวมที่แจ้ง', money(s.totalAmount), 'text-amber-300')}
        {box('รับเงินแล้ว', money(s.paidAmount), 'text-emerald-300')}
        {box('ส่วนแบ่งสะสม', money(s.accumulatedShare), 'text-purple-300')}
      </div>

      <Accordion title="รายการที่คุณลงบันทึก" count={data.services.created.length} icon={DollarSign} tone="text-amber-300">
        {data.services.created.length === 0
          ? <div className="text-[11px] text-gray-600 py-1">ไม่พบรายการ</div>
          : data.services.created.map((r) => <ServiceRowItem key={r.id} r={r} />)}
      </Accordion>

      <Accordion title="รายการที่คุณร่วมทำ (ถูกมอบหมาย)" count={data.services.assigned.length} icon={CheckCircle2} tone="text-blue-300">
        {data.services.assigned.length === 0
          ? <div className="text-[11px] text-gray-600 py-1">ไม่พบรายการ</div>
          : data.services.assigned.map((r) => <ServiceRowItem key={r.id} r={r} />)}
      </Accordion>
    </div>
  );
}

/* ====================== เหตุฉุกเฉิน / ร้องเรียน ====================== */

function IncidentItem({ r }: { r: IncidentRow }) {
  const Icon = r.type === 'emergency' ? Siren : MessageSquare;
  return (
    <div className="flex items-start gap-2 rounded px-2 py-1.5 bg-navy-900/40 border border-blue-900/30">
      <Icon size={12} className={`flex-shrink-0 mt-0.5 ${r.type === 'emergency' ? 'text-red-400' : 'text-amber-400'}`} />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-gray-200 truncate">{r.title}</div>
        <div className="text-[10px] text-gray-500 truncate">{r.detail || '—'}</div>
        <div className="text-[10px] text-gray-600 mt-0.5">{r.role} · {fmtDateTime(r.when)}</div>
      </div>
      <StatusChip status={r.status} />
    </div>
  );
}

function IncidentsTab({ data }: { data: ProfileExtra }) {
  return (
    <div className="space-y-3">
      <Accordion title="เหตุฉุกเฉินที่คุณเข้ารับช่วยเหลือ" count={data.incidents.emergency.length}
        icon={Siren} tone="text-red-300" defaultOpen>
        {data.incidents.emergency.length === 0
          ? <div className="text-[11px] text-gray-600 py-1">ยังไม่เคยรับช่วยเหลือเหตุฉุกเฉิน</div>
          : data.incidents.emergency.map((r) => <IncidentItem key={r.id} r={r} />)}
      </Accordion>

      <Accordion title="เรื่องร้องเรียนที่เกี่ยวกับคุณ" count={data.incidents.complaints.length}
        icon={MessageSquare} tone="text-amber-300">
        {data.incidents.complaints.length === 0
          ? <div className="text-[11px] text-gray-600 py-1">ไม่พบเรื่องร้องเรียน</div>
          : data.incidents.complaints.map((r) => <IncidentItem key={r.id} r={r} />)}
      </Accordion>
      <p className="text-[10px] text-gray-600 leading-relaxed">
        เรื่องร้องเรียนเก็บชื่อเจ้าหน้าที่เป็นข้อความ (ไม่มี ID) จึงจับคู่ด้วยชื่อ — ถ้าเปลี่ยนชื่อในโปรไฟล์ รายการเก่าจะไม่ปรากฏ
      </p>
    </div>
  );
}

/* ============================ กิจกรรม ============================ */

function LoginHistory({ data }: { data: ProfileExtra }) {
  if (data.loginUnavailable) {
    return (
      <NotStored
        what="ยังไม่ได้เปิดใช้ประวัติการเข้าสู่ระบบ"
        why="ต้องรัน migration 0033_login_history.sql ก่อน (สร้างตาราง officer_login_logs และฟังก์ชัน log_officer_login)"
      />
    );
  }

  const first = data.logins[0];

  return (
    <div className="space-y-2.5">
      {first && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="rounded-lg bg-navy-900/50 border border-blue-900/40 px-3 py-2">
            <div className="text-[10px] text-gray-500 flex items-center gap-1">
              <LogIn size={10} /> เข้าสู่ระบบล่าสุด
            </div>
            <div className="text-[11px] font-semibold text-white mt-0.5">{fmtDateTime(first.logged_in_at)}</div>
          </div>
          <div className="rounded-lg bg-navy-900/50 border border-blue-900/40 px-3 py-2">
            <div className="text-[10px] text-gray-500 flex items-center gap-1">
              <Globe size={10} /> IP Address
            </div>
            <div className="text-[11px] font-mono text-cyan-300 mt-0.5">{first.ip_address ?? 'ไม่ทราบ'}</div>
          </div>
          <div className="rounded-lg bg-navy-900/50 border border-blue-900/40 px-3 py-2">
            <div className="text-[10px] text-gray-500 flex items-center gap-1">
              <MonitorSmartphone size={10} /> อุปกรณ์
            </div>
            <div className="text-[11px] font-semibold text-gray-200 mt-0.5">{first.device ?? 'ไม่ทราบ'}</div>
          </div>
        </div>
      )}

      <Accordion title="ประวัติการเข้าสู่ระบบ" count={data.logins.length} icon={LogIn} tone="text-cyan-300" defaultOpen>
        {data.logins.length === 0 ? (
          <div className="text-[11px] text-gray-600 py-1">ยังไม่มีประวัติ (จะเริ่มบันทึกตั้งแต่การเข้าสู่ระบบครั้งถัดไป)</div>
        ) : data.logins.map((l) => (
          <div key={l.id} className="flex items-center gap-2 rounded px-2 py-1.5 bg-navy-900/40 border border-blue-900/30">
            <LogIn size={12} className="text-cyan-400 flex-shrink-0" />
            <span className="text-[11px] text-gray-300 flex-1 min-w-0 truncate font-mono">
              {l.ip_address ?? 'ไม่ทราบ IP'}
            </span>
            <span className="text-[10px] text-gray-500 flex-shrink-0">{l.device ?? '—'}</span>
            <span className="text-[10px] text-gray-600 flex-shrink-0">{fmtDateTime(l.logged_in_at)}</span>
          </div>
        ))}
      </Accordion>

      <p className="text-[10px] text-gray-600 leading-relaxed flex items-start gap-1">
        <InfoIcon size={10} className="mt-0.5 flex-shrink-0" />
        IP ถูกอ่านฝั่งเซิร์ฟเวอร์จาก x-forwarded-for จึงแก้ไขจากฝั่งผู้ใช้ไม่ได้
      </p>
    </div>
  );
}

function ActivityTab({ data }: { data: ProfileExtra }) {
  return (
    <div className="space-y-3">
      <LoginHistory data={data} />

      <Accordion title="ประกาศล่าสุด" count={data.announcements.length} icon={Megaphone} tone="text-indigo-300">
        {data.announcements.length === 0
          ? <div className="text-[11px] text-gray-600 py-1">ยังไม่มีประกาศ</div>
          : data.announcements.map((a) => (
            <div key={a.id} className="flex items-start gap-2 rounded px-2 py-1.5 bg-navy-900/40 border border-blue-900/30">
              {a.is_pinned
                ? <Pin size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
                : <Megaphone size={12} className="text-indigo-400 flex-shrink-0 mt-0.5" />}
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-gray-200 truncate">{a.title}</div>
                <div className="text-[10px] text-gray-500">{fmtDate(a.created_at)}</div>
              </div>
            </div>
          ))}
      </Accordion>

      <Accordion title="กิจกรรมของคุณล่าสุด" count={data.activity.length} icon={Activity} tone="text-purple-300">
        {data.activity.length === 0
          ? <div className="text-[11px] text-gray-600 py-1">ไม่พบกิจกรรม</div>
          : data.activity.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded px-2 py-1.5 bg-navy-900/40 border border-blue-900/30">
              <Clock size={12} className="text-gray-500 flex-shrink-0" />
              <span className="text-[11px] text-gray-300 flex-1 min-w-0 truncate font-mono">{a.action}</span>
              <span className="text-[10px] text-gray-600 flex-shrink-0">{fmtDateTime(a.at)}</span>
            </div>
          ))}
      </Accordion>
    </div>
  );
}

/* ============================ แท็บ ============================ */

const TABS = [
  { id: 'vehicles', label: 'ยานพาหนะ', icon: Car },
  { id: 'services', label: 'ค่าบริการ', icon: DollarSign },
  { id: 'incidents', label: 'เหตุ / ร้องเรียน', icon: Siren },
  { id: 'activity', label: 'กิจกรรม', icon: Activity },
] as const;

export type ProfileTabId = typeof TABS[number]['id'];

export function ProfileExtraTabs({
  data, tab, onTab, loading,
}: {
  data: ProfileExtra;
  tab: ProfileTabId;
  onTab: (t: ProfileTabId) => void;
  loading: boolean;
}) {
  const count: Record<ProfileTabId, number> = {
    vehicles: data.vehicles.impounded.length + data.vehicles.released.length,
    services: data.services.created.length + data.services.assigned.length,
    incidents: data.incidents.emergency.length + data.incidents.complaints.length,
    activity: data.activity.length,
  };

  return (
    <div>
      <div className="flex items-center gap-1 p-1.5 rounded-xl bg-navy-900/60 border border-blue-900/40 overflow-x-auto scrollbar-thin">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onTab(t.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors ${
                active
                  ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
                  : 'text-gray-400 hover:text-white border border-transparent'
              }`}
            >
              <Icon size={12} />
              {t.label}
              {!loading && count[t.id] > 0 && (
                <span className="font-mono text-[10px] text-gray-500">{count[t.id]}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3">
        {loading ? (
          <div className="text-center text-gray-500 py-8 text-xs">กำลังโหลดข้อมูล...</div>
        ) : tab === 'vehicles' ? <VehiclesTab data={data} />
          : tab === 'services' ? <ServicesTab data={data} />
            : tab === 'incidents' ? <IncidentsTab data={data} />
              : <ActivityTab data={data} />}
      </div>
    </div>
  );
}

export { XCircle, Wrench };
