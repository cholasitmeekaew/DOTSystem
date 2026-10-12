/* =============================================================
 * ProfilePage.tsx — ข้อมูลส่วนตัว
 * -------------------------------------------------------------
 * เจ้าหน้าที่ทั่วไปเห็นข้อมูลตัวเองเท่านั้น
 * หัวหน้ากรมเลือกดูของรายบุคคลได้
 * ============================================================= */

import { useEffect, useMemo, useState } from 'react';
import {
  UserCircle, CalendarDays, FileText, Palmtree, DollarSign, BookOpen,
  Shield, Clock, Award, TrendingUp, TrendingDown, History, Loader2, AlertTriangle,
  CheckCircle2, XCircle, ChevronDown, ChevronUp, User, MapPin, BadgeCheck,
  Siren, Layers,
} from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';
import { supabase } from '../../lib/supabase';
import { PageHeader } from '../../components/PageHeader';
import {
  RANK_LABELS, DEPARTMENT_LABELS, WORK_REPORT_STATUS_LABELS,
  getPointsLevel, getNextPointsLevel,
  type Officer, type WorkReport, type OfficerLeave, type LeaveType, type LeaveQuota,
} from '../../lib/types';
import {
  resolveQuotas, buildQuotaUsage, formatQuotaLine, currentMonthKey,
} from '../../lib/leaveQuota';
import type { OfficerPage } from '../../components/OfficerLayout';
import { ProfileExtraTabs, type ProfileTabId } from '../../components/ProfileSections';
import { fetchProfileExtra, type ProfileExtra } from '../../lib/profileData';

interface Props {
  onNavigate: (page: OfficerPage) => void;
  /** เปิดหน้าปฏิบัติการที่แท็บที่ระบุ */
  onOpenOpsTab: (tab: 'duty' | 'roster' | 'approvals') => void;
}

/* ---------- การ์ดทางลัด ---------- */

interface QuickLink {
  id: string;
  label: string;
  icon: typeof CalendarDays;
  tint: string;
  onClick: () => void;
}

function QuickNavGrid({ links }: { links: QuickLink[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5 mb-5">
      {links.map((l) => {
        const Icon = l.icon;
        return (
          <button
            key={l.id}
            onClick={l.onClick}
            className="card px-3 py-3.5 flex flex-col items-center gap-2 text-center
                       hover:border-amber-500/40 transition-colors group"
          >
            <span className={`p-2 rounded-xl ${l.tint} group-hover:scale-105 transition-transform`}>
              <Icon size={19} />
            </span>
            <span className="text-[11px] leading-snug text-gray-300 group-hover:text-white transition-colors">
              {l.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- ชิ้นย่อย ---------- */

function StatBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-navy-900/50 border border-blue-900/40 px-3 py-2.5">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className="text-lg font-bold text-white mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-blue-900/25 last:border-0">
      <span className="text-[11px] text-gray-500 w-32 flex-shrink-0">{label}</span>
      <span className="text-xs text-gray-200 flex-1 min-w-0 break-words">{children}</span>
    </div>
  );
}

/* ---------- หน้า ---------- */

export function ProfilePage({ onNavigate, onOpenOpsTab }: Props) {
  const { officer, isCommissioner } = useAuth();

  const [targetId, setTargetId] = useState<string>(officer?.id ?? '');
  const [officersList, setOfficersList] = useState<Officer[]>([]);
  const [data, setData] = useState<Officer | null>(null);
  const [reports, setReports] = useState<WorkReport[]>([]);
  const [leaves, setLeaves] = useState<OfficerLeave[]>([]);
  const [quotaRows, setQuotaRows] = useState<LeaveQuota[] | null>(null);
  const [hours, setHours] = useState<{ total: number; shifts: number }>({ total: 0, shifts: 0 });
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [showAllReports, setShowAllReports] = useState(false);
  const [showAllLeaves, setShowAllLeaves] = useState(false);
  // ข้อมูลเสริมแบบแท็บ (ยานพาหนะ / ค่าบริการ / เหตุ / กิจกรรม)
  const [tab, setTab] = useState<ProfileTabId>('services');
  const [extra, setExtra] = useState<ProfileExtra | null>(null);
  const [extraLoading, setExtraLoading] = useState(false);

  const isSelf = targetId === officer?.id;

  // หัวหน้ากรมเลือกดูของคนอื่นได้ — เจ้าหน้าที่ทั่วไปถูกล็อกให้ดูของตัวเอง
  useEffect(() => {
    if (!isCommissioner || !officer) { setTargetId(officer?.id ?? ''); return; }
    (async () => {
      const { data: rows } = await supabase
        .from('officers').select('*').neq('status', 'deleted').order('name');
      setOfficersList((rows ?? []) as Officer[]);
    })();
  }, [isCommissioner, officer]);

  async function load() {
    if (!targetId) {
      // ไม่มี id ให้ดึงข้อมูล — ต้องปิด loading ด้วย ไม่งั้นค้างที่ "กำลังโหลด" ถาวร
      setLoadErrors(['ไม่พบรหัสเจ้าหน้าที่ที่จะดู']);
      setLoading(false);
      return;
    }
    setLoading(true);

    try {
      const [oRes, rRes, lRes, qRes, dRes] = await Promise.all([
        // maybeSingle: ไม่ error เมื่อไม่พบแถว (single จะ error ถ้า 0 แถว)
        supabase.from('officers').select('*').eq('id', targetId).maybeSingle(),
        supabase.from('work_reports').select('*').eq('officer_id', targetId)
          .order('created_at', { ascending: false }).limit(60),
        supabase.from('officer_leaves').select('*').eq('officer_id', targetId)
          .order('start_date', { ascending: false }).limit(60),
        supabase.from('leave_quotas').select('*'),
        supabase.from('duty_logs').select('clock_in, clock_out, deleted_at')
          .eq('officer_id', targetId).is('deleted_at', null),
      ]);

      setData((oRes.data as unknown as Officer) ?? null);
      setReports((rRes.data ?? []) as WorkReport[]);
      setLeaves((lRes.data ?? []) as unknown as OfficerLeave[]);

      // เก็บ error จริงไว้โชว์ แทนที่จะแสดงว่า "ไม่มีข้อมูล" เฉย ๆ
      // (เช่น ตารางยังไม่ถูก migrate หรือ policy บล็อก)
      const errs: string[] = [];
      for (const [label, res] of [
        ['ข้อมูลเจ้าหน้าที่', oRes],
        ['รายงานปฏิบัติงาน', rRes],
        ['ใบลา', lRes],
        ['โควตาลา', qRes],
        ['ประวัติเวร', dRes],
      ] as const) {
        if (res.error) errs.push(`${label}: ${res.error.message}`);
      }
      setLoadErrors(errs);

      // leave_quotas เป็นตารางกลาง หนึ่งแถวต่อชนิดการลา (ไม่มีคอลัมน์ month)
      setQuotaRows(qRes.data as unknown as LeaveQuota[]);

      // รวมชั่วโมงเข้าเวรจาก duty_logs
      const rows = (dRes.data ?? []) as Array<{ clock_in: string | null; clock_out: string | null }>;
      let ms = 0;
      for (const r of rows) {
        if (!r.clock_in || !r.clock_out) continue;
        const diff = new Date(r.clock_out).getTime() - new Date(r.clock_in).getTime();
        if (diff > 0 && diff < 24 * 3600 * 1000) ms += diff;
      }
      setHours({ total: Math.round(ms / 360000) / 10, shifts: rows.filter((r) => r.clock_out).length });
    } catch (e) {
      // เครือข่ายล้ม/โค้ดพัง — ต้องโชว์ error ไม่ใช่ค้างหน้าโหลด
      setLoadErrors([`โหลดข้อมูลไม่สำเร็จ: ${(e as Error).message}`]);
    } finally {
      // เส้นทางเดียวที่ปิดสถานะ loading — ทั้งสำเร็จ ล้มเหลว และไม่มี targetId
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [targetId]);

  /**
   * ซิงก์แบบเรียลไทม — ไม่ต้องรีเฟรชหน้าเพื่อเห็นผลอนุมัติ/ลบรายงาน
   * ครอบคลุม 4 อย่าง: โปรไฟล์+คะแนน, รายงานปฏิบัติงาน, การลา, เวลาเข้าเวร
   */
  useEffect(() => {
    const target = `profile_rt_${targetId || 'none'}`;
    const channel = supabase
      .channel(target)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_reports' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'officer_leaves' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'officers' }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'officer_login_logs' }, () => { void load(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [targetId]);

  /** ข้อมูลประวัติส่วนเสริม — ใช้ "ชื่อ" ด้วย เพราะบางตารางเก็บเป็น text ไม่ใช่ id */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = targetId === officer?.id;
      const name = me
        ? (officer?.name ?? '')
        : (data?.name ?? '');
      if (!targetId || !name) return;
      setExtraLoading(true);
      const res = await fetchProfileExtra(targetId, name);
      if (!cancelled) {
        setExtra(res);
        setExtraLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [targetId, officer?.name, data?.name]);

  /* ---------- คะแนน ---------- */
  const points = data?.points ?? 0;
  const pointsLog = useMemo(
    () => [...(data?.points_log ?? [])].reverse(),
    [data?.points_log],
  );
  const level = getPointsLevel(points);
  const next = getNextPointsLevel(points);
  const progress = next
    ? Math.min(100, Math.round(((points - level.min) / (next.min - level.min)) * 100))
    : 100;

  /* ---------- โควตาลา ---------- */
  const quotaUsage = useMemo(() => {
    if (!quotaRows || quotaRows.length === 0) return null;
    return buildQuotaUsage(leaves, resolveQuotas(quotaRows), currentMonthKey());
  }, [leaves, quotaRows]);

  const visibleLogs = showAllLogs ? pointsLog : pointsLog.slice(0, 5);
  const visibleReports = showAllReports ? reports : reports.slice(0, 5);
  const visibleLeaves = showAllLeaves ? leaves : leaves.slice(0, 5);

  const quickLinks: QuickLink[] = [
    { id: 'roster', label: 'ตารางเวรปฏิบัติงาน', icon: CalendarDays,
      tint: 'bg-blue-500/15 text-blue-300', onClick: () => onOpenOpsTab('roster') },
    { id: 'reports', label: 'ส่งรายงานปฏิบัติงาน', icon: FileText,
      tint: 'bg-purple-500/15 text-purple-300', onClick: () => onOpenOpsTab('duty') },
    { id: 'leave', label: 'ระบบยื่นใบลา', icon: Palmtree,
      tint: 'bg-emerald-500/15 text-emerald-300', onClick: () => onNavigate('leave') },
    { id: 'service', label: 'แจ้งค่าบริการ', icon: DollarSign,
      tint: 'bg-amber-500/15 text-amber-300', onClick: () => onNavigate('service-fees') },
    { id: 'manual', label: 'คู่มือกรมขนส่ง', icon: BookOpen,
      tint: 'bg-cyan-500/15 text-cyan-300', onClick: () => onNavigate('manual') },
    { id: 'emergency', label: 'แจ้งเหตุฉุกเฉิน', icon: Siren,
      tint: 'bg-red-500/15 text-red-300', onClick: () => onNavigate('emergency') },
  ];

  if (!officer) return null;

  return (
    <div>
      <PageHeader
        icon={<UserCircle size={26} />}
        title="ข้อมูลส่วนตัว"
        subtitle={isSelf ? 'ข้อมูลและสถิติของคุณ' : 'ข้อมูลและสถิติของเจ้าหน้าที่'}
      />

      {/* เลือกดูรายบุคคล — เฉพาะหัวหน้ากรม */}
      {isCommissioner && officersList.length > 0 && (
        <div className="card px-3.5 py-2.5 mb-4 flex items-center gap-2.5">
          <User size={15} className="text-gray-500 flex-shrink-0" />
          <span className="text-xs text-gray-400 flex-shrink-0">ดูข้อมูลของ</span>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="input flex-1 text-xs"
          >
            {officersList.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}{o.id === officer.id ? ' (ฉัน)' : ''}
              </option>
            ))}
          </select>
          {!isSelf && (
            <button
              onClick={() => setTargetId(officer.id)}
              className="btn-secondary px-2 py-1 text-[11px] flex-shrink-0"
            >
              กลับไปของฉัน
            </button>
          )}
        </div>
      )}

      {loadErrors.length > 0 && (
        <div className="card px-3.5 py-2.5 mb-4 border-red-500/30 bg-red-500/5">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={15} className="text-red-400 mt-0.5 flex-shrink-0" />
            <div className="space-y-1 min-w-0">
              <div className="text-xs font-semibold text-red-300">
                โหลดข้อมูลบางส่วนไม่สำเร็จ ({loadErrors.length} รายการ)
              </div>
              {loadErrors.map((e, i) => (
                <div key={i} className="text-[11px] text-red-300/80 break-all">{e}</div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* การ์ดทางลัด */}
      <QuickNavGrid links={quickLinks} />

      {loading ? (
        <div className="text-center text-gray-400 py-12 flex items-center justify-center gap-2">
          <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
        </div>
      ) : (
        <div className="grid lg:grid-cols-[320px_1fr] gap-4">
          {/* ---------- ข้อมูลทั่วไป ---------- */}
          <div className="space-y-4">
            <div className="card p-4">
              <div className="flex flex-col items-center text-center mb-4">
                {data?.photo_url ? (
                  <img
                    src={data.photo_url}
                    alt={data.name}
                    className="w-24 h-24 rounded-full object-cover border-2 border-amber-500/40 mb-2.5"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-navy-800 border-2 border-blue-900/40 flex items-center justify-center mb-2.5">
                    <UserCircle size={40} className="text-gray-600" />
                  </div>
                )}
                <h2 className="text-base font-bold text-white">{data?.name ?? '—'}</h2>
                <div className="flex items-center gap-1.5 mt-1">
                  <BadgeCheck size={13} className="text-amber-400" />
                  <span className="text-[11px] text-amber-300">
                    {RANK_LABELS[data?.rank ?? 'officer'] ?? data?.rank}
                  </span>
                </div>
                <span
                  className={`mt-2 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                    data?.status === 'active'
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                      : 'bg-gray-500/15 text-gray-300 border-gray-500/40'
                  }`}
                >
                  {data?.status === 'active' ? 'ปฏิบัติงานอยู่' : data?.status ?? '—'}
                </span>
              </div>

              <div className="pt-1">
                <Row label="รหัสเจ้าหน้าที่">
                  <span className="font-mono text-amber-300">{data?.username ?? '—'}</span>
                </Row>
                <Row label="ยศ / ตำแหน่ง">{RANK_LABELS[data?.rank ?? 'officer'] ?? '—'}</Row>
                <Row label="แผนก / ฝ่าย">
                  {data?.department ? (
                    <span className="inline-flex items-center gap-1">
                      <MapPin size={11} className="text-gray-500" />
                      {DEPARTMENT_LABELS[data.department] ?? data.department}
                    </span>
                  ) : '—'}
                </Row>
                <Row label="วันที่เริ่มงาน">
                  {data?.created_at
                    ? new Date(data.created_at).toLocaleDateString('th-TH', {
                        year: 'numeric', month: 'long', day: 'numeric',
                      })
                    : '—'}
                </Row>
                <Row label="รุ่น">{data?.generation ?? '—'}</Row>
              </div>
            </div>

            {/* ---------- สถิติชั่วโมง ---------- */}
            <div className="card p-4">
              <div className="flex items-center gap-1.5 mb-3">
                <Clock size={14} className="text-blue-400" />
                <h3 className="text-xs font-semibold text-gray-300">สถิติการเข้าเวร</h3>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <StatBox label="ชั่วโมงสะสม" value={`${hours.total.toLocaleString('th-TH', { maximumFractionDigits: 1 })} ชม.`} />
                <StatBox label="จำนวนกะ" value={`${hours.shifts} ครั้ง`} />
              </div>
            </div>
          </div>

          {/* ---------- คอลัมน์ขวา ---------- */}
          <div className="space-y-4">
            {/* คะแนน PPS */}
            <div className="card p-4 sm:p-5">
              <div className="flex items-center gap-1.5 mb-3">
                <Award size={14} className="text-amber-400" />
                <h3 className="text-xs font-semibold text-gray-300">คะแนนสะสม PPS</h3>
                {!isSelf && (
                  <span className="text-[10px] text-gray-500 ml-auto">กำลังดูของ {data?.name}</span>
                )}
              </div>

              <div className="flex items-end gap-3 mb-3">
                <span className="text-4xl font-black text-white leading-none">
                  {points.toLocaleString('th-TH')}
                </span>
                <span className="text-xs text-gray-500 pb-1">คะแนน</span>
                <span className={`ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${level.bgClass} ${level.textClass}`}>
                  {level.label}
                </span>
              </div>

              {next ? (
                <>
                  <div className="h-1.5 rounded-full bg-navy-800 overflow-hidden mb-1.5">
                    <div
                      className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-gray-500">
                    อีก {(next.min - points).toLocaleString('th-TH')} คะแนน ถึงระดับ {next.label}
                  </div>
                </>
              ) : (
                <div className="text-[10px] text-amber-400">ถึงระดับสูงสุดแล้ว</div>
              )}

              {/* ประวัติคะแนน */}
              <div className="mt-4 pt-3 border-t border-blue-900/40">
                <div className="flex items-center gap-1.5 mb-2">
                  <History size={12} className="text-gray-500" />
                  <span className="text-[11px] text-gray-400">
                    ประวัติการได้/หักคะแนน ({pointsLog.length})
                  </span>
                </div>
                {pointsLog.length === 0 ? (
                  <div className="text-[11px] text-gray-600 py-2">ไม่พบรายการ</div>
                ) : (
                  <>
                    <div className="space-y-1">
                      {visibleLogs.map((l, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 rounded px-2 py-1.5 bg-navy-900/40 border border-blue-900/30"
                        >
                          {l.delta >= 0
                            ? <TrendingUp size={12} className="text-emerald-400 flex-shrink-0" />
                            : <TrendingDown size={12} className="text-red-400 flex-shrink-0" />}
                          <span className="text-[11px] text-gray-300 flex-1 min-w-0 truncate">
                            {l.reason}
                          </span>
                          <span className={`text-[11px] font-bold flex-shrink-0 ${
                            l.delta >= 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}>
                            {l.delta >= 0 ? '+' : ''}{l.delta}
                          </span>
                        </div>
                      ))}
                    </div>
                    {pointsLog.length > 5 && (
                      <button
                        onClick={() => setShowAllLogs((v) => !v)}
                        className="mt-1.5 text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1"
                      >
                        {showAllLogs ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        {showAllLogs ? 'ย่อ' : `ดูทั้งหมด (${pointsLog.length})`}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* ประวัติรายงาน */}
            <div className="card p-4 sm:p-5">
              <div className="flex items-center gap-1.5 mb-3">
                <FileText size={14} className="text-purple-400" />
                <h3 className="text-xs font-semibold text-gray-300">ประวัติรายงานปฏิบัติงาน</h3>
                <span className="ml-auto text-[10px] text-gray-500">{reports.length} รายการ</span>
              </div>
              {reports.length === 0 ? (
                <div className="text-[11px] text-gray-600 py-2">ไม่พบรายงานในระบบ</div>
              ) : (
                <>
                  <div className="space-y-1">
                    {visibleReports.map((r) => {
                      const st = r.status ?? 'pending';
                      return (
                        <div
                          key={r.id}
                          className="flex items-center gap-2 rounded px-2 py-1.5 bg-navy-900/40 border border-blue-900/30"
                        >
                          {st === 'approved'
                            ? <CheckCircle2 size={12} className="text-emerald-400 flex-shrink-0" />
                            : st === 'rejected'
                              ? <XCircle size={12} className="text-red-400 flex-shrink-0" />
                              : <Clock size={12} className="text-amber-400 flex-shrink-0" />}
                          <span className="text-[11px] text-gray-300 flex-1 min-w-0 truncate">
                            {r.summary || r.report_text?.slice(0, 60) || 'รายงาน'}
                          </span>
                          <span className="text-[10px] text-gray-500 flex-shrink-0">
                            {WORK_REPORT_STATUS_LABELS[st] ?? st}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {reports.length > 5 && (
                    <button
                      onClick={() => setShowAllReports((v) => !v)}
                      className="mt-1.5 text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1"
                    >
                      {showAllReports ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                      {showAllReports ? 'ย่อ' : `ดูทั้งหมด (${reports.length})`}
                    </button>
                  )}
                </>
              )}
            </div>

            {/* โควตาลา */}
            <div className="card p-4 sm:p-5">
              <div className="flex items-center gap-1.5 mb-3">
                <Palmtree size={14} className="text-emerald-400" />
                <h3 className="text-xs font-semibold text-gray-300">
                  โควตาวันลา — {currentMonthKey()}
                </h3>
              </div>

              {!quotaUsage ? (
                <div className="text-[11px] text-gray-500">ยังไม่มีการตั้งค่าโควตาของเดือนนี้</div>
              ) : (
                <div className="space-y-2">
                  {(Object.keys(quotaUsage) as LeaveType[]).map((t) => {
                    const u = quotaUsage[t];
                    return (
                      <div key={t}>
                        <div className="flex items-center justify-between text-[11px] mb-1">
                          <span className="text-gray-300">{u.label}</span>
                          <span className={`font-semibold ${
                            u.unlimited ? 'text-gray-500'
                              : (u.remaining ?? 0) > 0 ? 'text-emerald-400' : 'text-red-400'
                          }`}>
                            {formatQuotaLine(u)}
                          </span>
                        </div>
                        {!u.unlimited && (
                          <div className="h-1 rounded-full bg-navy-800 overflow-hidden">
                            <div
                              className={`h-full ${u.ratio >= 1 ? 'bg-red-500' : 'bg-emerald-500'}`}
                              style={{ width: `${Math.round(u.ratio * 100)}%` }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ประวัติการลา */}
              <div className="mt-4 pt-3 border-t border-blue-900/40">
                <span className="text-[11px] text-gray-400">ประวัติการยื่นใบลา ({leaves.length})</span>
                {leaves.length === 0 ? (
                  <div className="text-[11px] text-gray-600 py-2 mt-1">ไม่พบประวัติการยื่นใบลา</div>
                ) : (
                  <>
                    <div className="space-y-1 mt-1.5">
                      {visibleLeaves.map((l) => (
                        <div
                          key={l.id}
                          className="flex items-center gap-2 rounded px-2 py-1.5 bg-navy-900/40 border border-blue-900/30"
                        >
                          {l.status === 'approved'
                            ? <CheckCircle2 size={12} className="text-emerald-400 flex-shrink-0" />
                            : l.status === 'rejected'
                              ? <XCircle size={12} className="text-red-400 flex-shrink-0" />
                              : <Clock size={12} className="text-amber-400 flex-shrink-0" />}
                          <span className="text-[11px] text-gray-300 flex-1 min-w-0">
                            {l.start_date} → {l.end_date}
                          </span>
                          <span className="text-[10px] text-gray-500 flex-shrink-0">
                            {l.status}
                          </span>
                        </div>
                      ))}
                    </div>
                    {leaves.length > 5 && (
                      <button
                        onClick={() => setShowAllLeaves((v) => !v)}
                        className="mt-1.5 text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1"
                      >
                        {showAllLeaves ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                        {showAllLeaves ? 'ย่อ' : `ดูทั้งหมด (${leaves.length})`}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {!loading && data?.status === 'deleted' && (
        <div className="mt-4 flex items-center gap-2 text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
          <Shield size={13} />
          บัญชีนี้ถูกระงับ — ข้อมูลที่แสดงเป็นข้อมูลจากก่อนถูกระงับ
        </div>
      )}

      {/* ---------- ข้อมูลประวัติเพิ่มเติม (แท็บ) ---------- */}
      <section className="card p-4 sm:p-5 mt-4">
        <div className="flex items-center gap-1.5 mb-3">
          <Layers size={14} className="text-amber-400" />
          <h3 className="text-xs font-semibold text-gray-300">ประวัติและกิจกรรมทั้งหมด</h3>
          {!isSelf && (
            <span className="text-[10px] text-gray-500 ml-auto">ของ {data?.name}</span>
          )}
        </div>

        {(extra?.errors.length ?? 0) > 0 && (
          <div className="mb-3 flex items-start gap-2 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <div className="font-semibold">บางส่วนโหลดไม่สำเร็จ ({extra?.errors.length})</div>
              {extra?.errors.map((e, i) => <div key={i} className="text-amber-300/80 break-all">{e}</div>)}
            </div>
          </div>
        )}

        {extra ? (
          <ProfileExtraTabs data={extra} tab={tab} onTab={setTab} loading={extraLoading} />
        ) : (
          <div className="text-center text-gray-500 py-6 text-xs">
            {extraLoading ? 'กำลังโหลดข้อมูล...' : 'ไม่พบข้อมูล'}
          </div>
        )}
      </section>
    </div>
  );
}
