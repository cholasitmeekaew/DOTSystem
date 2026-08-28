import { useEffect, useState, useMemo } from 'react';
import {
  Clock, DollarSign, CalendarDays, History, Zap, Search, ArrowUpDown, User,
} from 'lucide-react';
import { Modal } from './Modal';
import { Badge } from './Badge';
import { supabase } from '../lib/supabase';
import {
  DutyLog, ServiceRecord, OfficerLeave, Officer,
  DEPARTMENT_LABELS, LEAVE_TYPE_LABELS, LEAVE_STATUS_LABELS, LeaveStatus,
} from '../lib/types';

interface Props {
  officer: Officer | null;
  onClose: () => void;
}

type TabKey = 'duty' | 'services' | 'leaves';
type SortDir = 'desc' | 'asc';

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('th-TH', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDuration(minutes: number | null): string {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} นาที`;
  if (m === 0) return `${h} ชม.`;
  return `${h} ชม. ${m} นาที`;
}

function leaveDays(start: string, end: string): number {
  return Math.floor((new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

const leaveVariant: Record<LeaveStatus, 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

export function OfficerHistoryModal({ officer, onClose }: Props) {
  const [tab, setTab] = useState<TabKey>('duty');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dutyLogs, setDutyLogs] = useState<DutyLog[]>([]);
  const [records, setRecords] = useState<ServiceRecord[]>([]);
  const [leaves, setLeaves] = useState<OfficerLeave[]>([]);
  const [searchQ, setSearchQ] = useState('');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!officer) return;
    setLoading(true);
    setError(null);
    Promise.all([
      supabase.from('duty_logs').select('*').eq('officer_id', officer.id).is('deleted_at', null).order('clock_in', { ascending: false }),
      supabase.from('service_records').select('*').eq('officer_id', officer.id).order('service_date', { ascending: false }),
      supabase.from('officer_leaves').select('*').eq('officer_id', officer.id).order('created_at', { ascending: false }),
    ]).then(([d, s, l]) => {
      if (d.error || s.error || l.error) {
        setError('ไม่สามารถโหลดข้อมูลประวัติได้');
      } else {
        setDutyLogs((d.data ?? []) as DutyLog[]);
        setRecords((s.data ?? []) as ServiceRecord[]);
        setLeaves((l.data ?? []) as OfficerLeave[]);
      }
      setLoading(false);
    }).catch((e) => {
      setError('เกิดข้อผิดพลาด: ' + (e?.message ?? 'Unknown'));
      setLoading(false);
    });
  }, [officer, retryKey]);

  const sortMultiplier = sortDir === 'desc' ? -1 : 1;

  const filteredDuty = useMemo(() => {
    let list = dutyLogs.filter((d) => !d.deleted_at);
    if (searchQ) {
      const q = searchQ.toLowerCase();
      list = list.filter((d) =>
        fmtDateTime(d.clock_in).toLowerCase().includes(q) ||
        (d.clock_out && fmtDateTime(d.clock_out).toLowerCase().includes(q)) ||
        (d.forced_by_name && d.forced_by_name.toLowerCase().includes(q))
      );
    }
    list.sort((a, b) => sortMultiplier * (new Date(a.clock_in).getTime() - new Date(b.clock_in).getTime()));
    return list;
  }, [dutyLogs, searchQ, sortMultiplier]);

  const filteredRecords = useMemo(() => {
    let list = [...records];
    if (searchQ) {
      const q = searchQ.toLowerCase();
      list = list.filter((r) =>
        r.service_name.toLowerCase().includes(q) ||
        r.notes?.toLowerCase().includes(q) ||
        fmtDate(r.service_date).toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => sortMultiplier * (new Date(a.service_date).getTime() - new Date(b.service_date).getTime()));
    return list;
  }, [records, searchQ, sortMultiplier]);

  const filteredLeaves = useMemo(() => {
    let list = [...leaves];
    if (searchQ) {
      const q = searchQ.toLowerCase();
      list = list.filter((l) =>
        LEAVE_TYPE_LABELS[l.leave_type].toLowerCase().includes(q) ||
        l.reason?.toLowerCase().includes(q) ||
        LEAVE_STATUS_LABELS[l.status].toLowerCase().includes(q)
      );
    }
    return list;
  }, [leaves, searchQ]);

  if (!officer) return null;

  const activeLogs = filteredDuty;
  const totalMinutes = dutyLogs.filter((d) => !d.deleted_at).reduce((sum, d) => sum + (d.duration_minutes ?? 0), 0);
  const totalAmount = records.reduce((sum, r) => sum + r.amount, 0);
  const unpaidAmount = records.filter((r) => r.status === 'unpaid').reduce((sum, r) => sum + r.amount, 0);
  const paidCount = records.filter((r) => r.status === 'paid').length;
  const unpaidCount = records.filter((r) => r.status === 'unpaid').length;

  const stats = [
    { icon: <Clock size={14} />, label: 'จำนวนเวร', value: activeLogs.length.toString(), color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
    { icon: <Zap size={14} />, label: 'ชั่วโมงรวม', value: fmtDuration(totalMinutes), color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
    { icon: <DollarSign size={14} />, label: 'รายการบริการ', value: records.length.toString(), color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
    { icon: <CalendarDays size={14} />, label: `ยอดรวม${unpaidAmount > 0 ? ` (ค้าง ${unpaidAmount.toLocaleString('th-TH')})` : ''}`, value: `${totalAmount.toLocaleString('th-TH')} BC`, color: 'text-pink-400 bg-pink-500/10 border-pink-500/20' },
  ];

  const tabs: { key: TabKey; label: string; icon: React.ReactNode; count: number }[] = [
    { key: 'duty', label: 'เข้าเวร / ออกเวร', icon: <Clock size={13} />, count: activeLogs.length },
    { key: 'services', label: 'แจ้งค่าบริการ', icon: <DollarSign size={13} />, count: records.length },
    { key: 'leaves', label: 'การลา', icon: <CalendarDays size={13} />, count: leaves.length },
  ];

  return (
    <Modal title="ประวัติการทำงาน" onClose={onClose} size="lg">
      {/* Officer identity */}
      <div className="flex items-center gap-4 pb-4 mb-4 border-b border-amber-500/20">
        <div className="w-14 h-14 rounded-xl overflow-hidden bg-blue-900 flex items-center justify-center flex-shrink-0 ring-2 ring-amber-500/40 shadow-lg shadow-amber-500/10">
          {officer?.photo_url ? (
            <img src={officer.photo_url} alt={officer?.name ?? ''} className="w-full h-full object-cover" />
          ) : (
            <span className="text-amber-400 font-bold text-xl">{(officer?.name ?? '?').charAt(0).toUpperCase()}</span>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-semibold">{officer?.name ?? 'ไม่ระบุชื่อ'}</span>
            <span className="text-xs text-gray-500 font-mono">@{officer?.username ?? 'unknown'}</span>
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {DEPARTMENT_LABELS[officer?.department as keyof typeof DEPARTMENT_LABELS] ?? 'ไม่ระบุแผนก'}
            {officer?.is_on_duty && (
              <span className="ml-2 text-emerald-400">● กำลังปฏิบัติหน้าที่</span>
            )}
          </div>
        </div>
      </div>

      {/* Stat chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        {stats.map((s) => (
          <div key={s.label} className={`gold-stat px-3 py-2 ${s.color}`}>
            <div className="flex items-center gap-1.5 text-[10px] opacity-90">{s.icon}{s.label}</div>
            <div className="text-sm font-bold mt-0.5 truncate">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-3 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setSearchQ(''); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              tab === t.key
                ? 'bg-amber-500 text-navy-900 shadow-md shadow-amber-500/20'
                : 'bg-navy-700/60 text-gray-400 hover:text-white border border-amber-500/10'
            }`}
          >
            {t.icon} {t.label}
            <span className={`px-1.5 rounded-full text-[10px] ${tab === t.key ? 'bg-navy-900/30' : 'bg-navy-600/60'}`}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* Search & Sort */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            className="input-field pl-8 text-xs py-2"
            placeholder="ค้นหา..."
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
          />
        </div>
        <button
          onClick={() => setSortDir((d) => d === 'desc' ? 'asc' : 'desc')}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-navy-700/60 border border-amber-500/10 text-gray-400 hover:text-white text-xs transition-all"
          title={sortDir === 'desc' ? 'ล่าสุดก่อน' : 'เก่าสุดก่อน'}
        >
          <ArrowUpDown size={12} />
          {sortDir === 'desc' ? 'ใหม่→เก่า' : 'เก่า→ใหม่'}
        </button>
      </div>

      {/* Content */}
      <div className="max-h-[42vh] overflow-y-auto pr-1 space-y-2">
        {error && (
          <div className="py-8 text-center">
            <p className="text-red-400 text-sm">{error}</p>
            <button
              onClick={() => { setRetryKey((k) => k + 1); }}
              className="mt-2 text-xs text-amber-400 hover:text-amber-300"
            >
              ลองใหม่
            </button>
          </div>
        )}
        {loading ? (
          <div className="py-12 text-center">
            <History size={28} className="text-gray-600 mx-auto mb-2 animate-pulse" />
            <p className="text-gray-500 text-sm">กำลังโหลดประวัติ...</p>
          </div>
        ) : tab === 'duty' && (
          filteredDuty.length === 0 ? (
            <EmptyState icon={<Clock size={28} />} text="ยังไม่มีประวัติการเข้าเวร" />
          ) : filteredDuty.map((d) => (
            <div key={d.id} className="card p-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-white text-sm font-medium">{fmtDateTime(d.clock_in)}</div>
                <div className="text-gray-500 text-xs mt-0.5">
                  {d.clock_out
                    ? <>ออกเวร {fmtDateTime(d.clock_out)}{d.checkout_method === 'forced' && d.forced_by_name && <span className="text-red-400"> • ถูกบังคับออกโดย {d.forced_by_name}</span>}</>
                    : <span className="text-emerald-400">● ยังไม่ได้ออกเวร</span>}
                </div>
              </div>
              <span className="text-xs font-mono bg-blue-500/10 text-blue-300 border border-blue-500/20 px-2.5 py-1 rounded-lg whitespace-nowrap">
                {fmtDuration(d.duration_minutes)}
              </span>
            </div>
          ))
        )}
        {tab === 'services' && (
          filteredRecords.length === 0 ? (
            <EmptyState icon={<DollarSign size={28} />} text="ยังไม่มีประวัติแจ้งค่าบริการ" />
          ) : (
            <>
              <div className="flex gap-2 mb-2">
                <span className="text-[10px] text-gray-500">ชำระแล้ว: <span className="text-emerald-400 font-semibold">{paidCount}</span></span>
                <span className="text-[10px] text-gray-500">ค้างชำระ: <span className="text-red-400 font-semibold">{unpaidCount}</span></span>
              </div>
              {filteredRecords.map((r) => (
                <div key={r.id} className="card p-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-white text-sm font-medium truncate">{r.service_name}</div>
                    <div className="text-gray-500 text-xs mt-0.5">
                      {fmtDate(r.service_date)}{r.notes ? ` • ${r.notes}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <span className="text-white text-sm font-semibold">{r.amount.toLocaleString('th-TH')} BC</span>
                    <Badge variant={r.status === 'paid' ? 'success' : 'danger'}>{r.status === 'paid' ? 'ชำระแล้ว' : 'ค้างชำระ'}</Badge>
                  </div>
                </div>
              ))}
            </>
          )
        )}
        {tab === 'leaves' && (
          filteredLeaves.length === 0 ? (
            <EmptyState icon={<CalendarDays size={28} />} text="ยังไม่มีประวัติการลา" />
          ) : filteredLeaves.map((l) => (
            <div key={l.id} className="card p-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-white text-sm font-medium">{LEAVE_TYPE_LABELS[l.leave_type]}</div>
                <div className="text-gray-500 text-xs mt-0.5">
                  {fmtDate(l.start_date)} → {fmtDate(l.end_date)} ({leaveDays(l.start_date, l.end_date)} วัน)
                  {l.reason ? ` • ${l.reason}` : ''}
                </div>
              </div>
              <Badge variant={leaveVariant[l.status]}>{LEAVE_STATUS_LABELS[l.status]}</Badge>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="py-12 text-center">
      <div className="text-gray-600 mx-auto mb-2 w-fit">{icon}</div>
      <p className="text-gray-500 text-sm">{text}</p>
    </div>
  );
}
