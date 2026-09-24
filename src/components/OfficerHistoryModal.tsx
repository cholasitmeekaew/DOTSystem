import { useEffect, useState, useMemo } from 'react';
import {
  Clock, DollarSign, CalendarDays, History, Zap, Search, ArrowUpDown, User, TrendingUp, Edit2, Save, X as XIcon,
  HandCoins, Wallet, RefreshCw, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { Modal } from './Modal';
import { Badge } from './Badge';
import { ClaimShareModal } from './ClaimShareModal';
import { supabase } from '../lib/supabase';
import {
  DutyLog, ServiceRecord, OfficerLeave, Officer, Citizen,
  DEPARTMENT_LABELS, LEAVE_TYPE_LABELS, LEAVE_STATUS_LABELS, LeaveStatus,
  ClaimRecord,
} from '../lib/types';
import { calculateRevenueAndDebtSummary, getRemainingDebt } from '../lib/citizenDebt';
import {
  computeMonthlyIncome, loadOverrides, saveOverride, MonthlyIncome,
} from '../lib/api/officerStats';
import {
  previewClaimShare, fetchOfficerClaims, ClaimScope,
} from '../lib/api/claimShare';

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
  const [dutyLogs, setDutyLogs] = useState<DutyLog[]>([]);
  const [records, setRecords] = useState<ServiceRecord[]>([]);
  const [citizens, setCitizens] = useState<Pick<Citizen, 'id' | 'status' | 'roblox_username'>[]>([]);
  const [leaves, setLeaves] = useState<OfficerLeave[]>([]);
  const [recordOfficerCounts, setRecordOfficerCounts] = useState<Map<string, number>>(new Map());
  const [searchQ, setSearchQ] = useState('');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // รายได้เฉลี่ย
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [editingMonth, setEditingMonth] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [showIncomeDetail, setShowIncomeDetail] = useState(false);

  // Claim share state
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [claimSummary, setClaimSummary] = useState<{ scope: ClaimScope; count: number; amount: number }[]>([]);
  const [claimHistory, setClaimHistory] = useState<ClaimRecord[]>([]);
  const [claimLoading, setClaimLoading] = useState(false);

  useEffect(() => {
    if (!officer) return;
    setLoading(true);
    Promise.all([
      supabase.from('duty_logs').select('*').eq('officer_id', officer.id).is('deleted_at', null).order('clock_in', { ascending: false }),
      supabase.from('service_records').select('*').order('service_date', { ascending: false }),
      supabase.from('service_record_officers').select('service_record_id, officer_id'),
      supabase.from('officer_leaves').select('*').eq('officer_id', officer.id).order('created_at', { ascending: false }),
    ]).then(([d, s, sro, l]) => {
      setDutyLogs((d.data ?? []) as DutyLog[]);
      const allRecords = (s.data ?? []) as ServiceRecord[];
      const allSro = (sro.data ?? []) as { service_record_id: string; officer_id: string }[];

      // สร้าง map: record_id -> [officer_ids]
      const sroMap = new Map<string, string[]>();
      for (const row of allSro) {
        const list = sroMap.get(row.service_record_id) ?? [];
        list.push(row.officer_id);
        sroMap.set(row.service_record_id, list);
      }

      // กรองเฉพาะเคสที่เจ้าหน้าที่คนนี้ดูแล
      const myRecords = allRecords.filter((r) => {
        const assigned = sroMap.get(r.id);
        if (assigned && assigned.length > 0) {
          return assigned.includes(officer.id);
        }
        return r.officer_id === officer.id;
      });

      // สร้าง map จำนวนเจ้าหน้าที่ต่อเคส (สำหรับหารเฉลี่ยรายได้)
      const counts = new Map<string, number>();
      for (const r of myRecords) {
        const assigned = sroMap.get(r.id);
        counts.set(r.id, assigned && assigned.length > 0 ? assigned.length : 1);
      }
      setRecordOfficerCounts(counts);

      setRecords(myRecords);
      setLeaves((l.data ?? []) as OfficerLeave[]);
      setLoading(false);
    }).catch(() => {
      // โหลดหลักล้มเหลว — ปลด loading เพื่อไม่ให้ค้าง
      setLoading(false);
    });
    // ดึงรายชื่อประชาชนแยกต่างหาก — ล้มเหลวต้องไม่กระทบ modal เด็ดขาด
    supabase.from('citizens').select('id, status, roblox_username').then(({ data }: { data: unknown }) => {
      setCitizens((data ?? []) as Pick<Citizen, 'id' | 'status' | 'roblox_username'>[]);
    }).catch(() => { /* คงยอดแบบไม่หักสถานะ */ });
    setOverrides(loadOverrides(officer.id));
  }, [officer]);

  async function loadClaimSummary() {
    if (!officer) return;
    setClaimLoading(true);
    const period = new Date().toISOString().slice(0, 7);
    try {
      const [defaultP, rescueP, history] = await Promise.all([
        previewClaimShare(officer.id, period, 'default'),
        previewClaimShare(officer.id, period, 'vehicle_rescue'),
        fetchOfficerClaims(officer.id),
      ]);
      setClaimSummary([
        { scope: 'default', count: defaultP.record_count, amount: defaultP.per_officer_total },
        { scope: 'vehicle_rescue', count: rescueP.record_count, amount: rescueP.per_officer_total },
      ]);
      setClaimHistory(history.slice(0, 5));
    } catch (e) {
      console.warn('[OfficerHistoryModal] loadClaimSummary error:', e);
    } finally {
      setClaimLoading(false);
    }
  }

  useEffect(() => {
    if (officer) loadClaimSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officer?.id]);

  const sortMultiplier = sortDir === 'desc' ? -1 : 1;

  const filteredDuty = useMemo(() => {
    let list = [...dutyLogs.filter((d) => !d.deleted_at)];
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
  }, [dutyLogs, searchQ, sortDir, sortMultiplier]);

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
    list.sort((a, b) => sortMultiplier * (a.amount - b.amount));
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

  const income = useMemo(() => {
    if (!officer) return { months: [], average: 0, hasOverride: false };
    return computeMonthlyIncome(officer, dutyLogs, records, overrides, recordOfficerCounts);
  }, [officer, dutyLogs, records, overrides, recordOfficerCounts]);

  // สูตรเดียวกับ Dashboard/สถิติหน่วยงาน: ชำระแล้วรวมยอดผ่อน, ค้าง = ยอดคงเหลือ, กันยอดแบน/ระงับออก
  // (ต้องอยู่เหนือ early return — hook ห้ามอยู่หลัง return เด็ดขาด)
  const debtSummary = useMemo(
    () => calculateRevenueAndDebtSummary(records, citizens),
    [records, citizens],
  );

  if (!officer) return null;

  const activeLogs = dutyLogs.filter((d) => !d.deleted_at);
  const totalMinutes = activeLogs.reduce((sum, d) => sum + (d.duration_minutes ?? 0), 0);
  const paidTotal = debtSummary.paidTotal;
  const unpaidTotal = debtSummary.unpaidTotal;
  const paidCount = debtSummary.paidCount;
  const unpaidCount = debtSummary.unpaidCount;

  const stats = [
    { icon: <Clock size={14} />, label: 'จำนวนเวร', value: activeLogs.length.toString(), color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
    { icon: <Zap size={14} />, label: 'ชั่วโมงรวม', value: fmtDuration(totalMinutes), color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
    { icon: <DollarSign size={14} />, label: 'รายการบริการ', value: records.length.toString(), color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
    { icon: <CheckCircle2 size={14} />, label: `ชำระแล้ว (${paidCount})`, value: `${paidTotal.toLocaleString('th-TH')} BC`, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
    { icon: <AlertTriangle size={14} />, label: `ค้างชำระ (${unpaidCount})`, value: `${unpaidTotal.toLocaleString('th-TH')} BC`, color: 'text-pink-400 bg-pink-500/10 border-pink-500/20' },
    { icon: <Wallet size={14} />, label: 'ยอดสะสมรอจ่าย', value: `${(officer.accumulated_share ?? 0).toLocaleString('th-TH')} BC`, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
    { icon: <TrendingUp size={14} />, label: 'รายได้เฉลี่ย/เดือน', value: `${income.average.toLocaleString('th-TH', { maximumFractionDigits: 0 })} BC`, color: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
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
          {officer.photo_url ? (
            <img src={officer.photo_url} alt={officer.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-amber-400 font-bold text-xl">{officer.name.charAt(0).toUpperCase()}</span>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-semibold">{officer.name}</span>
            <span className="text-xs text-gray-500 font-mono">@{officer.username}</span>
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {DEPARTMENT_LABELS[officer.department]}
            {officer.is_on_duty && (
              <span className="ml-2 text-emerald-400">● กำลังปฏิบัติหน้าที่</span>
            )}
          </div>
        </div>
      </div>

      {/* Stat chips */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        {stats.map((s) => (
          <div key={s.label} className={`gold-stat px-3 py-2 ${s.color}`}>
            <div className="flex items-center gap-1.5 text-[10px] opacity-90">{s.icon}{s.label}</div>
            <div className="text-sm font-bold mt-0.5 truncate">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Claim Service Share — All Paid Services */}
      <div className="card p-3 mb-3 bg-gradient-to-br from-amber-500/5 to-amber-500/0 border-amber-500/20">
        <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <HandCoins size={14} className="text-amber-400" />
              <h3 className="text-sm font-semibold text-amber-300">ส่วนแบ่งเคสรอรับ (เดือนนี้)</h3>
              <button
                onClick={loadClaimSummary}
                disabled={claimLoading}
                className="text-gray-500 hover:text-amber-400 transition-colors"
                title="รีเฟรช"
              >
                <RefreshCw size={12} className={claimLoading ? 'animate-spin' : ''} />
              </button>
            </div>
            <p className="text-[10px] text-gray-500 mt-0.5">All Paid Services · รวมทุก scope (default / vehicle_rescue)</p>
          </div>
          <button
            onClick={() => setShowClaimModal(true)}
            disabled={claimSummary.every((c) => c.count === 0)}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-navy-900 font-semibold rounded-lg text-xs disabled:opacity-40 disabled:cursor-not-allowed transition-colors btn-ripple"
          >
            <HandCoins size={13} /> กดรับส่วนแบ่งเคส
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {claimSummary.map((s) => {
            const label = s.scope === 'default' ? 'เคสทั่วไป' : 'กู้ภัยรถยก';
            const empty = s.count === 0;
            return (
              <div
                key={s.scope}
                className={`px-3 py-2 rounded-lg border ${
                  empty
                    ? 'bg-navy-900/40 border-blue-900/30'
                    : 'bg-amber-500/10 border-amber-500/30'
                }`}
              >
                <div className="text-[10px] text-gray-500">{label}</div>
                <div className={`text-sm font-bold ${empty ? 'text-gray-500' : 'text-amber-300'}`}>
                  {s.amount.toLocaleString('th-TH', { maximumFractionDigits: 2 })} BC
                </div>
                <div className="text-[10px] text-gray-500">
                  {empty ? 'ไม่มีรายการ' : `${s.count} รายการรอ claim`}
                </div>
              </div>
            );
          })}
        </div>

        {claimHistory.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[10px] text-gray-400 hover:text-amber-400">
              ประวัติ claim ล่าสุด ({claimHistory.length})
            </summary>
            <div className="mt-1 space-y-1">
              {claimHistory.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 text-[10px] px-2 py-1 rounded bg-navy-900/40">
                  <span className="text-gray-400 font-mono">{c.claim_period}</span>
                  <span className="text-gray-500 truncate">{c.scope}</span>
                  <span className="text-amber-300 font-mono">
                    {c.amount.toLocaleString('th-TH', { maximumFractionDigits: 2 })}
                  </span>
                  <Badge
                    variant={
                      c.status === 'paid' ? 'success'
                      : c.status === 'approved' ? 'success'
                      : c.status === 'rejected' ? 'danger'
                      : 'warning'
                    }
                  >
                    {c.status === 'pending' && 'รออนุมัติ'}
                    {c.status === 'approved' && 'อนุมัติ'}
                    {c.status === 'rejected' && 'ปฏิเสธ'}
                    {c.status === 'paid' && 'จ่ายแล้ว'}
                  </Badge>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Monthly Income Detail */}
      <div className="mb-3">
        <button
          onClick={() => setShowIncomeDetail((v) => !v)}
          className="text-xs text-amber-400 hover:text-amber-300 font-medium"
        >
          {showIncomeDetail ? '▾ ซ่อน' : '▸ ดู'}รายละเอียดรายได้รายเดือน {income.hasOverride && <Badge variant="warning">มีการปรับแล้ว</Badge>}
        </button>
        {showIncomeDetail && (
          <div className="card p-3 mt-2">
            {income.months.length === 0 ? (
              <p className="text-xs text-gray-500 text-center py-3">ยังไม่มีข้อมูลการขึ้นเวร/ค่าบริการ</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-gray-500 border-b border-blue-900/40">
                  <tr>
                    <th className="text-left py-1.5">เดือน</th>
                    <th className="text-right py-1.5">เวร (ชม.)</th>
                    <th className="text-right py-1.5">ค่าขึ้นเวร</th>
                    <th className="text-right py-1.5">ค่าบริการ (10%)</th>
                    <th className="text-right py-1.5">รวม</th>
                    <th className="py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {income.months.map((m) => {
                    const isEditing = editingMonth === m.month;
                    const displayValue = m.override ?? m.total;
                    return (
                      <tr key={m.month} className="border-b border-blue-900/20">
                        <td className="py-1.5 text-white font-mono">{m.month}</td>
                        <td className="py-1.5 text-right text-gray-400">{m.duty_hours} ชม. ({m.duty_count} เวร)</td>
                        <td className="py-1.5 text-right text-gray-400">{m.duty_income.toLocaleString('th-TH')}</td>
                        <td className="py-1.5 text-right text-gray-400">{m.service_income.toLocaleString('th-TH', { maximumFractionDigits: 0 })}</td>
                        <td className="py-1.5 text-right text-amber-300 font-semibold">
                          {isEditing ? (
                            <input
                              type="number"
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              className="w-24 bg-navy-700 border border-amber-500/40 rounded px-1.5 py-0.5 text-right text-amber-300"
                            />
                          ) : (
                            <>{displayValue.toLocaleString('th-TH', { maximumFractionDigits: 0 })} {m.override != null && <span className="text-violet-400">*</span>}</>
                          )}
                        </td>
                        <td className="py-1.5 text-right">
                          {isEditing ? (
                            <div className="flex gap-1 justify-end">
                              <button
                                onClick={() => {
                                  const val = parseFloat(editValue);
                                  const newOverrides = saveOverride(officer.id, m.month, isNaN(val) ? null : val);
                                  setOverrides(newOverrides);
                                  setEditingMonth(null);
                                }}
                                className="text-emerald-400 hover:text-emerald-300"
                                title="บันทึก"
                              ><Save size={12} /></button>
                              <button
                                onClick={() => setEditingMonth(null)}
                                className="text-gray-500 hover:text-gray-300"
                                title="ยกเลิก"
                              ><XIcon size={12} /></button>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setEditingMonth(m.month); setEditValue(String(displayValue)); }}
                              className="text-amber-400 hover:text-amber-300"
                              title="แก้ไข"
                            ><Edit2 size={12} /></button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p className="text-[10px] text-gray-500 mt-2">* = ค่าที่ปรับด้วยตนเอง · เก็บใน localStorage · ค่าเฉลี่ย = ผลรวม / จำนวนเดือน</p>
          </div>
        )}
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
                <span className="text-[10px] text-gray-500">ชำระแล้ว: <span className="text-emerald-400 font-semibold">{paidCount} ({paidTotal.toLocaleString('th-TH')} BC)</span></span>
                <span className="text-[10px] text-gray-500">ค้างชำระ: <span className="text-red-400 font-semibold">{unpaidCount} ({unpaidTotal.toLocaleString('th-TH')} BC)</span></span>
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
                    <div className="text-right">
                      <span className="text-white text-sm font-semibold">{r.amount.toLocaleString('th-TH')} BC</span>
                      {r.status !== 'paid' && Number(r.paid_amount ?? 0) > 0 && (
                        <div className="text-[10px] text-gray-500">
                          ชำระแล้ว {Number(r.paid_amount ?? 0).toLocaleString('th-TH')} · ค้าง {getRemainingDebt(r).toLocaleString('th-TH')}
                        </div>
                      )}
                    </div>
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

      {showClaimModal && officer && (
        <ClaimShareModal
          officerId={officer.id}
          actorId={officer.id}
          onClose={() => setShowClaimModal(false)}
          onSuccess={loadClaimSummary}
        />
      )}
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
