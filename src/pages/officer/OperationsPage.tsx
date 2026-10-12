import { useEffect, useMemo, useState } from 'react';
import {
  Clock, LogIn, LogOut, Users, Trash2, Power, AlertCircle, Image as ImageIcon, Shield,
  BarChart3, Zap, Download, Search, Filter, FileText,
  Plus, X, Upload, Loader2, ExternalLink, CalendarDays, ChevronLeft, ChevronRight,
  CheckCircle2, XCircle, Award, Trophy, Crown, Briefcase, User, Repeat, Shuffle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  Citizen, DutyLog, Officer, SystemSettings, WorkReport, WorkReportCase, DEPARTMENT_LABELS,
  DutySchedule, ScheduleOverride, ShiftCode, ScheduleCellCode, WorkReportStatus,
  WORK_REPORT_STATUS_LABELS, SHIFT_LABELS, OVERRIDE_TYPE_LABELS, OfficerRankRecord,
} from '../../lib/types';
import { useAuth } from '../../lib/AuthContext';
import { Badge } from '../../components/Badge';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { IdCard } from '../../components/IdCard';
import { ReportDetailModal } from '../../components/ReportDetailModal';
import { PageHeader } from '../../components/PageHeader';
import { randomizeWeeklyRoster, isLeader, leaderLabel, type RandomizeResult, type LeaveRecord } from '../../lib/rosterRandomizer';
import { BatchDutyRateModal } from '../../components/BatchDutyRateModal';
import { uploadImage } from '../../lib/storage';
import {
  buildWeeklyRoster, shiftWeek, toIso, DEFAULT_REQUIRED_OFFICERS,
  shiftWindowFor, dayTypeLabel, serverHoursFor, SHIFT_ORDER,
} from '../../lib/dutySchedule';
import { isWeekend } from '../../lib/types';
import {
  isAutoPointsEnabled, applyCheckoutPoints, applyReportApprovalPoints,
  AUTO_POINTS_RULES,
} from '../../lib/api/autoPoints';
import { deleteWorkReport as deleteWorkReportShared } from '../../lib/api/workReportsAdmin';

type ReportCaseDraft = {
  case_name: string;
  citizen_username: string;
  citizen_id: string | null;
  case_status: 'completed' | 'in_progress' | 'transferred';
  details: string;
  evidence_url: string;
};

type ReportTarget = {
  log: DutyLog;
  clockOut: string;
  durationMinutes: number;
  /** true = ออกเวรใน DB แล้ว เปิดฟอร์มมาเพื่อเขียนรายงานอย่างเดียว */
  alreadyCheckedOut?: boolean;
};

export function OperationsPage({
  initialTab = 'duty',
  approvalsOnly = false,
  adminTools = false,
}: {
  /** ให้ลิงก์ภายนอกเปิดเข้ามาที่แท็บที่ต้องการได้ (เช่น การ์ดทางลัดในหน้าข้อมูลส่วนตัว) */
  initialTab?: 'duty' | 'roster' | 'approvals';
  /** true = แสดงเฉพาะงานอนุมัติรายงาน (เข้าจากเมนู Admin) — ซ่อนแท็บปฏิบัติงาน/ตารางเวรออก */
  approvalsOnly?: boolean;
  /**
   * true = เปิดเครื่องมือบริหาร (แก้ตารางเวร สุ่มเวร กำหนดเรท ลบประวัติ)
   * ใช้เฉพาะตอนเข้าจากเมนู Admin — หน้าหลักเป็นโหมดดู/ปฏิบัติงานประจำวัน
   * ยังตรวจ isCommissioner ซ้ำอีกชั้นเพื่อไม่ให้เปิดผิดทาง
   */
  adminTools?: boolean;
} = {}) {
  const { officer, setAuth, isCommissioner } = useAuth();
  const canAdmin = adminTools && isCommissioner;
  const [opsTab, setOpsTab] = useState<'duty' | 'roster' | 'approvals'>(initialTab);
  // เข้าจากเมนู Admin → บังคับอยู่ที่งานอนุมัติเสมอ
  useEffect(() => {
    if (approvalsOnly) setOpsTab('approvals');
  }, [approvalsOnly]);
  const [onDutyOfficers, setOnDutyOfficers] = useState<Officer[]>([]);
  const [dutyLogs, setDutyLogs] = useState<DutyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [clockLoading, setClockLoading] = useState(false);
  const [settings, setSettings] = useState<SystemSettings | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<DutyLog | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [forceTarget, setForceTarget] = useState<Officer | null>(null);
  const [idCardOfficer, setIdCardOfficer] = useState<{ officer: Officer; clockIn: string | null } | null>(null);
  const [allLogs, setAllLogs] = useState<DutyLog[]>([]);
  const [showBatchDutyModal, setShowBatchDutyModal] = useState(false);

  // Filters & Export states
  const [searchOfficer, setSearchOfficer] = useState('');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7days' | 'month' | 'custom'>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [workReports, setWorkReports] = useState<WorkReport[]>([]);
  // จำนวนเคสในแต่ละรายงานเวร (key = work_report.id)
  const [reportCaseCounts, setReportCaseCounts] = useState<Record<string, number>>({});
  const [workReportTarget, setWorkReportTarget] = useState<ReportTarget | null>(null);
  const [workReportCategory, setWorkReportCategory] = useState('patrol');
  const [workReportSummary, setWorkReportSummary] = useState('');
  const [workReportCases, setWorkReportCases] = useState<ReportCaseDraft[]>([]);
  const [workReportLoading, setWorkReportLoading] = useState(false);
  const [uploadingCaseIndex, setUploadingCaseIndex] = useState<number | null>(null);
  const [citizenOptions, setCitizenOptions] = useState<Citizen[]>([]);
  const [viewReport, setViewReport] = useState<WorkReport | null>(null);
  const [viewReportCases, setViewReportCases] = useState<WorkReportCase[]>([]);
  const [viewEvidenceUrl, setViewEvidenceUrl] = useState<string | null>(null);
  const [viewCitizen, setViewCitizen] = useState<Citizen | null>(null);
  const [viewCitizenStats, setViewCitizenStats] = useState({ vehicles: 0, licenses: 0, fees: 0 });

  // ---- ระบบตารางเวร (migration 0028) ----
  const [weekAnchor, setWeekAnchor] = useState(() => toIso(new Date()));
  const [schedules, setSchedules] = useState<DutySchedule[]>([]);
  const [overrides, setOverrides] = useState<ScheduleOverride[]>([]);
  const [rosterOfficers, setRosterOfficers] = useState<Officer[]>([]);
  const [editingCell, setEditingCell] = useState<{ date: string; shift: ScheduleCellCode } | null>(null);
  const [autoPointsOn, setAutoPointsOn] = useState<boolean>(false);
  // --- สุ่มเวรอัตโนมัติ ---
  const [ranks, setRanks] = useState<OfficerRankRecord[]>([]);
  const [weekLeaves, setWeekLeaves] = useState<LeaveRecord[]>([]);
  const [showRandomize, setShowRandomize] = useState(false);
  const [randomizing, setRandomizing] = useState(false);
  const [requireLeader, setRequireLeader] = useState(true);
  const [randomPreview, setRandomPreview] = useState<RandomizeResult | null>(null);

  // ---- ระบบอนุมัติรายงานปฏิบัติงาน ----
  const [reviewingWorkReport, setReviewingWorkReport] = useState<WorkReport | null>(null);
  const [deletingWorkReport, setDeletingWorkReport] = useState<WorkReport | null>(null);
  const [deletingReportBusy, setDeletingReportBusy] = useState(false);
  const [reportReviewAction, setReportReviewAction] = useState<'approved' | 'rejected'>('approved');
  const [reportReviewNote, setReportReviewNote] = useState('');

  // =============== ตารางเวร ===============
  async function fetchScheduleData() {
    const weekStart = shiftWeek(weekAnchor, 0);
    const weekEnd = shiftWeek(weekAnchor, 1);
    const [schedRes, ovRes, offRes, rankRes, leaveRes] = await Promise.all([
      supabase.from('duty_schedules').select('*').eq('is_active', true).order('weekday'),
      supabase
        .from('schedule_overrides')
        .select('*')
        .gte('override_date', weekStart)
        .lt('override_date', weekEnd),
      supabase.from('officers').select('*').eq('status', 'active').order('name'),
      supabase.from('officer_ranks').select('*').eq('is_active', true).order('sort_order'),
      supabase
        .from('officer_leaves')
        .select('officer_id, start_date, end_date')
        .eq('status', 'approved')
        .lte('start_date', weekEnd)
        .gte('end_date', weekStart),
    ]);
    setSchedules((schedRes.data ?? []) as unknown as DutySchedule[]);
    setOverrides((ovRes.data ?? []) as unknown as ScheduleOverride[]);
    setRosterOfficers((offRes.data ?? []) as Officer[]);
    setRanks((rankRes.data ?? []) as OfficerRankRecord[]);
    setWeekLeaves((leaveRes.data ?? []) as unknown as LeaveRecord[]);
  }

  /** แจ้งผลลงใน modal (ไม่ใช้ toast เพื่อให้ผู้ใช้เห็นคำว่า "บันทึกแล้ว" แน่นอน) */
  const [saveFlash, setSaveFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function flash(kind: 'ok' | 'err', text: string) {
    setSaveFlash({ kind, text });
    if (kind === 'ok') setTimeout(() => setSaveFlash(null), 2500);
  }

  /**
   * แท็บ 1 — บันทึกผังประจำสัปดาห์ของ 1 ช่องกะ (หลายคนได้)
   * = ลบแถวเดิมของช่องนี้ทั้งหมด แล้วเขียนใหม่ 1 แถวต่อ 1 คน
   */
  async function saveScheduleSlot(params: {
    weekday: number;
    shift: ShiftCode;
    officerIds: string[];
    required: number;
  }): Promise<boolean> {
    const { weekday, shift, officerIds, required } = params;
    try {
      const { error: delErr } = await supabase
        .from('duty_schedules').delete().eq('weekday', weekday).eq('shift_code', shift);
      if (delErr) throw delErr;

      for (const officerId of officerIds) {
        const win = shiftWindowFor(weekday, shift);
        const { error } = await supabase.from('duty_schedules').insert({
          weekday,
          shift_code: shift,
          shift_name: SHIFT_LABELS[shift],
          start_time: win.start,
          end_time: win.end,
          officer_id: officerId,
          required_officers: required,
          is_active: true,
        });
        if (error) throw error;
      }
      await fetchScheduleData();
      flash('ok', `บันทึกผังประจำ ${SHIFT_LABELS[shift]} สำเร็จ — ${officerIds.length} คน`);
      return true;
    } catch (e) {
      flash('err', `บันทึกผังประจำไม่สำเร็จ: ${(e as Error).message}`);
      await fetchScheduleData();
      return false;
    }
  }

  /** แท็บ 3 — บันทึกข้อยกเว้นของ 1 วัน (หลายคนได้) — เขียนใหม่ทั้งช่องของวันนั้น */
  async function saveOverrideSlot(params: {
    date: string;
    shift: ScheduleCellCode;
    entries: Array<{ officerId: string | null; type: ScheduleOverride['override_type'] }>;
  }): Promise<boolean> {
    const { date, shift, entries } = params;
    try {
      const { error: delErr } = await supabase
        .from('schedule_overrides').delete().eq('override_date', date).eq('shift_code', shift);
      if (delErr) throw delErr;

      for (const e of entries) {
        const { error } = await supabase.from('schedule_overrides').insert({
          override_date: date,
          shift_code: shift,
          officer_id: e.officerId,
          override_type: e.type,
          note: OVERRIDE_TYPE_LABELS[e.type] ?? null,
          source: 'manual',
          created_by: officer?.id ?? null,
          created_by_name: officer?.name ?? null,
        });
        if (error) throw error;
      }
      await fetchScheduleData();
      const label = entries.length === 0
        ? 'ล้างข้อยกเว้นของวันนี้'
        : entries.length === 1 && !entries[0].officerId
          ? 'ปิดเวรทั้งช่อง'
          : `บันทึกข้อยกเว้น ${entries.length} รายการ`;
      flash('ok', `${label} สำเร็จ`);
      return true;
    } catch (e) {
      flash('err', `บันทึกข้อยกเว้นไม่สำเร็จ: ${(e as Error).message}`);
      await fetchScheduleData();
      return false;
    }
  }

  /** ล้าง override ของกะหนึ่งครบทั้งสัปดาห์ (ใช้จากแท็บ "สลับเวรทั้งสัปดาห์") */

  /* ---------- สุ่มเวรอัตโนมัติ ---------- */

  /** คำนวณผลสุ่มล่วงหน้า (ยังไม่เขียนลงฐานข้อมูล) เพื่อให้ผู้ใช้ตรวจก่อน */
  function buildRandomPreview(seed: number): RandomizeResult {
    return randomizeWeeklyRoster({
      days: weeklyRoster.days.map((d) => d.date),
      shifts: ['s1', 's2'],
      schedules,
      overrides,
      leaves: weekLeaves,
      officers: rosterOfficers,
      ranks,
      defaultRequired: DEFAULT_REQUIRED_OFFICERS,
      requireLeader,
    }, seed);
  }

  function doRandomize() {
    setRandomizing(true);
    try {
      setRandomPreview(buildRandomPreview(Math.floor(Math.random() * 2 ** 31)));
    } finally {
      setRandomizing(false);
    }
  }

  /**
   * เขียนผลสุ่มลง duty_schedules
   * เขียนเองแทนเรียก saveScheduleSlot ทีละช่อง เพราะจะได้ไม่ต้อง refetch 14 รอบ
   * และไม่ขึ้นข้อความบันทึกสำเร็จ 14 ครั้งรบกวนสายตา
   */
  async function saveRandomRoster() {
    if (!randomPreview) return;
    setRandomizing(true);
    try {
      const open = randomPreview.cells.filter((c) => c.required > 0);
      for (const cell of open) {
        const { error: delErr } = await supabase
          .from('duty_schedules').delete().eq('weekday', cell.weekday).eq('shift_code', cell.shift);
        if (delErr) throw delErr;

        for (const officerId of cell.officerIds) {
          const win = shiftWindowFor(cell.weekday, cell.shift);
          const { error } = await supabase.from('duty_schedules').insert({
            weekday: cell.weekday,
            shift_code: cell.shift,
            shift_name: SHIFT_LABELS[cell.shift],
            start_time: win.start,
            end_time: win.end,
            officer_id: officerId,
            required_officers: cell.required,
            is_active: true,
          });
          if (error) throw error;
        }
      }
      await fetchScheduleData();
      setShowRandomize(false);
      setRandomPreview(null);
      flash('ok', `สุ่มเวรสัปดาห์นี้สำเร็จ — ${open.length} ช่องกะ · ใช้เจ้าหน้าที่ ${randomPreview.officersUsed} คน`);
    } catch (e) {
      flash('err', `บันทึกผลสุ่มไม่สำเร็จ: ${(e as Error).message}`);
      await fetchScheduleData();
    } finally {
      setRandomizing(false);
    }
  }

  async function clearWeekOverrides(shift: ScheduleCellCode): Promise<boolean> {
    const dates = weeklyRoster.days.map((d) => d.date);
    try {
      for (const date of dates) {
        const { error } = await supabase
          .from('schedule_overrides').delete().eq('override_date', date).eq('shift_code', shift);
        if (error) throw error;
      }
      await fetchScheduleData();
      flash('ok', `ล้างการสลับเวรของสัปดาห์นี้แล้ว (${dates.length} วัน)`);
      return true;
    } catch (e) {
      flash('err', `ล้างการสลับเวรไม่สำเร็จ: ${(e as Error).message}`);
      return false;
    }
  }

  async function clearOverride(date: string, shift: ScheduleCellCode) {
    await supabase.from('schedule_overrides').delete().eq('override_date', date).eq('shift_code', shift);
    setEditingCell(null);
    await fetchScheduleData();
  }

  const weeklyRoster = useMemo(
    () => buildWeeklyRoster({ anchorIso: weekAnchor, schedules, overrides, officers: rosterOfficers }),
    [weekAnchor, schedules, overrides, rosterOfficers],
  );
  /** ผังประจำสัปดาห์ (ทุกคน) ของช่องกะที่กำลังแก้ — ไม่ดึงจาก cell เพราะ cell อาจถูก override ทับ */
  const editingBaseIds = useMemo(() => {
    if (!editingCell) return [];
    const weekday = new Date(`${editingCell.date}T00:00:00`).getDay();
    return schedules
      .filter((sc) => sc.weekday === weekday && sc.shift_code === editingCell.shift && sc.is_active !== false)
      .map((sc) => sc.officer_id)
      .filter((id): id is string => !!id);
  }, [editingCell, schedules]);

  /** ข้อยกเว้นที่มีอยู่จริงของวันนั้น เพื่อให้ modal เปิดมาแล้วเห็นค่าเดิม */
  const editingOverrides = useMemo(() => {
    if (!editingCell) return [] as ScheduleOverride[];
    return overrides.filter(
      (o) => o.override_date === editingCell.date && o.shift_code === editingCell.shift,
    );
  }, [editingCell, overrides]);

  // =============== อนุมัติรายงานปฏิบัติงาน ===============
  async function submitReportReview() {
    if (!reviewingWorkReport || !officer) return;
    const target = reviewingWorkReport;
    const nextStatus: WorkReportStatus = reportReviewAction;

    const { error } = await supabase.from('work_reports').update({
      status: nextStatus,
      reviewed_by: officer.id,
      reviewed_by_name: officer.name,
      reviewed_at: new Date().toISOString(),
      review_note: reportReviewNote || null,
      reviewed_points: nextStatus === 'approved' ? AUTO_POINTS_RULES.reportApproved : 0,
      updated_at: new Date().toISOString(),
    }).eq('id', target.id);

    if (error) {
      alert(`บันทึกผลการตรวจรายงานไม่สำเร็จ: ${error.message}`);
      return;
    }

    // อนุมัติแล้ว → +10 PPS อัตโนมัติ (ถ้าสวิตช์เปิดอยู่)
    if (nextStatus === 'approved') {
      await applyReportApprovalPoints({ ...target, status: nextStatus });
    }

    setReviewingWorkReport(null);
    setReportReviewNote('');
    await fetchData();
  }

  /**
   * ลบรายงานปฏิบัติงาน + คืนคะแนนที่เคยให้ไป (ถ้าอนุมัติแล้ว)
   *
   * ต้องคืนคะแนนด้วยเพราะ points_log เป็น ledger ที่บันทึกไปแล้ว
   * ถ้าลบรายงานทิ้งอย่างเดียว คะแนน +10 จะค้างโดยไม่มีที่มาของรายงานแล้ว
   * และ points_award_marks จะยังกันไม่ให้อนุมัติซ้ำได้ ต้องลบ mark ทิ้งด้วย
   */
  async function deleteWorkReport(target: WorkReport) {
    if (!officer) return;
    setDeletingReportBusy(true);
    try {
      const res = await deleteWorkReportShared(target, { id: officer.id, name: officer.name });
      setDeletingWorkReport(null);
      await fetchData();
      if (viewReport?.id === target.id) { setViewReport(null); setViewReportCases([]); }
      flash('ok', `ลบรายงานของ ${target.officer_name} แล้ว`
        + (res.pointsReverted > 0 ? ` · คืนคะแนน ${res.pointsReverted}` : ''));
    } catch (e) {
      flash('err', `ลบรายงานไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setDeletingReportBusy(false);
    }
  }

  function openReportReview(report: WorkReport, action: 'approved' | 'rejected') {
    setReviewingWorkReport(report);
    setReportReviewAction(action);
    setReportReviewNote(report.review_note ?? '');
  }

  const pendingReports = useMemo(
    () => workReports.filter((r) => (r.status ?? 'pending') === 'pending'),
    [workReports],
  );
  const approvedReports = useMemo(
    () => workReports.filter((r) => r.status === 'approved'),
    [workReports],
  );
  const rejectedReports = useMemo(
    () => workReports.filter((r) => r.status === 'rejected'),
    [workReports],
  );

  // =============== PPS engine ===============

  /** สลับเวรทั้งสัปดาห์: เขียน override ทุกวันของสัปดาห์ที่แสดงอยู่ */
  /** แท็บ 2 — สลับเวรทั้งสัปดาห์: เขียน override ครบทุกวันของสัปดาห์ที่เปิดอยู่ */
  async function swapShiftForWeek(shift: ShiftCode, toOfficerId: string): Promise<boolean> {
    const target = rosterOfficers.find((o) => o.id === toOfficerId);
    const days = weeklyRoster.days.map((d) => d.date);
    try {
      for (const date of days) {
        const { error: delErr } = await supabase
          .from('schedule_overrides').delete().eq('override_date', date).eq('shift_code', shift);
        if (delErr) throw delErr;

        const { error } = await supabase.from('schedule_overrides').insert({
          override_date: date,
          shift_code: shift,
          officer_id: toOfficerId,
          override_type: 'swap',
          note: `สลับเวรเป็น ${target?.name ?? ''} (สัปดาห์นี้)`,
          source: 'manual',
          created_by: officer?.id ?? null,
          created_by_name: officer?.name ?? null,
        });
        if (error) throw error;
      }
      await fetchScheduleData();
      flash('ok', `บันทึกการสลับเวรสำเร็จ — ${target?.name ?? ''} รับผิดชอบ ${SHIFT_LABELS[shift]} ครบ ${days.length} วัน`);
      return true;
    } catch (e) {
      flash('err', `บันทึกการสลับเวรไม่สำเร็จ: ${(e as Error).message}`);
      await fetchScheduleData();
      return false;
    }
  }

  /** สแกนหาคะแนนที่ค้าง แล้วให้คะแนน/หักคะแนนตามเกณฑ์ */

  useEffect(() => {
    fetchScheduleData();
    isAutoPointsEnabled().then(setAutoPointsOn);
  }, [weekAnchor]);

  useEffect(() => {
    fetchData();
    if (!canAdmin) return;
    fetchAllLogs();
    const statsCh = supabase.channel('duty_logs_rt_stats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'duty_logs' }, () => fetchAllLogs())
      .subscribe();
    const reportsCh = supabase.channel('work_reports_rt_ops')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_reports' }, () => fetchData())
      .subscribe();
    const schedCh = supabase.channel('duty_schedules_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'duty_schedules' }, () => fetchScheduleData())
      .subscribe();
    return () => {
      supabase.removeChannel(statsCh);
      supabase.removeChannel(reportsCh);
      supabase.removeChannel(schedCh);
    };
  }, [officer?.id]);

  async function fetchAllLogs() {
    const { data } = await supabase.from('duty_logs').select('*').is('deleted_at', null);
    setAllLogs(data ?? []);
  }

  const filteredDutyLogs = useMemo(() => {
    return dutyLogs.filter((log) => {
      // 1. Name filter
      if (searchOfficer.trim()) {
        const q = searchOfficer.toLowerCase().trim();
        if (!(log.officer_name || '').toLowerCase().includes(q)) {
          return false;
        }
      }

      // 2. Date filter
      if (dateFilter !== 'all') {
        const now = new Date();
        const logDateStr = (log.clock_in || '').slice(0, 10);

        if (dateFilter === 'today') {
          const todayStr = now.toISOString().slice(0, 10);
          if (logDateStr !== todayStr) return false;
        } else if (dateFilter === '7days') {
          const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          if (logDateStr < sevenDaysAgo) return false;
        } else if (dateFilter === 'month') {
          const thisMonthStr = now.toISOString().slice(0, 7);
          if ((log.clock_in || '').slice(0, 7) !== thisMonthStr) return false;
        } else if (dateFilter === 'custom') {
          if (customStartDate && logDateStr < customStartDate) return false;
          if (customEndDate && logDateStr > customEndDate) return false;
        }
      }

      return true;
    });
  }, [dutyLogs, searchOfficer, dateFilter, customStartDate, customEndDate]);

  const reportByDutyLogId = useMemo(() => {
    const map = new Map<string, WorkReport>();
    for (const report of workReports) {
      if (report.duty_log_id) map.set(report.duty_log_id, report);
    }
    return map;
  }, [workReports]);

  const emptyReportCase = (): ReportCaseDraft => ({
    case_name: '',
    citizen_username: '',
    citizen_id: null,
    case_status: 'completed',
    details: '',
    evidence_url: '',
  });

  function openReportEditor(target: ReportTarget) {
    // สวิตช์ระดับระบบปิดการรายงาน (migration 0034) — บล็อกทั้งทางปุ่มและทางฟังก์ชัน
    if (!workReportsEnabled) {
      flash('err', 'ระบบปิดการรายงานปฏิบัติงานอยู่ — ติดต่อหัวหน้ากรม');
      return;
    }
    setWorkReportTarget(target);
    setWorkReportCategory('patrol');
    setWorkReportSummary('');
    setWorkReportCases([emptyReportCase()]);
  }

  function openRetrospectiveReport(log: DutyLog) {
    if (!canWriteDutyReport(log)) return;
    if (!log.clock_out) return;
    const clockIn = new Date(log.clock_in).getTime();
    const clockOut = new Date(log.clock_out).getTime();
    const fallbackDuration = Number.isFinite(clockIn) && Number.isFinite(clockOut)
      ? Math.max(0, Math.round((clockOut - clockIn) / 60000))
      : 0;

    openReportEditor({
      log,
      clockOut: log.clock_out,
      durationMinutes: log.duration_minutes ?? fallbackDuration,
    });
  }

  function canWriteDutyReport(log: DutyLog): boolean {
    if (!workReportsEnabled) return false;
    return !!officer?.id && log.officer_id === officer.id;
  }

  function closeReportEditor() {
    setWorkReportTarget(null);
    setWorkReportCategory('patrol');
    setWorkReportSummary('');
    setWorkReportCases([]);
    setUploadingCaseIndex(null);
    setClockLoading(false);
  }

  function updateReportCase<K extends keyof ReportCaseDraft>(idx: number, key: K, value: ReportCaseDraft[K]) {
    setWorkReportCases((prev) => prev.map((item, i) => {
      if (i !== idx) return item;
      if (key === 'citizen_username') {
        const text = String(value);
        const matched = citizenOptions.find((c) => c.roblox_username.toLowerCase() === text.toLowerCase() || (c.discord_username ?? '').toLowerCase() === text.toLowerCase());
        return { ...item, citizen_username: text, citizen_id: matched?.id ?? null };
      }
      return { ...item, [key]: value };
    }));
  }

  function addReportCase() {
    setWorkReportCases((prev) => [...prev, emptyReportCase()]);
  }

  function removeReportCase(idx: number) {
    setWorkReportCases((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleCaseImageUpload(idx: number, file: File) {
    setUploadingCaseIndex(idx);
    try {
      const url = await uploadImage(file, 'evidence');
      if (url) {
        updateReportCase(idx, 'evidence_url', url);
      } else {
        alert('อัปโหลดรูปไม่สำเร็จ — ตรวจว่า Supabase มี bucket evidence + policy ครบ (ไฟล์ 0024) และไฟล์ไม่เกิน 2MB ในโหมดจำลอง');
      }
    } catch (e) {
      console.error('handleCaseImageUpload error:', e);
      alert('อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    }
    setUploadingCaseIndex(null);
  }

  async function submitWorkReport(e: React.FormEvent) {
    e.preventDefault();
    if (!officer || !workReportTarget) return;
    const validCases = workReportCases.filter((c) => c.case_name.trim() || c.details.trim() || c.evidence_url.trim());
    if (!workReportSummary.trim() && validCases.length === 0) return;

    setWorkReportLoading(true);
    const { error } = await supabase.rpc('create_work_report_with_cases', {
      p_officer_id: officer.id,
      p_officer_name: officer.name,
      p_duty_log_id: workReportTarget.log.id,
      p_summary: workReportSummary.trim() || 'รายงานหลังออกเวร',
      p_duty_category: workReportCategory,
      p_cases: validCases.map((c) => ({
        case_name: c.case_name.trim(),
        case_type: workReportCategory,
        case_status: c.case_status,
        citizen_username: c.citizen_username.trim(),
        citizen_id: c.citizen_id,
        details: c.details.trim(),
        evidence_url: c.evidence_url.trim(),
      })),
    });

    if (!error) {
      // ถ้าออกเวรใน DB ไปแล้วตอนกดปุ่ม (โหมดเขียนทีหลัง) ข้ามขั้นออกเวร
      if (!workReportTarget.alreadyCheckedOut) {
        const dutyOutAt = workReportTarget.clockOut;
        const durMinutes = workReportTarget.durationMinutes;
        await supabase.from('duty_logs').update({
          clock_out: dutyOutAt,
          duration_minutes: durMinutes,
          checkout_method: 'self',
        }).eq('id', workReportTarget.log.id);
        await supabase.from('officers').update({ is_on_duty: false, updated_at: new Date().toISOString() }).eq('id', officer.id);
        setAuth({ ...officer, is_on_duty: false });
        // +5 คะแนน/ชม. สำหรับเวรที่ออกตามปกติ
        await applyCheckoutPoints({
          ...workReportTarget.log,
          clock_out: dutyOutAt,
          duration_minutes: durMinutes,
          checkout_method: 'self',
        } as DutyLog);
      }
      closeReportEditor();
      await fetchData();
      if (canAdmin) await fetchAllLogs();
    } else {
      console.error('create_work_report_with_cases error:', error.message);
    }
    setWorkReportLoading(false);
    setClockLoading(false);
  }

  async function openReportViewer(report: WorkReport) {
    setViewReport(report);
    const { data, error } = await supabase.rpc('get_work_report_cases', { p_work_report_id: report.id });
    if (!error) {
      setViewReportCases((data ?? []) as WorkReportCase[]);
      return;
    }
    const fallback = await supabase.from('work_report_cases').select('*').eq('work_report_id', report.id).order('created_at');
    setViewReportCases((fallback.data ?? []) as WorkReportCase[]);
  }

  async function openCitizenProfileFromCase(item: WorkReportCase) {
    if (!item.citizen_id && !item.citizen_username) return;
    const query = item.citizen_id
      ? supabase.from('citizens').select('*').eq('id', item.citizen_id).maybeSingle()
      : supabase.from('citizens').select('*').ilike('roblox_username', item.citizen_username ?? '').maybeSingle();
    const { data } = await query;
    if (!data) return;

    setViewCitizen(data as Citizen);
    const [vehicles, licenses, fees] = await Promise.all([
      supabase.from('vehicles').select('id', { count: 'exact', head: true }).eq('citizen_id', data.id),
      supabase.from('licenses').select('id', { count: 'exact', head: true }).eq('citizen_id', data.id),
      supabase.from('service_records').select('id', { count: 'exact', head: true }).eq('citizen_id', data.id),
    ]);
    setViewCitizenStats({
      vehicles: vehicles.count ?? 0,
      licenses: licenses.count ?? 0,
      fees: fees.count ?? 0,
    });
  }

  function handleExportCsv() {
    if (filteredDutyLogs.length === 0) {
      alert('ไม่มีข้อมูลสำหรับส่งออก');
      return;
    }

    const headers = ['เจ้าหน้าที่', 'เวลาเข้าเวร', 'เวลาออกเวร', 'ระยะเวลา (นาที)', 'สถานะ', 'วิธีการออกเวร'];
    const rows = filteredDutyLogs.map((log) => [
      `"${(log.officer_name || '').replace(/"/g, '""')}"`,
      `"${log.clock_in ? formatTime(log.clock_in) : '-'}"`,
      `"${log.clock_out ? formatTime(log.clock_out) : '-'}"`,
      `"${log.duration_minutes ?? '-'}"`,
      `"${log.clock_out ? 'เสร็จสิ้น' : 'กำลังปฏิบัติหน้าที่'}"`,
      `"${log.checkout_method === 'forced' ? 'บังคับออกเวร' : (log.checkout_method || 'ปกติ')}"`,
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `duty_logs_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function fetchData() {
    setLoading(true);
    const reportsQuery = canAdmin
      ? supabase.from('work_reports').select('*').order('created_at', { ascending: false })
      : supabase.from('work_reports').select('*').eq('officer_id', officer?.id).order('created_at', { ascending: false });
    const [duty, logs, settingsRes, reportsRes, citizensRes, casesRes] = await Promise.all([
      supabase.from('officers').select('*').eq('is_on_duty', true).eq('status', 'active').order('name'),
      canAdmin
        ? supabase.from('duty_logs').select('*').is('deleted_at', null).order('clock_in', { ascending: false }).limit(200)
        : supabase.from('duty_logs').select('*').eq('officer_id', officer?.id).is('deleted_at', null).order('clock_in', { ascending: false }).limit(100),
      supabase.from('system_settings').select('*').eq('id', 1).maybeSingle(),
      reportsQuery,
      supabase.from('citizens').select('*').order('roblox_username').limit(1000),
      supabase.from('work_report_cases').select('id, work_report_id').limit(3000),
    ]);
    setOnDutyOfficers(duty.data ?? []);
    setDutyLogs(logs.data ?? []);
    setSettings(settingsRes.data as SystemSettings | null);
    const reports = (reportsRes.data ?? []) as WorkReport[];
    setWorkReports(reports);
    // นับเคสต่อรายงาน (กรองเฉพาะรายงานที่โหลดมา)
    const knownIds = new Set(reports.map((r) => r.id));
    const counts: Record<string, number> = {};
    for (const c of ((casesRes.data ?? []) as { id: string; work_report_id: string }[])) {
      if (!c.work_report_id || !knownIds.has(c.work_report_id)) continue;
      counts[c.work_report_id] = (counts[c.work_report_id] ?? 0) + 1;
    }
    setReportCaseCounts(counts);
    setCitizenOptions((citizensRes.data ?? []) as Citizen[]);
    setLoading(false);
  }


  async function clockIn() {
    if (!officer || officer.is_on_duty) return;
    setClockLoading(true);
    const { error: logErr } = await supabase.from('duty_logs').insert({
      officer_id: officer.id,
      officer_name: officer.name,
      clock_in: new Date().toISOString(),
      checkout_method: 'self',
    });
    if (!logErr) {
      await supabase.from('officers').update({ is_on_duty: true, updated_at: new Date().toISOString() }).eq('id', officer.id);
      setAuth({ ...officer, is_on_duty: true });
      await fetchData();
      if (canAdmin) await fetchAllLogs();
    }
    setClockLoading(false);
  }

  async function clockOut() {
    if (!officer || !officer.is_on_duty) return;
    setClockLoading(true);
    const { data: activeLog } = await supabase
      .from('duty_logs')
      .select('*')
      .eq('officer_id', officer.id)
      .is('clock_out', null)
      .is('deleted_at', null)
      .order('clock_in', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!activeLog) {
      setClockLoading(false);
      return;
    }
    // ออกเวรให้เสร็จก่อนเลย แล้วค่อยเปิดฟอร์มรายงาน (เขียนทีหลังได้)
    const now = new Date();
    const dur = Math.round((now.getTime() - new Date(activeLog.clock_in).getTime()) / 60000);
    const { error: outErr } = await supabase.from('duty_logs').update({
      clock_out: now.toISOString(),
      duration_minutes: dur,
      checkout_method: 'self',
    }).eq('id', activeLog.id);
    if (outErr) {
      alert('ออกเวรไม่สำเร็จ: ' + outErr.message);
      setClockLoading(false);
      return;
    }
    await supabase.from('officers').update({ is_on_duty: false, updated_at: new Date().toISOString() }).eq('id', officer.id);
    setAuth({ ...officer, is_on_duty: false });
    await fetchData();
    if (canAdmin) await fetchAllLogs();
    setClockLoading(false);
    // +5 คะแนน/ชม. เมื่อออกเวรตามปกติ
    await applyCheckoutPoints({
      ...(activeLog as DutyLog),
      clock_out: now.toISOString(),
      duration_minutes: dur,
      checkout_method: 'self',
    } as DutyLog);
    openReportEditor({
      log: activeLog as DutyLog,
      clockOut: now.toISOString(),
      durationMinutes: dur,
      alreadyCheckedOut: true,
    });
  }

  async function handleForceCheckout() {
    if (!forceTarget || !officer) return;

    const { data: activeLog } = await supabase
      .from('duty_logs')
      .select('*')
      .eq('officer_id', forceTarget.id)
      .is('clock_out', null)
      .is('deleted_at', null)
      .maybeSingle();

    if (activeLog) {
      const now = new Date();
      const dur = Math.round((now.getTime() - new Date(activeLog.clock_in).getTime()) / 60000);
      await supabase.from('duty_logs').update({
        clock_out: now.toISOString(),
        duration_minutes: dur,
        forced_by: officer.id,
        forced_by_name: officer.name,
        checkout_method: 'forced',
      }).eq('id', activeLog.id);
      // -15 คะแนน เมื่อถูกบังคับให้ออกเวร
      await applyCheckoutPoints({
        ...(activeLog as DutyLog),
        clock_out: now.toISOString(),
        duration_minutes: dur,
        forced_by: officer.id,
        forced_by_name: officer.name,
        checkout_method: 'forced',
      } as DutyLog);
    }

    await supabase.from('officers').update({ is_on_duty: false, updated_at: new Date().toISOString() }).eq('id', forceTarget.id);
    await supabase.from('audit_logs').insert({
      action: 'FORCE_CHECKOUT',
      target_type: 'officer',
      target_id: forceTarget.id,
      performed_by: officer.id,
      performed_by_name: officer.name,
      details: { target_name: forceTarget.name, method: 'force_checkout' },
    });

    setForceTarget(null);
    await fetchData();
    if (canAdmin) await fetchAllLogs();
  }

  async function handleDelete() {
    if (!deleteTarget || !officer) return;
    await supabase.from('duty_logs').update({
      deleted_at: new Date().toISOString(),
      deleted_by: officer.id,
      deleted_by_name: officer.name,
      delete_reason: deleteReason || 'ไม่ระบุเหตุผล',
    }).eq('id', deleteTarget.id);

    await supabase.from('audit_logs').insert({
      action: 'DELETE_DUTY_LOG',
      target_type: 'duty_log',
      target_id: deleteTarget.id,
      performed_by: officer.id,
      performed_by_name: officer.name,
      details: { officer_name: deleteTarget.officer_name, reason: deleteReason },
    });

    setDeleteTarget(null);
    setDeleteReason('');
    await fetchData();
    if (canAdmin) await fetchAllLogs();
  }

  async function showIdCard(o: Officer) {
    const { data: activeLog } = await supabase
      .from('duty_logs')
      .select('clock_in')
      .eq('officer_id', o.id)
      .is('clock_out', null)
      .is('deleted_at', null)
      .order('clock_in', { ascending: false })
      .limit(1)
      .maybeSingle();
    setIdCardOfficer({ officer: o, clockIn: activeLog?.clock_in ?? null });
  }

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString('th-TH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const formatDuration = (mins: number | null) => {
    if (!mins) return '-';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}ชม. ${m}น.` : `${m}น.`;
  };

  // สรุปจำนวนเคสในรายงานเวร: ตามตัวกรองปัจจุบัน + รวมเดือนนี้
  const reportCaseStats = useMemo(() => {
    let reports = 0;
    let cases = 0;
    let monthCases = 0;
    for (const log of filteredDutyLogs) {
      const report = reportByDutyLogId.get(log.id);
      if (!report) continue;
      reports++;
      cases += reportCaseCounts[report.id] ?? 0;
    }
    const thisMonth = new Date().toISOString().slice(0, 7);
    for (const r of workReports) {
      if ((r.created_at ?? '').slice(0, 7) === thisMonth) {
        monthCases += reportCaseCounts[r.id] ?? 0;
      }
    }
    return { reports, cases, monthCases };
  }, [filteredDutyLogs, reportByDutyLogId, reportCaseCounts, workReports]);

  const dutyEnabled = settings?.duty_system_enabled ?? true;
  const workReportsEnabled = settings?.work_reports_enabled ?? true;

  return (
    <div className="min-w-0 overflow-x-hidden">
      <PageHeader
        icon={<Shield size={26} />}
        title="ปฏิบัติการ"
        subtitle="จัดการการเข้า-ออกเวรและสถานะการปฏิบัติหน้าที่"
        actions={
          <div className="flex items-center gap-2">
            {canAdmin && (
              <button
                onClick={() => setShowBatchDutyModal(true)}
                className="btn-secondary flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 border-amber-500/30 py-2 px-3"
                title="กำหนดอัตราค่าขึ้นเวร (BC ต่อชั่วโมง) ให้เจ้าหน้าที่ทุกคนพร้อมกัน"
              >
                <Zap size={14} /> กำหนดเรทขึ้นเวรทุกคน
              </button>
            )}
          </div>
        }
      />

      {/* ---------- แท็บ ---------- */}
      <div className="card p-1.5 mb-5 flex items-center gap-1.5 overflow-x-auto">
        <span className="ph-corner ph-corner-tl" aria-hidden />
        {!approvalsOnly && (
          <TabButton active={opsTab === 'duty'} onClick={() => setOpsTab('duty')} icon={<Clock size={14} />} label="ปฏิบัติงาน" />
        )}
        {!approvalsOnly && (
          <TabButton active={opsTab === 'roster'} onClick={() => setOpsTab('roster')} icon={<CalendarDays size={14} />} label="ตารางเวร" />
        )}
        {/* แท็บอนุมัติรายงาน ถูกถอดออกจากหน้าหลักแล้ว — เข้าผ่านการ์ด "อนุมัติรายงาน" ในเมนู Admin เท่านั้น */}
      </div>

      {/* ---------- แท็บ: อนุมัติรายงานปฏิบัติงาน ---------- */}
      {opsTab === 'approvals' && canAdmin && (
        <WorkReportApprovalPanel
          pending={pendingReports}
          approved={approvedReports}
          rejected={rejectedReports}
          caseCounts={reportCaseCounts}
          onReview={openReportReview}
          onDelete={(r) => setDeletingWorkReport(r)}
        />
      )}

      {/* ---------- แท็บ: ตารางเวร ---------- */}
      {opsTab === 'roster' && (
        <WeeklyRosterPanel
          roster={weeklyRoster}
          weekAnchor={weekAnchor}
          onPrev={() => setWeekAnchor((w) => shiftWeek(w, -1))}
          onNext={() => setWeekAnchor((w) => shiftWeek(w, 1))}
          onToday={() => setWeekAnchor(toIso(new Date()))}
          canEdit={canAdmin}
          onEditCell={setEditingCell}
          officers={rosterOfficers}
          onSaveBase={saveScheduleSlot}
          onSaveOverride={saveOverrideSlot}
          onClearOverride={clearOverride}
          onSwapWeek={swapShiftForWeek}
          onRandomize={canAdmin ? () => setShowRandomize(true) : undefined}
        />
      )}

      {opsTab === 'duty' && (
        <>


      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Clock In/Out Panel */}
        <div className="lg:col-span-1 space-y-4">
          <div className="section-panel">
            <div className="section-bar">
              <span className="section-bar-icon"><Clock size={14} /></span>
              <span className="section-bar-title">การปฏิบัติหน้าที่ของฉัน</span>
            </div>
            <div className="p-4 space-y-4">
              {(() => {
                const onDuty = !!officer?.is_on_duty;
                const activeLog = officer
                  ? dutyLogs.find((l) => l.officer_id === officer.id && !l.clock_out && !l.deleted_at)
                  : undefined;
                return (
                  <div className={`rounded-xl p-4 text-center border ${
                    onDuty ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-navy-900/60 border-[#2a324b]'
                  }`}>
                    <div className="flex items-center justify-center gap-2 mb-1">
                      <span className="relative flex h-2.5 w-2.5">
                        {onDuty && (
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                        )}
                        <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${onDuty ? 'bg-emerald-400' : 'bg-gray-500'}`} />
                      </span>
                      <div className={`text-lg font-bold ${onDuty ? 'text-emerald-400' : 'text-white'}`}>
                        {onDuty ? 'กำลังปฏิบัติหน้าที่' : 'ไม่ได้ปฏิบัติหน้าที่'}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500">
                      {onDuty
                        ? activeLog
                          ? `เข้าเวรเมื่อ ${formatTime(activeLog.clock_in)}`
                          : 'กำลังปฏิบัติหน้าที่'
                        : dutyEnabled
                          ? 'กดปุ่มด้านล่างเพื่อเริ่มเวร'
                          : 'รอหัวหน้ากรมเปิดระบบรับเวร'}
                    </div>
                  </div>
                );
              })()}

              {/* Duty system disabled warning */}
              {!dutyEnabled && !officer?.is_on_duty && (
                <div className="rounded-xl bg-red-500/10 border border-red-500/30 px-4 py-3 flex items-start gap-2.5">
                  <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-red-400 text-sm font-semibold">ระบบปิดรับเวรชั่วคราว</div>
                    <div className="text-red-400/70 text-xs mt-0.5">กรุณารอหัวหน้ากรมเปิดระบบก่อนลงชื่อเข้าเวร</div>
                  </div>
                </div>
              )}

              {!officer?.is_on_duty ? (
                dutyEnabled ? (
                  <button
                    onClick={clockIn}
                    disabled={clockLoading}
                    className="w-full btn-primary py-3 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed text-base"
                  >
                    <LogIn size={18} /> {clockLoading ? 'กำลังดำเนินการ...' : 'ลงชื่อเข้าเวร'}
                  </button>
                ) : (
                  <button
                    disabled
                    title="ระบบปิดรับเวรชั่วคราว"
                    className="w-full py-3 flex items-center justify-center gap-2 rounded-lg bg-navy-600/50 text-gray-500 border border-[#2a324b] cursor-not-allowed text-base font-semibold"
                  >
                    <LogIn size={18} /> ลงชื่อเข้าเวร
                  </button>
                )
              ) : (
                <button onClick={clockOut} disabled={clockLoading} className="w-full btn-danger py-3 flex items-center justify-center gap-2 text-base">
                  <LogOut size={18} /> {clockLoading ? 'กำลังดำเนินการ...' : 'ลงชื่อออกเวร'}
                </button>
              )}

              {officer?.is_on_duty && (
                <button
                  onClick={() => showIdCard(officer)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-500/15 text-blue-400 border border-blue-500/20 hover:bg-blue-500/25 transition-colors text-sm font-medium"
                >
                  <ImageIcon size={16} /> ดูบัตรประจำตัว
                </button>
              )}
            </div>
          </div>

          {/* On-Duty Officers */}
          <div className="section-panel">
            <div className="section-bar">
              <span className="section-bar-icon"><Users size={14} /></span>
              <span className="section-bar-title">เจ้าหน้าที่ที่ปฏิบัติหน้าที่ ({onDutyOfficers.length})</span>
            </div>
            {onDutyOfficers.length === 0 ? (
              <p className="text-gray-500 text-xs text-center py-4">ยังไม่มีเจ้าหน้าที่ปฏิบัติหน้าที่</p>
            ) : (
              <div className="space-y-2">
                {onDutyOfficers.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => showIdCard(o)}
                    className="w-full flex items-center gap-2.5 py-1.5 rounded-lg hover:bg-navy-700 transition-colors text-left"
                  >
                    <div className="w-7 h-7 rounded-full overflow-hidden bg-blue-900 flex items-center justify-center flex-shrink-0">
                      {o.photo_url ? (
                        <img src={o.photo_url} alt={o.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-amber-400 font-bold text-xs">{o.name.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-xs font-medium truncate">{o.name}</div>
                      <div className="text-gray-500 text-[10px]">{DEPARTMENT_LABELS[o.department]}</div>
                    </div>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* History Table */}
        <div className="lg:col-span-2">
          <div className="table-panel overflow-hidden">
            <div className="px-3 sm:px-5 py-3 sm:py-4 border-b border-amber-500/15 flex flex-wrap items-center justify-between gap-2 sm:gap-3">
              <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0">
                <h2 className="text-sm font-semibold text-white">
                  {canAdmin ? 'ประวัติการปฏิบัติหน้าที่ทั้งหมด' : 'ประวัติของฉัน'}
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 whitespace-nowrap">
                  {filteredDutyLogs.length} รายการ
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 whitespace-nowrap">
                  {reportCaseStats.reports} ฉบับ · {reportCaseStats.cases} เคส
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30 whitespace-nowrap">
                  เดือนนี้ {reportCaseStats.monthCases} เคส
                </span>
              </div>
              <button
                onClick={handleExportCsv}
                disabled={filteredDutyLogs.length === 0}
                className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 border-blue-900/60 hover:border-amber-500/40 text-amber-300 hover:text-amber-200 disabled:opacity-40 disabled:cursor-not-allowed"
                title="ดาวน์โหลดรายงานประวัติเป็นไฟล์ CSV"
              >
                <Download size={13} /> Export CSV
              </button>
            </div>

            {/* Filter Toolbar */}
            <div className="p-3 bg-navy-900/40 border-b border-blue-900/30 flex flex-wrap items-center gap-2.5">
              <div className="relative flex-1 min-w-[180px]">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  className="input-field py-1.5 pl-8 text-xs w-full bg-navy-900"
                  placeholder="ค้นหาชื่อเจ้าหน้าที่..."
                  value={searchOfficer}
                  onChange={(e) => setSearchOfficer(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-1.5">
                <Filter size={13} className="text-gray-400" />
                <select
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value as any)}
                  className="bg-navy-900 border border-blue-900/50 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
                >
                  <option value="all">ช่วงเวลาทั้งหมด</option>
                  <option value="today">วันนี้</option>
                  <option value="7days">7 วันล่าสุด</option>
                  <option value="month">เดือนนี้</option>
                  <option value="custom">กำหนดช่วงวันที่...</option>
                </select>
              </div>

              {dateFilter === 'custom' && (
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="bg-navy-900 border border-blue-900/50 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                  <span>ถึง</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="bg-navy-900 border border-blue-900/50 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              {loading ? (
                <div className="p-8 text-center text-gray-500 text-sm">กำลังโหลด...</div>
              ) : filteredDutyLogs.length === 0 ? (
                <div className="p-8 text-center">
                  <Clock size={32} className="text-gray-600 mx-auto mb-2" />
                  <p className="text-gray-500 text-sm">
                    {dutyLogs.length === 0 ? 'ยังไม่มีประวัติ' : 'ไม่พบข้อมูลตามเงื่อนไขการค้นหา/ตัวกรอง'}
                  </p>
                </div>
              ) : (
                <table className="w-full">
                  <thead className="table-header-gold">
                    <tr className="border-b border-amber-500/15">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">เจ้าหน้าที่</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">เข้าเวร</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">ออกเวร</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">ระยะเวลา</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">รายงานปฏิบัติงาน</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">สถานะ</th>
                      {canAdmin && <th className="px-4 py-3" />}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDutyLogs.map((log) => {
                      const report = reportByDutyLogId.get(log.id);
                      return (
                        <tr key={log.id} className="table-row">
                          <td className="px-4 py-3 text-sm text-white font-medium">
                            {log.officer_name}
                            {log.checkout_method === 'forced' && (
                              <span className="ml-2 text-[10px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">บังคับออก</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-400 whitespace-nowrap">{formatTime(log.clock_in)}</td>
                          <td className="px-4 py-3 text-sm text-gray-400 whitespace-nowrap">{log.clock_out ? formatTime(log.clock_out) : '-'}</td>
                          <td className="px-4 py-3 text-sm text-gray-400">{formatDuration(log.duration_minutes)}</td>
                          <td className="px-4 py-3 text-center">
                            {report ? (
                              <div>
                                <button onClick={() => openReportViewer(report)} className="btn-secondary mx-auto px-3 py-1.5 text-xs flex items-center gap-1.5">
                                  <FileText size={13} /> ดูรายงาน
                                </button>
                                <div className="text-[10px] text-gray-500 mt-1">
                                  {(reportCaseCounts[report.id] ?? 0).toLocaleString('th-TH')} เคส
                                </div>
                              </div>
                            ) : log.clock_out && canWriteDutyReport(log) ? (
                              <button onClick={() => openRetrospectiveReport(log)} className="btn-secondary mx-auto px-3 py-1.5 text-xs flex items-center gap-1.5">
                                <Plus size={13} /> เขียนย้อนหลัง
                              </button>
                            ) : log.clock_out ? (
                              <span className="text-xs text-gray-600">ไม่มีรายงาน</span>
                            ) : (
                              <span className="text-xs text-gray-600">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge variant={log.clock_out ? 'success' : 'warning'}>
                              {log.clock_out ? 'เสร็จสิ้น' : 'กำลังปฏิบัติหน้าที่'}
                            </Badge>
                          </td>
                          {canAdmin && (
                            <td className="px-4 py-3">
                              <button
                                onClick={() => setDeleteTarget(log)}
                                className="text-gray-600 hover:text-red-400 transition-colors"
                                title="ลบประวัติ"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ID Card Modal */}
      {idCardOfficer && (
        <Modal title="บัตรประจำตัวดิจิทัลเจ้าหน้าที่" onClose={() => setIdCardOfficer(null)} size="sm">
          <div className="flex justify-center">
            <IdCard
              officer={idCardOfficer.officer}
              clockInTime={idCardOfficer.clockIn}
              showActions
              onForceCheckout={(o) => { setIdCardOfficer(null); setForceTarget(o); }}
            />
          </div>
        </Modal>
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <ConfirmDialog
          title="ลบประวัติการปฏิบัติหน้าที่"
          message={`ต้องการลบประวัติของ "${deleteTarget.officer_name}" ใช่หรือไม่?`}
          confirmLabel="ลบ"
          danger
          onConfirm={handleDelete}
          onCancel={() => { setDeleteTarget(null); setDeleteReason(''); }}
          extraField={{ label: 'เหตุผลในการลบ', value: deleteReason, onChange: setDeleteReason, placeholder: 'ระบุเหตุผล...' }}
        />
      )}

      {workReportTarget && (
        <Modal title="รายงานการปฏิบัติงานหลังออกเวร" onClose={closeReportEditor} size="xl">
          <form onSubmit={submitWorkReport} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-navy-900/50 border border-blue-900/40 rounded-lg p-3">
                <div className="text-[10px] text-gray-500 mb-1">เจ้าหน้าที่</div>
                <div className="text-sm font-semibold text-white">{workReportTarget.log.officer_name}</div>
              </div>
              <div className="bg-navy-900/50 border border-blue-900/40 rounded-lg p-3">
                <div className="text-[10px] text-gray-500 mb-1">เวลาเข้า-ออกเวร</div>
                <div className="text-xs text-gray-300">{formatTime(workReportTarget.log.clock_in)} → {formatTime(workReportTarget.clockOut)}</div>
              </div>
              <div className="bg-navy-900/50 border border-blue-900/40 rounded-lg p-3">
                <div className="text-[10px] text-gray-500 mb-1">ระยะเวลาปฏิบัติหน้าที่</div>
                <div className="text-sm font-semibold text-amber-300">{formatDuration(workReportTarget.durationMinutes)}</div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">หมวดหมู่ประเภทงาน</label>
              <select className="input-field" value={workReportCategory} onChange={(e) => setWorkReportCategory(e.target.value)}>
                <option value="patrol">ลาดตระเวน</option>
                <option value="incident">รับแจ้งเหตุ</option>
                <option value="ticket">ออกใบสั่ง</option>
                <option value="traffic">จัดการจราจร</option>
                <option value="rescue">ช่วยเหลือ/กู้ภัย</option>
                <option value="other">อื่นๆ</option>
              </select>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-white">เคสที่ทำ</h3>
                <button type="button" onClick={addReportCase} className="btn-secondary px-3 py-1.5 text-xs flex items-center gap-1.5">
                  <Plus size={13} /> เพิ่มเคส
                </button>
              </div>

              <datalist id="citizen-options">
                {citizenOptions.map((c) => (
                  <option key={c.id} value={c.roblox_username}>{c.discord_username || c.roblox_username}</option>
                ))}
              </datalist>

              {workReportCases.map((item, idx) => (
                <div key={idx} className="rounded-lg border border-blue-900/40 bg-navy-900/30 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-400">เคส #{idx + 1}</span>
                    {workReportCases.length > 1 && (
                      <button type="button" onClick={() => removeReportCase(idx)} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
                        <X size={12} /> ลบเคส
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">ชื่อเคส / รหัสเคส</label>
                      <input className="input-field" value={item.case_name} onChange={(e) => updateReportCase(idx, 'case_name', e.target.value)} placeholder="เช่น CASE-1024 / ช่วยเหลือรถเสีย" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">ประชาชนที่เกี่ยวข้อง (Optional)</label>
                      <input className="input-field" list="citizen-options" value={item.citizen_username} onChange={(e) => updateReportCase(idx, 'citizen_username', e.target.value)} placeholder="ค้นหา Roblox/Discord หรือเว้นว่างได้" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">สถานะเคส</label>
                    <select className="input-field" value={item.case_status} onChange={(e) => updateReportCase(idx, 'case_status', e.target.value as ReportCaseDraft['case_status'])}>
                      <option value="completed">เสร็จสิ้น</option>
                      <option value="in_progress">กำลังดำเนินการ</option>
                      <option value="transferred">ส่งต่อ</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">รายละเอียดสรุปเคส</label>
                    <textarea className="input-field resize-none" rows={3} value={item.details} onChange={(e) => updateReportCase(idx, 'details', e.target.value)} placeholder="สรุปสิ่งที่ดำเนินการ ผลลัพธ์ และข้อมูลสำคัญของเคสนี้" />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">รูปภาพหลักฐานประจำเคส</label>
                    {item.evidence_url ? (
                      <div className="rounded-lg overflow-hidden border border-blue-900/50 bg-navy-900 p-2.5">
                        <div className="flex items-center gap-3">
                          <img src={item.evidence_url} alt="ภาพหลักฐาน" className="w-16 h-16 object-cover rounded-md border border-blue-900/40 bg-navy-900 flex-shrink-0" />
                          <button type="button" onClick={() => setViewEvidenceUrl(item.evidence_url)} className="text-xs text-emerald-400 hover:text-emerald-300 underline truncate flex-1 text-left">
                            เปิดดูรูปภาพหลักฐาน
                          </button>
                          <button type="button" onClick={() => updateReportCase(idx, 'evidence_url', '')} className="px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs flex items-center gap-1 transition-colors flex-shrink-0">
                            <Trash2 size={13} /> ลบรูป
                          </button>
                        </div>
                      </div>
                    ) : uploadingCaseIndex === idx ? (
                      <div className="flex items-center justify-center gap-2 py-4 border-2 border-dashed border-amber-500/40 rounded-lg bg-navy-900/40 text-amber-400 text-xs">
                        <Loader2 size={16} className="animate-spin" />
                        <span>กำลังอัปโหลดรูปภาพ...</span>
                      </div>
                    ) : (
                      <label className="flex flex-col items-center justify-center gap-1 py-4 border-2 border-dashed border-blue-900/50 rounded-lg cursor-pointer hover:border-amber-500/40 hover:bg-navy-800/40 transition-all text-center">
                        <div className="flex items-center gap-1.5 text-xs text-gray-300 font-medium">
                          <Upload size={14} className="text-amber-400" />
                          <span>คลิกเพื่ออัปโหลดรูปภาพของเคสนี้</span>
                        </div>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleCaseImageUpload(idx, file);
                            e.currentTarget.value = '';
                          }}
                        />
                      </label>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">รายละเอียดเพิ่มเติม / ปัญหาอุปสรรคระหว่างเวร</label>
              <textarea className="input-field resize-none" rows={4} value={workReportSummary} onChange={(e) => setWorkReportSummary(e.target.value)} placeholder="บันทึกรายละเอียดภาพรวม ปัญหาที่พบ หรือข้อมูลที่ผู้บริหารควรทราบ" />
            </div>

            <div className="flex gap-3 justify-end flex-wrap">
              <button type="button" onClick={closeReportEditor} className="btn-secondary">ยกเลิก</button>
              <button
                type="button"
                onClick={closeReportEditor}
                title="ออกเวรแล้ว กลับมาเขียนรายงานทีหลังได้จากปุ่มเขียนย้อนหลังในประวัติ"
                className="btn-secondary flex items-center gap-1.5 border-amber-500/30 text-amber-300 hover:text-amber-200"
              >
                <Clock size={14} /> เขียนรายงานภายหลัง
              </button>
              <button type="submit" disabled={workReportLoading || uploadingCaseIndex !== null} className="btn-primary disabled:opacity-50">
                {workReportLoading ? 'กำลังบันทึก...' : workReportTarget?.alreadyCheckedOut ? 'ส่งรายงาน' : 'ส่งรายงานและออกเวร'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ---------- Modal: ดูรายละเอียดรายงาน (ใช้ component กลางร่วมกับฝั่ง Admin) ---------- */}
      {viewReport && (
        <ReportDetailModal
          report={viewReport}
          cases={viewReportCases}
          onClose={() => { setViewReport(null); setViewReportCases([]); }}
          onOpenCitizen={openCitizenProfileFromCase}
        />
      )}

      {viewCitizen && (
        <Modal title={`โปรไฟล์ประชาชน: ${viewCitizen.roblox_username}`} onClose={() => setViewCitizen(null)} size="md">
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-navy-900/50 border border-blue-900/40 rounded-lg p-3">
                <div className="text-[10px] text-gray-500 mb-1">Roblox Username</div>
                <div className="text-sm font-semibold text-white">{viewCitizen.roblox_username}</div>
              </div>
              <div className="bg-navy-900/50 border border-blue-900/40 rounded-lg p-3">
                <div className="text-[10px] text-gray-500 mb-1">Discord Username</div>
                <div className="text-sm text-gray-200">{viewCitizen.discord_username || '-'}</div>
              </div>
              <div className="bg-navy-900/50 border border-blue-900/40 rounded-lg p-3">
                <div className="text-[10px] text-gray-500 mb-1">สถานะ</div>
                <div className="text-sm text-gray-200">{viewCitizen.status}</div>
              </div>
              <div className="bg-navy-900/50 border border-blue-900/40 rounded-lg p-3">
                <div className="text-[10px] text-gray-500 mb-1">ข้อมูลที่เชื่อมโยง</div>
                <div className="text-sm text-amber-300">
                  รถ {viewCitizenStats.vehicles} · ใบอนุญาต {viewCitizenStats.licenses} · ค่าบริการ {viewCitizenStats.fees}
                </div>
              </div>
            </div>
            {viewCitizen.notes && (
              <div className="bg-navy-900/50 border border-blue-900/40 rounded-lg p-3">
                <div className="text-[10px] text-gray-500 mb-1">หมายเหตุ</div>
                <div className="text-sm text-gray-200 whitespace-pre-wrap">{viewCitizen.notes}</div>
              </div>
            )}
            <div className="flex justify-end">
              <button onClick={() => setViewCitizen(null)} className="btn-secondary">ปิด</button>
            </div>
          </div>
        </Modal>
      )}

      </>
      )}

      {/* Force Checkout Confirm */}
      {forceTarget && (
        <ConfirmDialog
          title="บังคับออกเวร"
          message={`ต้องการสั่งให้ "${forceTarget.name}" ออกจากเวรทันทีใช่หรือไม่? ระบบจะบันทึกประวัติว่าหัวหน้าเป็นคนสั่งออก`}
          confirmLabel="บังคับออกเวร"
          danger
          onConfirm={handleForceCheckout}
          onCancel={() => setForceTarget(null)}
        />
      )}

      {/* Batch Duty Rate Modal (กำหนดเรทขึ้นเวรทุกคน) */}
      {showBatchDutyModal && (
        <BatchDutyRateModal
          onClose={() => setShowBatchDutyModal(false)}
          onSaved={async () => {
            setShowBatchDutyModal(false);
            await fetchData();
            if (canAdmin) await fetchAllLogs();
          }}
        />
      )}

      {/* ---------- Modal: สุ่มเวรอัตโนมัติ ---------- */}
      {canAdmin && (
        <RandomizeRosterModal
          open={showRandomize}
          onClose={() => { setShowRandomize(false); setRandomPreview(null); }}
          officers={rosterOfficers}
          ranks={ranks}
          preview={randomPreview}
          requireLeader={requireLeader}
          onToggleRequireLeader={() => { setRequireLeader((v) => !v); setRandomPreview(null); }}
          onRandomize={doRandomize}
          onSave={saveRandomRoster}
          busy={randomizing}
        />
      )}

      {/* ---------- Modal: จัดกำลังพล 1 ช่องกะ ---------- */}
      {editingCell && weeklyRoster.rows[editingCell.shift]?.[editingCell.date] && (
        <ShiftStaffingModal
          date={editingCell.date}
          shift={editingCell.shift as ShiftCode}
          cell={weeklyRoster.rows[editingCell.shift]![editingCell.date]}
          baseOfficerIds={editingBaseIds}
          existingOverrides={editingOverrides}
          officers={rosterOfficers}
          onClose={() => setEditingCell(null)}
          onSaveBase={saveScheduleSlot}
          onSaveOverride={saveOverrideSlot}
          onClearOverride={clearOverride}
          onSwapWeek={swapShiftForWeek}
          onClearWeek={clearWeekOverrides}
          weekDays={weeklyRoster.days.map((d) => d.date)}
          saveFlash={saveFlash}
        />
      )}

      {/* ---------- Modal: ยืนยันลบรายงานปฏิบัติงาน ---------- */}
      {deletingWorkReport && (
        <Modal
          title="ยืนยันการลบรายงานปฏิบัติงาน"
          onClose={() => setDeletingWorkReport(null)}
          size="sm"
        >
          <div className="space-y-3">
            <p className="text-sm text-gray-200 leading-relaxed">
              คุณต้องการลบรายงานปฏิบัติงานของ{' '}
              <strong className="text-white">{deletingWorkReport.officer_name}</strong>{' '}
              ใช่หรือไม่
            </p>

            <div className="text-[11px] text-gray-400 bg-navy-900/50 border border-blue-900/40 rounded-lg px-3 py-2.5 space-y-1">
              <div className="flex justify-between gap-3">
                <span className="text-gray-500">สถานะปัจจุบัน</span>
                <span>{WORK_REPORT_STATUS_LABELS[(deletingWorkReport.status ?? 'pending') as WorkReportStatus]}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-500">ส่งเมื่อ</span>
                <span>{formatTimestamp(deletingWorkReport.created_at)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-500">จำนวนเคส</span>
                <span>{reportCaseCounts[deletingWorkReport.id] ?? 0} เคส</span>
              </div>
            </div>

            {(deletingWorkReport.reviewed_points ?? 0) > 0 && (
              <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2.5 leading-relaxed">
                รายงานนี้เคยได้รับการอนุมัติและให้คะแนน{' '}
                <strong className="text-amber-200">+{deletingWorkReport.reviewed_points}</strong> ไปแล้ว
                ระบบจะ<strong className="text-amber-200">คืนคะแนนกลับ</strong>ให้เจ้าหน้าที่คนนั้นในขั้นตอนเดียวกัน
              </div>
            )}

            <p className="text-[11px] text-red-300/90 leading-relaxed">
              รายงานและเคสทั้งหมดในรายงานนี้จะถูกลบถาวร ย้อนกลับไม่ได้
            </p>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => deleteWorkReport(deletingWorkReport)}
                disabled={deletingReportBusy}
                className="btn-danger flex-1 flex items-center justify-center gap-1.5 text-xs disabled:opacity-40"
              >
                {deletingReportBusy
                  ? <Loader2 size={14} className="animate-spin" />
                  : <Trash2 size={14} />}
                ยืนยันลบ
              </button>
              <button
                onClick={() => setDeletingWorkReport(null)}
                disabled={deletingReportBusy}
                className="btn-secondary text-xs"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ---------- Modal: ตรวจ/ไม่อนุมัติรายงานปฏิบัติงาน ---------- */}
      {reviewingWorkReport && (
        <Modal
          title={reportReviewAction === 'approved' ? 'อนุมัติรายงานปฏิบัติงาน' : 'ไม่อนุมัติรายงานปฏิบัติงาน'}
          onClose={() => { setReviewingWorkReport(null); setReportReviewNote(''); }}
          size="md"
        >
          <div className="space-y-4">
            <div className="card p-3 bg-navy-700/50">
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <span className="text-white font-semibold">{reviewingWorkReport.officer_name}</span>
                <Badge variant="neutral">{getDutyCategoryLabel(reviewingWorkReport.duty_category)}</Badge>
              </div>
              <p className="text-xs text-gray-400 whitespace-pre-wrap">
                {reviewingWorkReport.summary || reviewingWorkReport.report_text}
              </p>
              <p className="text-[10px] text-gray-500 mt-1.5 font-mono">
                ส่งเมื่อ {formatTimestamp(reviewingWorkReport.created_at)} · {reportCaseCounts[reviewingWorkReport.id] ?? 0} เคส
              </p>
            </div>

            {reportReviewAction === 'approved' && autoPointsOn && (
              <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2 flex items-center gap-1.5">
                <Award size={13} />
                ระบบจะให้คะแนนอัตโนมัติ +{AUTO_POINTS_RULES.reportApproved} PPS แก่ผู้ส่งรายงาน
              </div>
            )}
            {reportReviewAction === 'approved' && !autoPointsOn && (
              <div className="text-xs text-gray-400 bg-navy-700/50 border border-blue-900/40 rounded-lg px-3 py-2 flex items-center gap-1.5">
                <AlertCircle size={13} />
                สวิตช์คะแนนอัตโนมัติปิดอยู่ — อนุมัติแล้วจะไม่ได้คะแนนอัตโนมัติ
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                หมายเหตุ{reportReviewAction === 'rejected' ? ' (จำเป็นต้องระบุเหตุผล)' : ''}
              </label>
              <textarea
                className="input-field resize-none"
                rows={3}
                placeholder={reportReviewAction === 'rejected' ? 'ระบุเหตุผลที่ไม่อนุมัติ...' : 'หมายเหตุ (ถ้ามี)...'}
                value={reportReviewNote}
                onChange={(e) => setReportReviewNote(e.target.value)}
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setReviewingWorkReport(null); setReportReviewNote(''); }}
                className="btn-secondary flex-1"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={submitReportReview}
                disabled={reportReviewAction === 'rejected' && !reportReviewNote.trim()}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed ${
                  reportReviewAction === 'approved'
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-red-600 hover:bg-red-700 text-white'
                }`}
              >
                {reportReviewAction === 'approved' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                {reportReviewAction === 'approved' ? 'ยืนยันอนุมัติ' : 'ยืนยันไม่อนุมัติ'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* =============================================================
 * Subcomponents: แท็บ / ตารางเวร / อนุมัติรายงาน / สวิตช์คะแนน
 * ============================================================= */

function TabButton({
  active, onClick, icon, label, badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
        active
          ? 'bg-gradient-to-b from-amber-300 to-amber-500 text-navy-900 shadow-lg shadow-amber-500/20'
          : 'text-gray-400 hover:text-white hover:bg-navy-700'
      }`}
    >
      {icon}
      {label}
      {badge !== undefined && badge > 0 && (
        <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
          active ? 'bg-navy-900 text-amber-300' : 'bg-amber-500/20 text-amber-300'
        }`}>
          {badge}
        </span>
      )}
    </button>
  );
}

/* ---------- แท็บอนุมัติรายงานปฏิบัติงาน ---------- */
function WorkReportApprovalPanel({
  pending, approved, rejected, caseCounts, onReview, onDelete,
}: {
  pending: WorkReport[];
  approved: WorkReport[];
  rejected: WorkReport[];
  caseCounts: Record<string, number>;
  onReview: (r: WorkReport, action: 'approved' | 'rejected') => void;
  onDelete: (r: WorkReport) => void;
}) {
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const list = tab === 'pending' ? pending : tab === 'approved' ? approved : rejected;

  const variant = (s: WorkReportStatus): 'warning' | 'success' | 'danger' =>
    s === 'approved' ? 'success' : s === 'rejected' ? 'danger' : 'warning';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatBox label="รอตรวจ" value={pending.length} tone="amber" />
        <StatBox label="อนุมัติแล้ว" value={approved.length} tone="emerald" />
        <StatBox label="ไม่อนุมัติ" value={rejected.length} tone="red" />
      </div>

      <div className="card p-1.5 flex items-center gap-1.5">
        <div className="gold-toggle">
          <button className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>
            รอตรวจ ({pending.length})
          </button>
          <button className={tab === 'approved' ? 'active' : ''} onClick={() => setTab('approved')}>
            อนุมัติแล้ว ({approved.length})
          </button>
          <button className={tab === 'rejected' ? 'active' : ''} onClick={() => setTab('rejected')}>
            ไม่อนุมัติ ({rejected.length})
          </button>
        </div>
      </div>

      <div className="table-panel">
        {list.length === 0 ? (
          <div className="p-12 text-center">
            <Trophy size={32} className="text-gray-600 mx-auto mb-2" />
            <p className="text-gray-400 text-sm">
              {tab === 'pending' ? 'ไม่มีรายงานค้างรอตรวจ' : 'ยังไม่มีรายการในหมวดนี้'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-blue-900/30">
            {list.map((r) => {
              const status = (r.status ?? 'pending') as WorkReportStatus;
              return (
                <div key={r.id} className="p-4 table-row">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-semibold text-sm">{r.officer_name}</span>
                        <Badge variant={variant(status)}>{WORK_REPORT_STATUS_LABELS[status]}</Badge>
                        <span className="text-[10px] text-gray-500 bg-navy-700 px-1.5 py-0.5 rounded">
                          {getDutyCategoryLabel(r.duty_category)}
                        </span>
                        <span className="text-[10px] text-gray-500 font-mono">
                          {caseCounts[r.id] ?? 0} เคส
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1.5 line-clamp-2">
                        {r.summary || r.report_text}
                      </p>
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-500 flex-wrap">
                        <span>{formatTimestamp(r.created_at)}</span>
                        {r.reviewed_by_name && <span>ตรวจโดย {r.reviewed_by_name}</span>}
                        {typeof r.reviewed_points === 'number' && r.reviewed_points > 0 && (
                          <span className="text-emerald-400">+{r.reviewed_points} คะแนน</span>
                        )}
                        {r.review_note && <span className="italic">"{r.review_note}"</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {status === 'pending' && (
                        <>
                          <button
                            onClick={() => onReview(r, 'approved')}
                            className="bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1"
                          >
                            <CheckCircle2 size={14} /> อนุมัติ
                          </button>
                          <button
                            onClick={() => onReview(r, 'rejected')}
                            className="bg-red-500/10 text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1"
                          >
                            <XCircle size={14} /> ไม่อนุมัติ
                          </button>
                        </>
                      )}
                      {/* ลบได้ทุกสถานะ: รอตรวจ / อนุมัติแล้ว / ไม่อนุมัติ */}
                      <button
                        onClick={() => onDelete(r)}
                        className="bg-red-500/5 text-red-400/80 hover:text-red-300 hover:bg-red-500/15 px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 border border-red-500/20 hover:border-red-500/40"
                        title="ลบรายงานนี้"
                      >
                        <Trash2 size={14} /> ลบ
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ label, value, tone }: { label: string; value: number; tone: 'amber' | 'emerald' | 'red' }) {
  const tones = {
    amber: 'text-amber-400 border-amber-500/20',
    emerald: 'text-emerald-400 border-emerald-500/20',
    red: 'text-red-400 border-red-500/20',
  };
  return (
    <div className={`card p-3 text-center border ${tones[tone]}`}>
      <div className={`text-2xl font-bold ${tones[tone].split(' ')[0]}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

/* ---------- แท็บตารางเวร (Weekly Roster) ---------- */
function WeeklyRosterPanel({
  roster, weekAnchor, onPrev, onNext, onToday,
  canEdit, onEditCell, officers, onSaveBase, onSaveOverride, onClearOverride, onSwapWeek,
  onRandomize,
}: {
  roster: ReturnType<typeof buildWeeklyRoster>;
  weekAnchor: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  canEdit: boolean;
  onEditCell: (c: { date: string; shift: ScheduleCellCode }) => void;
  officers: Officer[];
  onSaveBase: (p: { weekday: number; shift: ShiftCode; officerIds: string[]; required: number }) => void;
  onSaveOverride: (p: {
    date: string; shift: ScheduleCellCode;
    entries: Array<{ officerId: string | null; type: ScheduleOverride['override_type'] }>;
  }) => void;
  onClearOverride: (date: string, shift: ScheduleCellCode) => void;
  onSwapWeek: (shift: ShiftCode, toOfficerId: string) => Promise<boolean>;
  onRandomize?: () => void;
}) {
  const rankById = useMemo(() => new Map(officers.map((o) => [o.id, o.rank])), [officers]);
  const shortSlots = roster.understaffedCount + roster.gapCount;

  const start = roster.days[0]?.date ?? weekAnchor;
  const end = roster.days[6]?.date ?? weekAnchor;
  const weekLabel = `${roster.days[0]?.dayOfMonth ?? ''}–${roster.days[6]?.dayOfMonth ?? ''} ${monthLabelOf(start)}`;

  // สัปดาห์นี้อยู่ห่างจากสัปดาห์ปัจจุบันกี่สัปดาห์ (0 = สัปดาห์นี้)
  const currentStart = shiftWeek(toIso(new Date()), 0);
  const weekDiff = Math.round(
    (new Date(`${start}T00:00:00`).getTime() - new Date(`${currentStart}T00:00:00`).getTime()) / (7 * 86400000),
  );
  const isCurrentWeek = weekDiff === 0;
  const weekOffsetLabel = isCurrentWeek
    ? 'สัปดาห์นี้'
    : weekDiff === 1
      ? 'สัปดาห์ถัดไป'
      : weekDiff === -1
        ? 'สัปดาห์ที่แล้ว'
        : weekDiff > 0
          ? `อีก ${weekDiff} สัปดาห์`
          : `${Math.abs(weekDiff)} สัปดาห์ที่แล้ว`;

  return (
    <div className="space-y-3">
      {/* หัวตารางเวร — ช่วงวันที่ต้องเห็นชัดเสมอ ไม่งั้นกดลูกศรแล้วจะไม่รู้ว่าเลื่อนไปไหน */}
      <div className="card px-4 py-3 space-y-2">
        <div className="flex flex-nowrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-white truncate leading-tight min-w-0">
            ตารางเวรประจำสัปดาห์
          </h2>
          <div className="flex items-center gap-1 flex-shrink-0">
            {onRandomize && (
              <button
                onClick={onRandomize}
                className="btn-secondary px-2.5 py-1.5 text-xs flex items-center gap-1.5 text-amber-300 hover:text-amber-200 border-amber-500/40"
                title="สุ่มตารางเวรทั้งสัปดาห์ — บังคับให้มีผู้นำทุกกะและตัดคนที่ลาออก"
              >
                <Shuffle size={14} />
                สุ่มเวร
              </button>
            )}
            <button
              onClick={onPrev}
              className="btn-secondary w-8 h-8 p-0 flex items-center justify-center"
              aria-label="สัปดาห์ก่อนหน้า"
              title="สัปดาห์ก่อนหน้า"
            >
              <ChevronLeft size={15} />
            </button>
            <button
              onClick={onToday}
              disabled={isCurrentWeek}
              className="btn-secondary px-2.5 py-1.5 text-xs disabled:opacity-35 disabled:cursor-not-allowed"
              title={isCurrentWeek ? 'อยู่ที่สัปดาห์ปัจจุบันอยู่แล้ว' : 'กลับสู่สัปดาห์ปัจจุบัน'}
            >
              กลับสู่วันนี้
            </button>
            <button
              onClick={onNext}
              className="btn-secondary w-8 h-8 p-0 flex items-center justify-center"
              aria-label="สัปดาห์ถัดไป"
              title="สัปดาห์ถัดไป"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/40 text-xs font-bold font-mono">
            {weekLabel}
          </span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
            isCurrentWeek
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
              : 'bg-blue-500/15 text-blue-300 border-blue-500/40'
          }`}>
            {weekOffsetLabel}
          </span>
          <span className="text-[11px] text-gray-500">
            เซิร์ฟเวอร์ · จ–ศ {serverHoursFor(1).start}–{serverHoursFor(1).end}
            {' · '}ส–อ {serverHoursFor(6).start}–{serverHoursFor(6).end}
          </span>
        </div>
      </div>

      {/* สถิติกระชับ 2 กล่อง */}
      <div className="grid grid-cols-2 gap-3">
        <StatBox label="จัดคนแล้ว (ช่อง)" value={roster.assignedCount} tone="emerald" />
        <StatBox label="ยังขาดคน (กะ)" value={shortSlots} tone={shortSlots > 0 ? 'amber' : 'emerald'} />
      </div>

      <div className="table-panel">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px]">
            <thead className="table-header-gold">
              <tr>
                <th className="w-20 text-left">กะ</th>
                {roster.days.map((d) => (
                  <th
                    key={d.date}
                    className={`text-center ${d.isToday ? 'text-amber-300' : ''} ${
                      isWeekend(d.weekday) ? 'bg-blue-500/[0.06]' : ''
                    }`}
                    title={dayTypeLabel(d.weekday)}
                  >
                    {d.label} {d.dayOfMonth}
                    {d.isToday && <span className="block text-[9px]">วันนี้</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SHIFT_ORDER.map((shift) => (
                <tr key={shift}>
                  <td className="px-3 py-3 align-middle">
                    <span className="text-xs font-semibold text-white whitespace-nowrap">
                      {SHIFT_LABELS[shift]}
                    </span>
                  </td>
                  {roster.days.map((d) => {
                    const cell = roster.rows[shift]?.[d.date];
                    if (!cell) return <td key={d.date} className="px-1.5 py-1.5" />;
                    const empty = cell.members.length === 0;

                    return (
                      <td key={d.date} className={`p-1 ${isWeekend(d.weekday) ? 'bg-blue-500/[0.04]' : ''}`}>
                        <button
                          type="button"
                          onClick={canEdit ? () => onEditCell({ date: d.date, shift }) : undefined}
                          disabled={!canEdit}
                          title={canEdit ? `จัดกำลังพล ${SHIFT_LABELS[shift]} วันที่ ${d.date}` : undefined}
                          className={`w-full rounded-lg border px-1.5 py-2 flex flex-col gap-1.5 text-left transition-all ${
                            empty
                              ? 'border-dashed border-blue-900/60 bg-transparent hover:border-amber-500/50'
                              : 'border-transparent bg-navy-700/40 hover:border-amber-500/40'
                          } ${d.isToday ? 'ring-1 ring-amber-500/40' : ''} ${
                            canEdit ? 'cursor-pointer' : 'cursor-default'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="text-[9px] font-mono text-gray-500">
                              {cell.startTime}–{cell.endTime}
                            </span>
                            <span className="text-[9px] font-mono text-gray-500">
                              {cell.members.length}/{cell.required}
                            </span>
                          </div>

                          {empty ? (
                            <span className="flex items-center justify-center gap-1 py-1.5 text-[10px] text-gray-600">
                              <Plus size={10} /> เพิ่ม
                            </span>
                          ) : (
                            <div className="flex flex-col gap-0.5">
                              {cell.members.map((m) => (
                                <div key={m.officerId} className="flex items-center gap-1">
                                  <RankGlyph rank={rankById.get(m.officerId)} />
                                  <span className="text-[10px] text-gray-200 truncate flex-1 leading-tight">
                                    {m.officerName}
                                  </span>
                                  {m.badge && (
                                    <span className="text-[8px] px-1 py-px rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold flex-shrink-0">
                                      {m.badge}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-gray-600 text-center">
        {canEdit ? 'คลิกที่ช่องกะเพื่อจัดกำลังพล / สลับเวร / แก้ไขข้อมูล' : 'ดูโหมดอ่านอย่างเดียว'}
      </p>
    </div>
  );
}

/** ไอคอนยศเล็ก ๆ กำกับหน้าชื่อในช่องกะ */
function RankGlyph({ rank }: { rank?: string }) {
  if (rank === 'commissioner') return <Crown size={9} className="text-amber-400 flex-shrink-0" />;
  if (rank === 'inspector') return <Briefcase size={9} className="text-blue-400 flex-shrink-0" />;
  return <User size={9} className="text-emerald-500/80 flex-shrink-0" />;
}

function ShiftStaffingModal({
  date, shift, cell, baseOfficerIds, existingOverrides, officers, onClose,
  onSaveBase, onSaveOverride, onClearOverride, onSwapWeek, onClearWeek, weekDays,
  saveFlash,
}: {
  date: string;
  shift: ShiftCode;
  cell: ReturnType<typeof buildWeeklyRoster>['rows'][ScheduleCellCode][string];
  baseOfficerIds: string[];
  existingOverrides: ScheduleOverride[];
  officers: Officer[];
  onClose: () => void;
  onSaveBase: (p: { weekday: number; shift: ShiftCode; officerIds: string[]; required: number }) => Promise<boolean>;
  onSaveOverride: (p: {
    date: string; shift: ScheduleCellCode;
    entries: Array<{ officerId: string | null; type: ScheduleOverride['override_type'] }>;
  }) => Promise<boolean>;
  onClearOverride: (date: string, shift: ScheduleCellCode) => void;
  onSwapWeek: (shift: ShiftCode, toOfficerId: string) => Promise<boolean>;
  onClearWeek: (shift: ScheduleCellCode) => Promise<boolean>;
  weekDays: string[];
  saveFlash: { kind: 'ok' | 'err'; text: string } | null;
}) {
  const [tab, setTab] = useState<'roster' | 'swap' | 'exception'>('roster');
  const [busy, setBusy] = useState(false);

  // ---------- แท็บ 1: ผังประจำ ----------
  const [baseIds, setBaseIds] = useState<string[]>(baseOfficerIds);
  const [required, setRequired] = useState(cell.required || DEFAULT_REQUIRED_OFFICERS);

  // ---------- แท็บ 2: สลับเวรทั้งสัปดาห์ ----------
  const [swapId, setSwapId] = useState('');

  // ---------- แท็บ 3: ข้อยกเว้น ----------
  const initial = existingOverrides[0];
  const [closed, setClosed] = useState(
    existingOverrides.some((o) => !o.officer_id && o.override_type === 'off'),
  );
  const [ovType, setOvType] = useState<ScheduleOverride['override_type']>(
    initial?.override_type && initial.override_type !== 'off' ? initial.override_type : 'leave',
  );
  const [ovIds, setOvIds] = useState<string[]>(
    existingOverrides.filter((o) => o.officer_id && o.override_type !== 'off').map((o) => o.officer_id!),
  );

  const weekday = new Date(`${date}T00:00:00`).getDay();
  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString('th-TH', {
    weekday: 'long', day: 'numeric', month: 'short',
  });
  const win = shiftWindowFor(weekday, shift);
  const allIds = officers.map((o) => o.id);

  const toggleIn = (list: string[], id: string, set: (v: string[]) => void) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  /** บันทึกสำเร็จ → ปิด modal (รีเฟรชตารางทำงานใน handler ให้แล้ว) */
  async function run(fn: () => Promise<boolean>) {
    setBusy(true);
    const ok = await fn();
    setBusy(false);
    if (ok) setTimeout(onClose, 550);
  }

  const tabs = [
    { id: 'roster' as const, label: 'จัดผังประจำ' },
    { id: 'swap' as const, label: 'สลับเวรทั้งสัปดาห์' },
    { id: 'exception' as const, label: 'ข้อยกเว้น / แจ้งลา' },
  ];

  return (
    <Modal
      title={`${SHIFT_LABELS[shift]} · ${dateLabel}`}
      onClose={onClose}
      size="lg"
    >
      <div className="space-y-4">
        {/* แถบสรุป */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="px-2 py-1 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/30 font-mono">
            {dayTypeLabel(weekday)} · {win.start}–{win.end}
          </span>
          <span className="text-gray-500">กำลังพล {cell.members.length}/{cell.required}</span>
          {cell.fromOverride && (
            <span className="px-2 py-1 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/30">
              มีข้อยกเว้นของวันนี้
            </span>
          )}
        </div>

        {/* แท็บ */}
        <div className="flex gap-1 p-1 bg-navy-900/60 border border-blue-900/40 rounded-lg">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                tab === t.id
                  ? 'bg-gradient-to-b from-amber-300 to-amber-500 text-navy-900'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ผลลัพธ์การบันทึก */}
        {saveFlash && (
          <div className={`text-[11px] px-3 py-2 rounded-lg border flex items-center gap-1.5 ${
            saveFlash.kind === 'ok'
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
              : 'bg-red-500/10 text-red-300 border-red-500/30'
          }`}>
            {saveFlash.kind === 'ok' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
            {saveFlash.text}
          </div>
        )}

        {/* ============ แท็บ 1: จัดผังประจำ ============ */}
        {tab === 'roster' && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 text-xs text-gray-400">
                ต้องการ
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={required}
                  onChange={(e) => setRequired(Math.max(1, parseInt(e.target.value) || 1))}
                  className="input-field !w-16 !py-1 !px-2 text-center"
                />
                คน/กะ
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-500">เลือกแล้ว {baseIds.length} คน</span>
                <button
                  onClick={() => setBaseIds(baseIds.length === allIds.length ? [] : allIds)}
                  className="text-[10px] text-amber-400 hover:text-amber-300"
                >
                  {baseIds.length === allIds.length ? 'ล้างทั้งหมด' : 'เลือกทั้งหมด'}
                </button>
              </div>
            </div>
            <OfficerPickerGrid
              officers={officers}
              selected={baseIds}
              onToggle={(id) => toggleIn(baseIds, id, setBaseIds)}
            />
            <button
              onClick={() => run(() => onSaveBase({ weekday, shift, officerIds: baseIds, required }))}
              disabled={busy}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              บันทึกผังประจำ
            </button>
          </div>
        )}

        {/* ============ แท็บ 2: สลับเวรทั้งสัปดาห์ ============ */}
        {tab === 'swap' && (
          <div className="space-y-3">
            <p className="text-[11px] text-gray-400 leading-relaxed">
              เลือกเจ้าหน้าที่ที่จะมารับผิดชอบ <strong className="text-white">{SHIFT_LABELS[shift]}</strong> แทนทั้งสัปดาห์
              ({weekDays.length} วัน) — ทุกช่องกะจะขึ้นป้าย &quot;เวรสลับ&quot;
              และไม่กระทบผังประจำที่ตั้งไว้ในแท็บ &quot;จัดผังประจำ&quot;
            </p>
            <select
              className="input-field text-xs"
              value={swapId}
              onChange={(e) => setSwapId(e.target.value)}
            >
              <option value="">— เลือกเจ้าหน้าที่ —</option>
              {officers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <button
              onClick={() => swapId && run(() => onSwapWeek(shift, swapId))}
              disabled={busy || !swapId}
              className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Repeat size={15} />}
              บันทึกการสลับเวร
            </button>
            <button
              onClick={() => run(() => onClearWeek(shift))}
              disabled={busy}
              className="btn-secondary w-full text-xs disabled:opacity-50"
            >
              ล้างการสลับเวรทั้งสัปดาห์นี้
            </button>
          </div>
        )}

        {/* ============ แท็บ 3: ข้อยกเว้น / แจ้งลา ============ */}
        {tab === 'exception' && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={closed}
                onChange={(e) => setClosed(e.target.checked)}
                className="w-4 h-4 accent-amber-500"
              />
              <span className="text-xs text-gray-300">ปิดเวรทั้งช่องของวันนี้</span>
            </label>

            {!closed && (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(OVERRIDE_TYPE_LABELS) as ScheduleOverride['override_type'][])
                    .filter((t) => t !== 'off')
                    .map((t) => (
                      <button
                        key={t}
                        onClick={() => { setOvType(t); setOvIds([]); }}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                          ovType === t
                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/50'
                            : 'bg-navy-800 text-gray-400 border-blue-900/60 hover:text-white'
                        }`}
                      >
                        {OVERRIDE_TYPE_LABELS[t]}
                      </button>
                    ))}
                </div>
                <p className="text-[10px] text-gray-500">
                  เลือกเจ้าหน้าที่ที่
                  {ovType === 'leave' ? 'ลา' : ovType === 'swap' ? 'เข้าเวรแทนผังประจำ' : 'เข้าเวรเพิ่ม'}
                  ในวันนี้
                </p>
                <OfficerPickerGrid
                  officers={officers}
                  selected={ovIds}
                  onToggle={(id) => toggleIn(ovIds, id, setOvIds)}
                />
              </>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => run(() => onSaveOverride({
                  date,
                  shift,
                  entries: closed
                    ? [{ officerId: null, type: 'off' }]
                    : ovIds.map((id) => ({ officerId: id, type: ovType })),
                }))}
                disabled={busy || (!closed && ovIds.length === 0)}
                className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                บันทึกข้อยกเว้น
              </button>
              <button
                onClick={() => run(() => onSaveOverride({ date, shift, entries: [] }))}
                disabled={busy || !cell.fromOverride}
                className="btn-secondary px-3 disabled:opacity-40"
                title="ล้างข้อยกเว้นของวันนี้ทั้งหมด"
              >
                <Trash2 size={15} />
              </button>
              <button
                onClick={onClose}
                disabled={busy}
                className="btn-secondary px-4 py-2 disabled:opacity-40"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** ตารางเลือกเจ้าหน้าที่แบบ checkbox */
function OfficerPickerGrid({
  officers, selected, onToggle,
}: {
  officers: Officer[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5 max-h-60 overflow-y-auto scrollbar-thin">
      {officers.map((o) => {
        const active = selected.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onToggle(o.id)}
            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-left transition-all ${
              active
                ? 'bg-amber-500/10 border-amber-500/50 text-amber-200'
                : 'bg-navy-800/60 border-blue-900/50 text-gray-400 hover:border-amber-500/30 hover:text-white'
            }`}
          >
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 overflow-hidden ${
              active ? 'bg-amber-500 text-navy-900' : 'bg-navy-700 text-gray-400'
            }`}>
              {o.photo_url
                ? <img src={o.photo_url} alt="" className="w-full h-full object-cover" />
                : o.name.charAt(0).toUpperCase()}
            </span>
            <span className="text-[11px] truncate flex-1">{o.name}</span>
            {active && <CheckCircle2 size={12} className="flex-shrink-0" />}
          </button>
        );
      })}
      {officers.length === 0 && (
        <p className="col-span-full text-xs text-gray-500 text-center py-4">ยังไม่มีเจ้าหน้าที่ในระบบ</p>
      )}
    </div>
  );
}

function monthLabelOf(iso: string): string {
  const m = Number(iso.slice(5, 7)) - 1;
  const names = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${names[m] ?? ''} ${iso.slice(0, 4)}`;
}

function formatShortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' });
}

/** ฟอร์แมตเวลาแบบย่อ (ใช้ใน subcomponent ที่อยู่นอกขอบเขตของ OperationsPage) */
function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('th-TH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getDutyCategoryLabel(value: string | null | undefined): string {
  const map: Record<string, string> = {
    patrol: 'ลาดตระเวน',
    incident: 'รับแจ้งเหตุ',
    ticket: 'ออกใบสั่ง',
    traffic: 'จัดการจราจร',
    rescue: 'ช่วยเหลือ/กู้ภัย',
    other: 'อื่นๆ',
  };
  return value ? (map[value] ?? value) : '-';
}

function getCaseStatusLabel(value: string | null | undefined): string {
  const map: Record<string, string> = {
    completed: 'เสร็จสิ้น',
    in_progress: 'กำลังดำเนินการ',
    transferred: 'ส่งต่อ',
  };
  return value ? (map[value] ?? value) : '-';
}

/* ---------- Modal: สุ่มเวรอัตโนมัติ ---------- */
function RandomizeRosterModal({
  open, onClose, officers, ranks, preview, requireLeader, onToggleRequireLeader,
  onRandomize, onSave, busy,
}: {
  open: boolean;
  onClose: () => void;
  officers: Officer[];
  ranks: OfficerRankRecord[];
  preview: RandomizeResult | null;
  requireLeader: boolean;
  onToggleRequireLeader: () => void;
  onRandomize: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  if (!open) return null;
  const byId = new Map(officers.map((o) => [o.id, o]));

  return (
    <Modal onClose={onClose} title="สุ่มเวรประจำสัปดาห์" size="xl">
      <div className="space-y-3">
        {/* กติกา */}
        <div className="text-[11px] text-gray-400 bg-navy-900/50 border border-blue-900/40 rounded-lg p-3 space-y-1.5">
          <div className="font-semibold text-gray-300">กติกาที่ระบบบังคับให้อัตโนมัติ</div>
          <div className="flex items-start gap-1.5"><CheckCircle2 size={12} className="text-emerald-400 mt-0.5 flex-shrink-0" />
            <span>ทุกช่องกะต้องมี <strong className="text-gray-200">ผู้นำอย่างน้อย 1 คน</strong> (หัวหน้า / รอง / ผู้คุม)</span></div>
          <div className="flex items-start gap-1.5"><CheckCircle2 size={12} className="text-emerald-400 mt-0.5 flex-shrink-0" />
            <span>เติมกำลังพลให้ครบโควตาของแต่ละกะ</span></div>
          <div className="flex items-start gap-1.5"><CheckCircle2 size={12} className="text-emerald-400 mt-0.5 flex-shrink-0" />
            <span>ตัดเจ้าหน้าที่ที่<strong className="text-gray-200">ลาอยู่ในวันนั้น</strong>ออกอัตโนมัติ</span></div>
          <div className="flex items-start gap-1.5"><CheckCircle2 size={12} className="text-emerald-400 mt-0.5 flex-shrink-0" />
            <span>หนึ่งคนทำได้ไม่เกิน 1 กะต่อวัน และแจกแจงให้ใครมีภาระน้อยกว่าได้ก่อน</span></div>
        </div>

        {/* ตัวเลือก */}
        <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={requireLeader}
            onChange={onToggleRequireLeader}
            className="accent-amber-500 w-4 h-4"
          />
          บังคับให้มีผู้นำทุกกะ
          <span className="text-[10px] text-gray-500">(ปิดไว้ = สุ่มตามโควตาอย่างเดียว)</span>
        </label>

        {/* ผลลัพธ์ */}
        {preview ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 font-semibold">
                มีผู้นำ {preview.slotsWithLeader}/{preview.totalSlots} กะ
              </span>
              <span className={`px-2 py-0.5 rounded-full border font-semibold ${
                preview.slotsUnderfilled > 0
                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                  : 'bg-blue-500/15 text-blue-300 border-blue-500/40'
              }`}>
                ไม่ครบโควตา {preview.slotsUnderfilled} กะ
              </span>
              <span className="px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/40 font-semibold">
                ใช้เจ้าหน้าที่ {preview.officersUsed} คน
              </span>
            </div>

            {preview.notes.map((n, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1.5">
                <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />{n}
              </div>
            ))}

            <div className="max-h-72 overflow-y-auto rounded-lg border border-blue-900/40">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-navy-800 text-gray-400">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-semibold">วัน</th>
                    <th className="text-left px-2 py-1.5 font-semibold">กะ</th>
                    <th className="text-left px-2 py-1.5 font-semibold">เจ้าหน้าที่</th>
                    <th className="text-center px-2 py-1.5 font-semibold">ผู้นำ</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.cells.map((c) => (
                    <tr key={`${c.date}-${c.shift}`} className="border-t border-blue-900/25">
                      <td className="px-2 py-1.5 text-gray-300 whitespace-nowrap font-mono">
                        {new Date(`${c.date}T00:00:00`).getDate()}
                      </td>
                      <td className="px-2 py-1.5 text-gray-400 whitespace-nowrap">{c.shiftLabel}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {c.officerIds.length === 0 && <span className="text-gray-600">— ว่าง —</span>}
                          {c.officerIds.map((id) => {
                            const o = byId.get(id);
                            if (!o) return null;
                            const lead = isLeader(o, ranks);
                            return (
                              <span
                                key={id}
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] ${
                                  lead
                                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 font-semibold'
                                    : 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                                }`}
                                title={lead ? `ผู้นำ · ${leaderLabel(o, ranks)}` : leaderLabel(o, ranks)}
                              >
                                {lead && <Crown size={9} />}
                                {o.name}
                              </span>
                            );
                          })}
                        </div>
                        {c.issues.map((msg, i) => (
                          <div key={i} className="text-[10px] text-amber-400/90 mt-0.5">{msg}</div>
                        ))}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {c.hasLeader
                          ? <CheckCircle2 size={13} className="text-emerald-400 inline" />
                          : <XCircle size={13} className="text-red-400 inline" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-[10px] text-amber-400/90 leading-relaxed">
              ⚠ การบันทึกจะเขียนทับ<strong className="text-amber-300">ผังประจำสัปดาห์ (duty_schedules)</strong> ซึ่งใช้ซ้ำทุกสัปดาห์
              ไม่ใช่แค่สัปดาห์ที่เลือกอยู่
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-gray-500 text-center py-4">
            กดปุ่ม "สุ่ม" เพื่อดูตัวอย่างก่อนบันทึกลงตาราง
          </p>
        )}

        {/* ปุ่ม */}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={onRandomize}
            disabled={busy}
            className="btn-secondary flex items-center gap-1.5 text-xs"
          >
            <Shuffle size={13} className={busy ? 'animate-spin' : ''} />
            {preview ? 'สุ่มใหม่' : 'สุ่ม'}
          </button>
          <button
            onClick={onSave}
            disabled={busy || !preview}
            className="btn-primary flex items-center gap-1.5 text-xs flex-1 disabled:opacity-40"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            ยืนยันบันทึกลงตาราง
          </button>
          <button onClick={onClose} disabled={busy} className="btn-secondary text-xs">
            ยกเลิก
          </button>
        </div>
      </div>
    </Modal>
  );
}