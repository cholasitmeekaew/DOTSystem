import { useEffect, useMemo, useState } from 'react';
import {
  Clock, LogIn, LogOut, Users, Trash2, Power, AlertCircle, Image as ImageIcon, Shield,
  BarChart3, Zap, FileText, PenLine, Upload, Loader2, X, Check,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { DutyLog, Officer, SystemSettings, DEPARTMENT_LABELS, WorkReport, WorkReportCase } from '../../lib/types';
import { useAuth } from '../../lib/AuthContext';
import { Badge } from '../../components/Badge';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { IdCard } from '../../components/IdCard';
import { PageHeader } from '../../components/PageHeader';
import { RankedList, type RankItem } from '../../components/RankedList';

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
  // Work reports
  const [workReports, setWorkReports] = useState<WorkReport[]>([]);
  const [workReportTarget, setWorkReportTarget] = useState<{ dutyLogId: string | null } | null>(null);
  const [workReportSummary, setWorkReportSummary] = useState('');
  const [workReportCases, setWorkReportCases] = useState<Array<{ case_type: string; details: string; evidence_url: string }>>([]);
  const [workReportLoading, setWorkReportLoading] = useState(false);
  const [uploadingCaseIndex, setUploadingCaseIndex] = useState<number | null>(null);
  const [viewReport, setViewReport] = useState<WorkReport | null>(null);
  const [viewReportCases, setViewReportCases] = useState<WorkReportCase[]>([]);
  const [reportFilter, setReportFilter] = useState<'all' | 'with_report' | 'no_report'>('all');
  const [showBatchDutyModal, setShowBatchDutyModal] = useState(false);

  useEffect(() => {
    fetchData();
    fetchWorkReports();
    if (!isCommissioner) return;
    fetchAllLogs();
    const statsCh = supabase.channel('duty_logs_rt_stats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'duty_logs' }, () => fetchAllLogs())
      .subscribe();
    const wrCh = supabase.channel('work_reports_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_reports' }, () => fetchWorkReports())
      .subscribe();
    return () => { supabase.removeChannel(statsCh); supabase.removeChannel(wrCh); };
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

  async function fetchData() {
    setLoading(true);
    const [duty, logs, settingsRes] = await Promise.all([
      supabase.from('officers').select('*').eq('is_on_duty', true).eq('status', 'active').order('name'),
      isCommissioner
        ? supabase.from('duty_logs').select('*').is('deleted_at', null).order('clock_in', { ascending: false }).limit(50)
        : supabase.from('duty_logs').select('*').eq('officer_id', officer?.id).is('deleted_at', null).order('clock_in', { ascending: false }).limit(30),
      supabase.from('system_settings').select('*').eq('id', 1).maybeSingle(),
    ]);
    setOnDutyOfficers(duty.data ?? []);
    setDutyLogs(logs.data ?? []);
    setSettings(settingsRes.data as SystemSettings | null);
    setLoading(false);
  }

  async function fetchWorkReports() {
    if (!officer) return;
    const { data } = await supabase.rpc('list_work_reports', {
      p_viewer_rank: isCommissioner ? 'commissioner' : officer.rank,
      p_viewer_id: officer.id,
    });
    setWorkReports((data ?? []) as WorkReport[]);
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

    let closedLogId: string | null = null;
    if (activeLog) {
      const now = new Date();
      const dur = Math.round((now.getTime() - new Date(activeLog.clock_in).getTime()) / 60000);
      await supabase.from('duty_logs').update({
        clock_out: now.toISOString(),
        duration_minutes: dur,
        checkout_method: 'self',
      }).eq('id', activeLog.id);
      closedLogId = activeLog.id;
    }
    await supabase.from('officers').update({ is_on_duty: false, updated_at: new Date().toISOString() }).eq('id', officer.id);
    setAuth({ ...officer, is_on_duty: false });
    await fetchData();
    if (isCommissioner) await fetchAllLogs();
    setClockLoading(false);
    // เปิดช่องเขียนรายงานหลังออกเวร (หากออกเวรสำเร็จ)
    if (closedLogId) {
      setWorkReportTarget({ dutyLogId: closedLogId });
      setWorkReportSummary('');
      setWorkReportCases([{ case_type: '', details: '', evidence_url: '' }]);
    }
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

  async function submitWorkReport(e: React.FormEvent) {
    e.preventDefault();
    if (!officer || !workReportTarget) return;

    const summary = workReportSummary.trim();
    const validCases = workReportCases.filter((c) => c.details.trim() !== '');
    if (validCases.length === 0) {
      alert('กรุณาระบุรายละเอียดอย่างน้อย 1 เคส');
      return;
    }

    setWorkReportLoading(true);
    const { error } = await supabase.rpc('create_work_report_with_cases', {
      p_officer_id: officer.id,
      p_officer_name: officer.name,
      p_duty_log_id: workReportTarget.dutyLogId,
      p_summary: summary,
      p_cases: validCases,
    });
    setWorkReportLoading(false);
    if (error) {
      alert('เกิดข้อผิดพลาด: ' + error.message);
      return;
    }
    setWorkReportTarget(null);
    setWorkReportSummary('');
    setWorkReportCases([{ case_type: '', details: '', evidence_url: '' }]);
    await fetchWorkReports();
  }

  function addReportCase() {
    setWorkReportCases((prev) => [...prev, { case_type: '', details: '', evidence_url: '' }]);
  }

  function removeReportCase(index: number) {
    setWorkReportCases((prev) => {
      const next = [...prev];
      next.splice(index, 1);
      return next.length === 0 ? [{ case_type: '', details: '', evidence_url: '' }] : next;
    });
  }

  function updateReportCase(index: number, field: 'case_type' | 'details' | 'evidence_url', value: string) {
    setWorkReportCases((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }

  async function handleCaseImageUpload(index: number, file: File) {
    if (!file) return;
    setUploadingCaseIndex(index);
    try {
      const { uploadImage } = await import('../../lib/storage');
      const url = await uploadImage(file, 'evidence');
      if (!url) {
        alert('อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หรือวางลิงก์รูปภาพแทน');
        return;
      }
      setWorkReportCases((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], evidence_url: url };
        return next;
      });
    } catch (err) {
      console.error('Upload error:', err);
      alert('เกิดข้อผิดพลาดในการอัปโหลดรูปภาพ');
    } finally {
      setUploadingCaseIndex(null);
    }
  }

  async function openReportView(report: WorkReport) {
    setViewReport(report);
    const { data } = await supabase.rpc('get_work_report_cases', { p_work_report_id: report.id });
    setViewReportCases((data ?? []) as WorkReportCase[]);
  }

  function openReportEditor(dutyLogId: string | null = null) {
    setWorkReportTarget({ dutyLogId });
    setWorkReportSummary('');
    setWorkReportCases([{ case_type: '', details: '', evidence_url: '' }]);
  }

  function closeReportEditor() {
    setWorkReportTarget(null);
    setWorkReportSummary('');
    setWorkReportCases([{ case_type: '', details: '', evidence_url: '' }]);
  }

  function findReport(dutyLogId: string | null) {
    if (!dutyLogId) return null;
    return workReports.find((r) => r.duty_log_id === dutyLogId);
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
            <button
              onClick={() => openReportEditor(null)}
              className="btn-primary flex items-center gap-2 text-xs py-2 px-3"
            >
              <PenLine size={14} /> เขียนรายงานปฏิบัติงาน
            </button>
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
            <div className={`rounded-xl p-4 mb-4 text-center ${
              officer?.is_on_duty ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-navy-700 border border-blue-900/40'
            }`}>
              <div className={`text-lg font-bold mb-1 ${officer?.is_on_duty ? 'text-emerald-400' : 'text-gray-400'}`}>
                {officer?.is_on_duty ? '● กำลังปฏิบัติหน้าที่' : '○ ไม่ได้ปฏิบัติหน้าที่'}
              </div>
            </div>

            {/* Duty system disabled warning */}
            {!dutyEnabled && !officer?.is_on_duty && (
              <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 flex items-center gap-2.5">
                <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
                <span className="text-red-400 text-xs font-medium">ระบบปิดรับเวรชั่วคราว</span>
              </div>
            )}

            {!officer?.is_on_duty ? (
              <button
                onClick={clockIn}
                disabled={clockLoading || !dutyEnabled}
                className="w-full btn-primary py-3 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <LogIn size={16} /> {clockLoading ? 'กำลังดำเนินการ...' : 'ลงชื่อเข้าเวร'}
              </button>
            ) : (
              <button onClick={clockOut} disabled={clockLoading} className="w-full btn-danger py-3 flex items-center justify-center gap-2">
                <LogOut size={16} /> {clockLoading ? 'กำลังดำเนินการ...' : 'ลงชื่อออกเวร'}
              </button>
            )}

            {officer?.is_on_duty && (
              <button
                onClick={() => showIdCard(officer)}
                className="w-full mt-3 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-500/15 text-blue-400 border border-blue-500/20 hover:bg-blue-500/25 transition-colors text-sm font-medium"
              >
                <ImageIcon size={16} /> ดูบัตรประจำตัว
              </button>
            )}
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
            <div className="px-5 py-4 border-b border-amber-500/15">
              <h2 className="text-sm font-semibold text-white">
                {isCommissioner ? 'ประวัติการปฏิบัติหน้าที่ทั้งหมด' : 'ประวัติของฉัน'}
              </h2>
            </div>
            <div className="overflow-x-auto">
              {loading ? (
                <div className="p-8 text-center text-gray-500 text-sm">กำลังโหลด...</div>
              ) : dutyLogs.length === 0 ? (
                <div className="p-8 text-center">
                  <Clock size={32} className="text-gray-600 mx-auto mb-2" />
                  <p className="text-gray-500 text-sm">ยังไม่มีประวัติ</p>
                </div>
              ) : (
                <table className="w-full">
                  <thead className="table-header-gold">
                    <tr className="border-b border-amber-500/15">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">เจ้าหน้าที่</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">เข้าเวร</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">ออกเวร</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">ระยะเวลา</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">สถานะ</th>
                      <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">รายงาน</th>
                      {isCommissioner && <th className="px-4 py-3" />}
                    </tr>
                  </thead>
                  <tbody>
                    {dutyLogs.map((log) => (
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
                          <Badge variant={log.clock_out ? 'neutral' : 'success'}>
                            {log.clock_out ? 'เสร็จสิ้น' : 'กำลังปฏิบัติ'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {(() => {
                            const r = findReport(log.id);
                            if (r) {
                              return (
                                <button
                                  onClick={() => setViewReport(r)}
                                  className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 py-1 rounded-lg transition-colors"
                                  title="ดูรายงานปฏิบัติงาน"
                                >
                                  <FileText size={14} /> ดูรายงาน
                                </button>
                              );
                            }
                            const canWrite = log.officer_id === officer?.id && log.clock_out;
                            if (!canWrite) return <span className="text-gray-600 text-xs">—</span>;
                            return (
                              <button
                                onClick={() => { setWorkReportTarget({ dutyLogId: log.id }); setWorkReportSummary(''); setWorkReportCases([{ case_type: '', details: '', evidence_url: '' }]); }}
                                className="inline-flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-1 rounded-lg transition-colors"
                                title="เขียนรายงานปฏิบัติงาน"
                              >
                                <PenLine size={14} /> เขียนรายงาน
                              </button>
                            );
                          })()}
                        </td>
                        {isCommissioner && (
                          <td className="px-4 py-3">
                            <button
                              onClick={() => setDeleteTarget(log)}
                              className="text-gray-600 hover:text-red-400 transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Work Reports Section */}
      <div className="mt-6">
        <div className="table-panel overflow-hidden">
          <div className="px-5 py-4 border-b border-amber-500/15">
            <h2 className="text-sm font-semibold text-white">รายงานปฏิบัติงาน</h2>
          </div>
          <div className="overflow-x-auto">
            {workReports.length === 0 ? (
              <div className="p-8 text-center">
                <FileText size={32} className="text-gray-600 mx-auto mb-2" />
                <p className="text-gray-500 text-sm">ยังไม่มีรายงานปฏิบัติงาน</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="table-header-gold">
                  <tr className="border-b border-amber-500/15">
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">เจ้าหน้าี่</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">วันที่</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">สรุป</th>
                    <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">ดู</th>
                  </tr>
                </thead>
                <tbody>
                  {workReports.map((r) => (
                    <tr key={r.id} className="table-row">
                      <td className="px-4 py-3 text-sm text-white font-medium">{r.officer_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-400 whitespace-nowrap">{formatTime(r.created_at)}</td>
                      <td className="px-4 py-3 text-sm text-gray-300 max-w-md truncate">{r.report_text}</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => openReportView(r)} className="text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-1 rounded-lg text-xs transition-colors">
                          อ่าน
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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

      {/* Work Report Modal */}
      {workReportTarget && (
        <Modal title="รายงานปฏิบัติงาน" onClose={closeReportEditor} size="xl">
          <form onSubmit={submitWorkReport} className="space-y-5">
            <p className="text-gray-400 text-xs">สรุปงานที่ทำและรายละเอียดแต่ละเคส สามารถเพิ่มได้หลายรายการและแนบรูปหลักฐานได้</p>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">หัวเรื่อง/สรุปรายงาน</label>
              <input
                className="input-field w-full"
                placeholder="เช่น สรุปการปฏิบัติหน้าที่วันนี้"
                value={workReportSummary}
                onChange={(e) => setWorkReportSummary(e.target.value)}
              />
            </div>

            <div className="space-y-3">
              {workReportCases.map((c, idx) => (
                <div key={idx} className="rounded-lg border border-blue-900/40 bg-navy-900/30 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-400">เคส #{idx + 1}</span>
                    {workReportCases.length > 1 && (
                      <button type="button" onClick={() => removeReportCase(idx)} className="text-xs text-red-400 hover:text-red-300">ลบเคส</button>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">ประเภทเคส</label>
                    <input
                      className="input-field w-full"
                      placeholder="เ่น ช่วยเหลือ, จับกุม, ประชาสัมพันธ์"
                      value={c.case_type}
                      onChange={(e) => updateReportCase(idx, 'case_type', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">รายละเอียด</label>
                    <textarea
                      className="input-field w-full"
                      rows={3}
                      placeholder="รายละเอียดที่เกิดขึ้น..."
                      value={c.details}
                      onChange={(e) => updateReportCase(idx, 'details', e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">ภาพหลักฐาน (เลือกไฟล์หรือวาง URL)</label>
                    {c.evidence_url ? (
                      <div className="rounded-lg overflow-hidden border border-blue-900/50 bg-navy-950 p-2.5">
                        <div className="flex items-center gap-3">
                          <img
                            src={c.evidence_url}
                            alt="ภาพหลักฐาน"
                            className="w-16 h-16 object-cover rounded-md border border-blue-900/40 bg-navy-900 flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <a
                              href={c.evidence_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-emerald-400 hover:text-emerald-300 underline truncate block"
                            >
                              {c.evidence_url}
                            </a>
                            <p className="text-[10px] text-gray-500 mt-0.5">คลิกเพื่อดูภาพขนาดเต็ม</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => updateReportCase(idx, 'evidence_url', '')}
                            className="px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs flex items-center gap-1 transition-colors flex-shrink-0"
                          >
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
                      <div className="space-y-2">
                        <label className="flex flex-col items-center justify-center gap-1 py-3.5 border-2 border-dashed border-blue-900/50 rounded-lg cursor-pointer hover:border-amber-500/40 hover:bg-navy-800/40 transition-all text-center">
                          <div className="flex items-center gap-1.5 text-xs text-gray-300 font-medium">
                            <Upload size={14} className="text-amber-400" />
                            <span>คลิกเพื่อเลือกไฟล์รูปภาพจากเครื่อง</span>
                          </div>
                          <span className="text-[10px] text-gray-500">รองรับ PNG, JPG, JPEG, WEBP</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleCaseImageUpload(idx, f);
                              e.currentTarget.value = '';
                            }}
                          />
                        </label>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-gray-500 flex-shrink-0">หรือใส่ URL:</span>
                          <input
                            type="url"
                            className="input-field py-1 text-xs flex-1"
                            placeholder="วางลิงก์รูปภาพ เช่น Discord CDN, Imgur..."
                            value={c.evidence_url || ''}
                            onChange={(e) => updateReportCase(idx, 'evidence_url', e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <button type="button" onClick={addReportCase} className="text-xs text-amber-400 hover:text-amber-300 border border-dashed border-amber-500/30 rounded-lg py-2 w-full">
                + เพิ่มเคส
              </button>
            </div>

            <div className="flex gap-3 justify-end">
              <button type="button" onClick={closeReportEditor} className="btn-secondary">ยกเลิก</button>
              <button type="submit" disabled={workReportLoading} className="btn-primary disabled:opacity-50">
                {workReportLoading ? 'กำลังบันทึก...' : 'ส่งรายงาน'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* View Work Report Modal */}
      {viewReport && (
        <Modal title={`รายงานของ ${viewReport.officer_name}`} onClose={() => setViewReport(null)} size="xl">
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            <div className="text-xs text-gray-400">{formatTime(viewReport.created_at)}</div>
            {viewReport.report_text && (
              <div className="bg-navy-900/50 p-3 rounded-lg border border-blue-900/40">
                <div className="text-xs text-gray-500 mb-1">สรุป</div>
                <div className="text-sm text-gray-200">{viewReport.report_text}</div>
              </div>
            )}
            <div className="space-y-3">
              {viewReportCases.length === 0 ? (
                <p className="text-gray-500 text-sm">ไม่มีเคสในรายงานนี้</p>
              ) : (
                viewReportCases.map((c, idx) => (
                  <div key={c.id} className="bg-navy-900/50 p-4 rounded-lg border border-blue-900/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-amber-400">เคส #{idx + 1}</span>
                      {c.case_type && <Badge variant="neutral">{c.case_type}</Badge>}
                    </div>
                    <p className="text-sm text-gray-200 whitespace-pre-wrap">{c.details}</p>
                    {c.evidence_url && (
                      <div className="pt-1">
                        <a href={c.evidence_url} target="_blank" rel="noreferrer" className="inline-block group">
                          <img
                            src={c.evidence_url}
                            alt="ภาพหลักฐาน"
                            className="max-h-48 max-w-full rounded-lg border border-blue-900/50 object-contain bg-navy-950 group-hover:opacity-90 transition-opacity"
                          />
                          <span className="block text-[11px] text-emerald-400 group-hover:underline mt-1">คลิกเพื่อดูภาพขนาดเต็ม ↗</span>
                        </a>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <button onClick={() => setViewReport(null)} className="btn-secondary">ปิด</button>
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

/* =========================================================================
 * Subcomponent: BatchDutyRateModal (ตั้งเรทขึ้นเวรทุกคนพร้อมกัน)
 * ========================================================================= */
function BatchDutyRateModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rateInput, setRateInput] = useState<string>('500');
  const [saving, setSaving] = useState(false);

  const presets = [100, 200, 300, 400, 500, 800, 1000];

  async function handleSave() {
    const num = parseFloat(rateInput);
    if (isNaN(num) || num < 0) {
      alert('กรุณาระบุอัตราค่าขึ้นเวรที่ถูกต้อง (ต้อง >= 0)');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('officers')
        .update({ duty_rate: num, updated_at: new Date().toISOString() })
        .neq('status', 'deleted');
      if (error) throw error;
      alert(`ตั้งค่าขึ้นเวรให้เจ้าหน้าที่ทุกคนเป็น ${num.toLocaleString('th-TH')} BC/ชม. เรียบร้อยแล้ว`);
      onSaved();
    } catch (e) {
      alert(`เกิดข้อผิดพลาด: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="⚡ กำหนดอัตราค่าขึ้นเวรให้เจ้าหน้าที่ทุกคน" onClose={onClose} size="md">
      <div className="space-y-4">
        <p className="text-xs text-gray-400">
          ตั้งค่าเรทค่าขึ้นเวร (BC ต่อชั่วโมง) ให้เจ้าหน้าที่ทุกคนในระบบพร้อมกัน โดยระบบจะนำไปคูณกับชั่วโมงทำงานจริงในแต่ละเดือน
        </p>

        <div>
          <label className="block text-xs text-gray-400 mb-1.5">เลือกเรทด่วน:</label>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setRateInput(p.toString())}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-mono border transition-all ${
                  rateInput === p.toString()
                    ? 'bg-amber-500 text-black border-amber-400 font-bold'
                    : 'bg-navy-800 text-gray-300 border-blue-900/60 hover:border-amber-500/40'
                }`}
              >
                {p.toLocaleString('th-TH')} BC/ชม.
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">หรือระบุตัวเลขเอง (BC ต่อชั่วโมง):</label>
          <input
            type="number"
            min={0}
            step="10"
            className="input-field font-mono text-lg font-bold text-amber-400"
            value={rateInput}
            onChange={(e) => setRateInput(e.target.value)}
            placeholder="เช่น 500"
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">ยกเลิก</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn-primary flex-1 flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/20 disabled:opacity-50"
          >
            <Check size={14} /> {saving ? 'กำลังบันทึก...' : 'บันทึกทุกคนทันที'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
