import { useEffect, useMemo, useState } from 'react';
import {
  Clock, LogIn, LogOut, Users, Trash2, Power, AlertCircle, Image as ImageIcon, Shield,
  BarChart3, Zap, Download, Search, Filter, FileText,
  Plus, X, Upload, Loader2, ExternalLink,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Citizen, DutyLog, Officer, SystemSettings, WorkReport, WorkReportCase, DEPARTMENT_LABELS } from '../../lib/types';
import { useAuth } from '../../lib/AuthContext';
import { Badge } from '../../components/Badge';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { IdCard } from '../../components/IdCard';
import { PageHeader } from '../../components/PageHeader';
import type { RankItem } from '../../components/RankedList';
import { BatchDutyRateModal } from '../../components/BatchDutyRateModal';
import { uploadImage } from '../../lib/storage';

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

export function OperationsPage() {
  const { officer, setAuth, isCommissioner } = useAuth();
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
  const [sortCount, setSortCount] = useState<'desc' | 'asc'>('desc');
  const [sortHours, setSortHours] = useState<'desc' | 'asc'>('desc');
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

  useEffect(() => {
    fetchData();
    if (!isCommissioner) return;
    fetchAllLogs();
    const statsCh = supabase.channel('duty_logs_rt_stats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'duty_logs' }, () => fetchAllLogs())
      .subscribe();
    const reportsCh = supabase.channel('work_reports_rt_ops')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_reports' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(statsCh); supabase.removeChannel(reportsCh); };
  }, [officer?.id]);

  async function fetchAllLogs() {
    const { data } = await supabase.from('duty_logs').select('*').is('deleted_at', null);
    setAllLogs(data ?? []);
  }

  const dutyStatsByCount = useMemo<RankItem[]>(() => {
    const map = new Map<string, { name: string; count: number }>();
    for (const log of allLogs) {
      if (!log.officer_id) continue;
      const cur = map.get(log.officer_id) ?? { name: log.officer_name || 'ไม่ทราบชื่อ', count: 0 };
      cur.count += 1;
      map.set(log.officer_id, cur);
    }
    return [...map.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([oid, v]) => ({ id: oid, primary: v.name, value: `${v.count} เวร` }));
  }, [allLogs]);

  const dutyStatsByHours = useMemo<RankItem[]>(() => {
    const map = new Map<string, { name: string; minutes: number }>();
    for (const log of allLogs) {
      if (!log.officer_id || log.duration_minutes == null) continue;
      const cur = map.get(log.officer_id) ?? { name: log.officer_name || 'ไม่ทราบชื่อ', minutes: 0 };
      cur.minutes += log.duration_minutes;
      map.set(log.officer_id, cur);
    }
    return [...map.entries()]
      .sort((a, b) => b[1].minutes - a[1].minutes)
      .map(([oid, v]) => {
        const h = Math.floor(v.minutes / 60);
        const m = v.minutes % 60;
        return { id: oid, primary: v.name, value: h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที` };
      });
  }, [allLogs]);

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
        await supabase.from('duty_logs').update({
          clock_out: workReportTarget.clockOut,
          duration_minutes: workReportTarget.durationMinutes,
          checkout_method: 'self',
        }).eq('id', workReportTarget.log.id);
        await supabase.from('officers').update({ is_on_duty: false, updated_at: new Date().toISOString() }).eq('id', officer.id);
        setAuth({ ...officer, is_on_duty: false });
      }
      closeReportEditor();
      await fetchData();
      if (isCommissioner) await fetchAllLogs();
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
    const reportsQuery = isCommissioner
      ? supabase.from('work_reports').select('*').order('created_at', { ascending: false })
      : supabase.from('work_reports').select('*').eq('officer_id', officer?.id).order('created_at', { ascending: false });
    const [duty, logs, settingsRes, reportsRes, citizensRes, casesRes] = await Promise.all([
      supabase.from('officers').select('*').eq('is_on_duty', true).eq('status', 'active').order('name'),
      isCommissioner
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

  async function toggleDutySystem() {
    if (!officer || !settings) return;
    const newValue = !settings.duty_system_enabled;
    setSettings({ ...settings, duty_system_enabled: newValue });
    await supabase.from('system_settings').update({
      duty_system_enabled: newValue,
      updated_at: new Date().toISOString(),
      updated_by: officer.id,
      updated_by_name: officer.name,
    }).eq('id', 1);
    await supabase.from('audit_logs').insert({
      action: newValue ? 'ENABLE_DUTY_SYSTEM' : 'DISABLE_DUTY_SYSTEM',
      target_type: 'system',
      performed_by: officer.id,
      performed_by_name: officer.name,
      details: {},
    });
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
      if (isCommissioner) await fetchAllLogs();
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
    if (isCommissioner) await fetchAllLogs();
    setClockLoading(false);
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
    if (isCommissioner) await fetchAllLogs();
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
    if (isCommissioner) await fetchAllLogs();
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

  return (
    <div>
      <PageHeader
        icon={<Shield size={26} />}
        title="ปฏิบัติการ"
        subtitle="จัดการการเข้า-ออกเวรและสถานะการปฏิบัติหน้าที่"
        actions={
          <div className="flex items-center gap-2">
            {isCommissioner && (
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

      {/* Commissioner Duty System Toggle — prominent */}
      {isCommissioner && (
        <div className={`card p-5 mb-6 border-2 ${dutyEnabled ? 'border-emerald-500/30' : 'border-red-500/30'}`}>
          <span className="ph-corner ph-corner-tl" aria-hidden />
          <span className="ph-corner ph-corner-br" aria-hidden />
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
                dutyEnabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
              }`}>
                <Power size={22} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">ระบบเข้าเวร</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {dutyEnabled ? 'เปิดใช้งาน — เจ้าหน้าที่สามารถลงชื่อเข้าเวรได้' : 'ปิดชั่วคราว — เจ้าหน้าที่ไม่สามารถเข้าเวรได้'}
                </p>
              </div>
            </div>
            <button
              onClick={toggleDutySystem}
              className={`relative w-16 h-8 rounded-full transition-colors flex-shrink-0 ${dutyEnabled ? 'bg-emerald-500' : 'bg-red-500'}`}
            >
              <div className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-lg transition-transform ${dutyEnabled ? 'translate-x-8' : ''}`} />
            </button>
          </div>
        </div>
      )}

      {/* Duty Statistics (commissioner only) */}
      {isCommissioner && (
        <div className="card overflow-hidden mb-6">
          <div className="ph-panel-head flex items-center gap-2">
            <span className="ph-corner ph-corner-tl" aria-hidden />
            <span className="ph-corner ph-corner-br" aria-hidden />
            <BarChart3 size={15} className="text-amber-400" />
            <h2 className="text-xs font-bold text-white tracking-wide">สถิติการปฏิบัติหน้าที่ — รวมทั้งกรม</h2>
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Duty Count Card */}
            <div className="card overflow-hidden flex flex-col">
              <div className="ph-panel-head flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="ph-corner ph-corner-tl" aria-hidden />
                  <span className="ph-corner ph-corner-br" aria-hidden />
                  <Clock size={13} className="text-amber-400" />
                  <h3 className="text-xs font-bold text-white tracking-wide">เข้าเวรบ่อยที่สุด</h3>
                </span>
                <div className="gold-toggle">
                  <button className={sortCount === 'desc' ? 'active' : ''} onClick={(e) => { e.stopPropagation(); setSortCount('desc'); }}>มาก→น้อย</button>
                  <button className={sortCount === 'asc' ? 'active' : ''} onClick={(e) => { e.stopPropagation(); setSortCount('asc'); }}>น้อย→มาก</button>
                </div>
              </div>
              <div className="flex-1 p-2 space-y-1.5 min-h-[180px]">
                {dutyStatsByCount.length === 0 ? (
                  <p className="text-gray-500 text-xs text-center py-8">ยังไม่มีประวัติการเข้าเวร</p>
                ) : (sortCount === 'desc' ? dutyStatsByCount : [...dutyStatsByCount].reverse()).map((item, idx) => (
                  <div key={item.id} className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors">
                    <span className={`w-6 h-6 rounded-md border flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${idx === 0 ? 'bg-amber-500/20 text-amber-300 border-amber-500/50' : idx === 1 ? 'bg-slate-400/15 text-slate-300 border-slate-400/40' : idx === 2 ? 'bg-orange-700/20 text-orange-300 border-orange-600/40' : 'bg-navy-700/60 text-gray-500 border-blue-900/40'}`}>{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-xs font-medium truncate">{item.primary}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-white text-xs font-semibold whitespace-nowrap">{item.value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Duty Hours Card */}
            <div className="card overflow-hidden flex flex-col">
              <div className="ph-panel-head flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="ph-corner ph-corner-tl" aria-hidden />
                  <span className="ph-corner ph-corner-br" aria-hidden />
                  <Zap size={13} className="text-amber-400" />
                  <h3 className="text-xs font-bold text-white tracking-wide">ชั่วโมงสะสมมากที่สุด</h3>
                </span>
                <div className="gold-toggle">
                  <button className={sortHours === 'desc' ? 'active' : ''} onClick={(e) => { e.stopPropagation(); setSortHours('desc'); }}>มาก→น้อย</button>
                  <button className={sortHours === 'asc' ? 'active' : ''} onClick={(e) => { e.stopPropagation(); setSortHours('asc'); }}>น้อย→มาก</button>
                </div>
              </div>
              <div className="flex-1 p-2 space-y-1.5 min-h-[180px]">
                {dutyStatsByHours.length === 0 ? (
                  <p className="text-gray-500 text-xs text-center py-8">ยังไม่มีประวัติการเข้าเวร</p>
                ) : (sortHours === 'desc' ? dutyStatsByHours : [...dutyStatsByHours].reverse()).map((item, idx) => (
                  <div key={item.id} className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors">
                    <span className={`w-6 h-6 rounded-md border flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${idx === 0 ? 'bg-amber-500/20 text-amber-300 border-amber-500/50' : idx === 1 ? 'bg-slate-400/15 text-slate-300 border-slate-400/40' : idx === 2 ? 'bg-orange-700/20 text-orange-300 border-orange-600/40' : 'bg-navy-700/60 text-gray-500 border-blue-900/40'}`}>{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-xs font-medium truncate">{item.primary}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-white text-xs font-semibold whitespace-nowrap">{item.value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
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
            <div className="px-5 py-4 border-b border-amber-500/15 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white">
                  {isCommissioner ? 'ประวัติการปฏิบัติหน้าที่ทั้งหมด' : 'ประวัติของฉัน'}
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  {filteredDutyLogs.length} รายการ
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  {reportCaseStats.reports} ฉบับ · {reportCaseStats.cases} เคส
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/15 text-blue-300 border border-blue-500/30">
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
                      {isCommissioner && <th className="px-4 py-3" />}
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
                          {isCommissioner && (
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

      {viewReport && (
        <Modal title={`รายงานของ ${viewReport.officer_name}`} onClose={() => { setViewReport(null); setViewReportCases([]); }} size="xl">
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-navy-900/50 border border-blue-900/40 rounded-lg p-3">
                <div className="text-[10px] text-gray-500 mb-1">วันที่ส่งรายงาน</div>
                <div className="text-xs text-gray-300">{formatTime(viewReport.created_at)}</div>
              </div>
              <div className="bg-navy-900/50 border border-blue-900/40 rounded-lg p-3">
                <div className="text-[10px] text-gray-500 mb-1">หมวดงาน</div>
                <div className="text-sm text-white">{getDutyCategoryLabel(viewReport.duty_category)}</div>
              </div>
              <div className="bg-navy-900/50 border border-blue-900/40 rounded-lg p-3">
                <div className="text-[10px] text-gray-500 mb-1">จำนวนเคส</div>
                <div className="text-sm font-semibold text-amber-300">{viewReportCases.length.toLocaleString('th-TH')} เคส</div>
              </div>
            </div>

            {(viewReport.summary || viewReport.report_text) && (
              <div className="bg-navy-900/50 p-3 rounded-lg border border-blue-900/40">
                <div className="text-xs text-gray-500 mb-1">รายละเอียดภาพรวม</div>
                <div className="text-sm text-gray-200 whitespace-pre-wrap">{viewReport.summary || viewReport.report_text}</div>
              </div>
            )}

            <div className="space-y-3">
              {viewReportCases.length === 0 ? (
                <p className="text-gray-500 text-sm">ไม่มีเคสในรายงานนี้</p>
              ) : viewReportCases.map((item, idx) => (
                <div key={item.id} className="bg-navy-900/50 p-4 rounded-lg border border-blue-900/40 space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="text-xs font-bold text-amber-400">เคส #{idx + 1}</div>
                      <div className="text-white text-sm font-semibold mt-0.5">{item.case_name || item.case_type || 'ไม่ระบุชื่อเคส'}</div>
                    </div>
                    <Badge variant={item.case_status === 'completed' ? 'success' : item.case_status === 'transferred' ? 'warning' : 'neutral'}>
                      {getCaseStatusLabel(item.case_status)}
                    </Badge>
                  </div>

                  {item.citizen_username && (
                    <button
                      type="button"
                      onClick={() => openCitizenProfileFromCase(item)}
                      className="inline-flex items-center gap-1.5 text-xs text-blue-300 bg-blue-500/10 border border-blue-500/20 rounded-lg px-2.5 py-1 hover:bg-blue-500/20 transition-colors"
                    >
                      <ExternalLink size={12} />
                      ประชาชนที่เกี่ยวข้อง: {item.citizen_username}
                    </button>
                  )}

                  {item.details && <p className="text-sm text-gray-200 whitespace-pre-wrap">{item.details}</p>}
                  {item.evidence_url && (
                    <button type="button" onClick={() => setViewEvidenceUrl(item.evidence_url!)} className="block group">
                      <img src={item.evidence_url} alt="ภาพหลักฐาน" className="max-h-48 max-w-full rounded-lg border border-blue-900/50 object-contain bg-navy-900 group-hover:opacity-90 transition-opacity" />
                      <span className="block text-[11px] text-emerald-400 group-hover:underline mt-1">คลิกเพื่อดูภาพขนาดเต็ม</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <button onClick={() => { setViewReport(null); setViewReportCases([]); }} className="btn-secondary">ปิด</button>
          </div>
        </Modal>
      )}

      {viewEvidenceUrl && (
        <Modal title="รูปภาพหลักฐาน" onClose={() => setViewEvidenceUrl(null)} size="lg">
          <div className="flex justify-center">
            <img src={viewEvidenceUrl} alt="ภาพหลักฐาน" className="max-w-full max-h-[70vh] rounded-lg object-contain" />
          </div>
        </Modal>
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
            if (isCommissioner) await fetchAllLogs();
          }}
        />
      )}
    </div>
  );
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
