/* =============================================================
 * AdminSettingsPage.tsx — ตั้งค่าระบบ (หัวหน้ากรมเท่านั้น)
 * -------------------------------------------------------------
 * ย้ายสวิตช์ควบคุมระบบออกจากหน้าปฏิบัติงานมาไว้ที่นี่
 *   - PPS Engine (คะแนนอัตโนมัติ) + สแกนคะแนนค้าง
 *   - ระบบเข้าเวร (เปิด/ปิด)
 * เจ้าหน้าที่ทั่วไปไม่มีทางเข้าถึงหน้านี้ (ถูกบล็อกที่ App.tsx)
 * ============================================================= */

import { OFFICER_STAFF_FIELDS } from '../../lib/officerColumns';
import { forceCheckoutAllOpenLogs } from '../../lib/api/forceCheckout';
import { useEffect, useState } from 'react';
import {
  Settings, Award, Power, Loader2, Sparkles, ShieldAlert, RefreshCw, FileText,
} from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';
import { supabase } from '../../lib/supabase';
import { PageHeader } from '../../components/PageHeader';
import type { SystemSettings } from '../../lib/types';
import {
  applyMissingReportPoints, applyWeeklyAbsencePoints,
  AUTO_POINTS_SUMMARY, AUTO_POINTS_RULES,
} from '../../lib/api/autoPoints';
import { resolveScheduledOfficerIds } from '../../lib/dutySchedule';
import { toIso } from '../../lib/dutySchedule';

export function AdminSettingsPage() {
  const { officer } = useAuth();
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  /** migration 0034 ยังไม่ถูกรัน → คอลัมน์ work_reports_enabled ไม่มีในตาราง */
  const [missingReportCol, setMissingReportCol] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('system_settings').select('*').eq('id', 1).maybeSingle();
    const row = data as Record<string, unknown> | null;
    setSettings(row as SystemSettings | null);
    // ตรวจว่าคอลัมน์ของ 0034 มีจริงหรือยัง — ถ้าไม่มี สวิตช์จะกดไม่ได้
    setMissingReportCol(!(row && 'work_reports_enabled' in row));
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  /* ---------- PPS Engine ---------- */
  async function toggleAutoPoints() {
    if (!officer || !settings || busy) return;
    const next = !settings.auto_points_enabled;

    setSettings({ ...settings, auto_points_enabled: next });   // optimistic
    setNotice(null);

    const { error } = await supabase.from('system_settings').update({
      auto_points_enabled: next,
      updated_at: new Date().toISOString(),
      updated_by: officer.id,
      updated_by_name: officer.name,
    }).eq('id', 1);

    if (error) {
      setSettings({ ...settings, auto_points_enabled: !next });  // ย้อนค่า
      setNotice({ kind: 'err', text: `เปลี่ยนสวิตช์ไม่สำเร็จ: ${error.message}` });
      return;
    }

    await supabase.from('audit_logs').insert({
      action: next ? 'ENABLE_AUTO_POINTS' : 'DISABLE_AUTO_POINTS',
      target_type: 'system',
      performed_by: officer.id,
      performed_by_name: officer.name,
      details: {},
    });
    setNotice({
      kind: 'ok',
      text: next
        ? 'เปิด PPS Engine แล้ว — ระบบจะให้/หักคะแนนอัตโนมัติตามเกณฑ์'
        : 'ปิด PPS Engine แล้ว — ระบบจะไม่ให้หักคะแนนอัตโนมัติ (หัวหน้ากรมยังให้/หักเองได้)',
    });
  }

  /** สแกนหาคะแนนค้างแล้วให้/หักตามเกณฑ์ */
  async function runPointsSweep() {
    if (!settings?.auto_points_enabled || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const todayIso = toIso(new Date());
      const weekStartDate = new Date();
      weekStartDate.setDate(weekStartDate.getDate() - 7);
      const weekStart7 = toIso(weekStartDate);

      const [allOfficers, allLogs, allReports, leavesRes, schedRes, ovRes] = await Promise.all([
        supabase.from('officers').select(OFFICER_STAFF_FIELDS).eq('status', 'active'),
        supabase.from('duty_logs').select('*').is('deleted_at', null),
        supabase.from('work_reports').select('*'),
        supabase.from('officer_leaves').select('officer_id').eq('status', 'approved'),
        supabase.from('duty_schedules').select('*').eq('is_active', true),
        supabase
          .from('schedule_overrides').select('*')
          .gte('override_date', weekStart7).lte('override_date', todayIso),
      ]);

      const officers = (allOfficers.data ?? []) as never[];
      const logs = (allLogs.data ?? []) as never[];
      const reports = (allReports.data ?? []) as Array<{ duty_log_id: string | null }>;
      const onLeave = ((leavesRes.data ?? []) as Array<{ officer_id: string | null }>)
        .map((r) => r.officer_id).filter((id): id is string => !!id);

      const scheduledIds = resolveScheduledOfficerIds({
        schedules: (schedRes.data ?? []) as never,
        overrides: (ovRes.data ?? []) as never,
        fromIso: weekStart7,
        toIso: todayIso,
      });

      const results = [
        ...(await applyMissingReportPoints(logs as never, new Set(
          reports.map((r) => r.duty_log_id).filter((id): id is string => !!id),
        ))),
        ...(await applyWeeklyAbsencePoints({
          officers,
          dutyLogs: logs,
          scheduledOfficerIds: [...scheduledIds],
          approvedLeaveOfficerIds: onLeave,
        })),
      ];

      const given = results.filter((r) => r.awarded);
      setNotice({
        kind: 'ok',
        text: given.length === 0
          ? 'ไม่มีเหตุการณ์ที่ต้องให้คะแนน (หรือให้ไปแล้วทั้งหมด)'
          : `ให้คะแนนอัตโนมัติ ${given.length} รายการ · รวม ${given.reduce((s, r) => s + r.delta, 0)} คะแนน`,
      });
    } catch (e) {
      setNotice({ kind: 'err', text: `สแกนไม่สำเร็จ: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  /* ---------- การรายงานปฏิบัติงาน ---------- */
  async function toggleWorkReports() {
    if (!officer || !settings || busy) return;
    if (missingReportCol) {
      setNotice({
        kind: 'err',
        text: 'ยังเปิด/ปิดไม่ได้ — ยังไม่ได้รัน migration 0034_work_reports_toggle.sql (ตาราง system_settings ยังไม่มีคอลัมน์ work_reports_enabled)',
      });
      return;
    }
    const next = !settings.work_reports_enabled;
    setSettings({ ...settings, work_reports_enabled: next });
    setNotice(null);

    const { error } = await supabase.from('system_settings').update({
      work_reports_enabled: next,
      updated_at: new Date().toISOString(),
      updated_by: officer.id,
      updated_by_name: officer.name,
    }).eq('id', 1);

    if (error) {
      setSettings({ ...settings, work_reports_enabled: !next });
      setMissingReportCol(/work_reports_enabled|column/i.test(error.message));
      setNotice({
        kind: 'err',
        text: /work_reports_enabled|column/i.test(error.message)
          ? 'บันทึกไม่ได้ — ยังไม่ได้รัน migration 0034_work_reports_toggle.sql'
          : `เปลี่ยนสวิตช์ไม่สำเร็จ: ${error.message}`,
      });
      return;
    }

    await supabase.from('audit_logs').insert({
      action: next ? 'ENABLE_WORK_REPORTS' : 'DISABLE_WORK_REPORTS',
      target_type: 'system',
      performed_by: officer.id,
      performed_by_name: officer.name,
      details: {},
    });
    setNotice({
      kind: 'ok',
      text: next
        ? 'เปิดการรายงานปฏิบัติงานแล้ว — เจ้าหน้าที่ส่งรายงานได้ตามปกติ'
        : 'ปิดการรายงานปฏิบัติงานแล้ว — เจ้าหน้าที่จะส่งรายงานไม่ได้ (รายงานที่ส่งไปแล้วยังอยู่ครบ)',
    });
  }

  /* ---------- ระบบเข้าเวร ---------- */
  async function toggleDutySystem() {
    if (!officer || !settings || busy) return;
    const next = !settings.duty_system_enabled;
    setSettings({ ...settings, duty_system_enabled: next });
    setNotice(null);

    const { error } = await supabase.from('system_settings').update({
      duty_system_enabled: next,
      updated_at: new Date().toISOString(),
      updated_by: officer.id,
      updated_by_name: officer.name,
    }).eq('id', 1);

    if (error) {
      setSettings({ ...settings, duty_system_enabled: !next });
      setNotice({ kind: 'err', text: `เปลี่ยนสวิตช์ไม่สำเร็จ: ${error.message}` });
      return;
    }

    await supabase.from('audit_logs').insert({
      action: next ? 'ENABLE_DUTY_SYSTEM' : 'DISABLE_DUTY_SYSTEM',
      target_type: 'system',
      performed_by: officer.id,
      performed_by_name: officer.name,
      details: {},
    });

    // ปิดระบบเวร → บังคับออกเวรทุกคนที่ยังเข้าเวรค้างอยู่ทันที
    //
    // ใช้ฟังก์ชันกลาง forceCheckoutAllOpenLogs ที่อ่านจาก duty_logs ที่
    // clock_out IS NULL (ไม่ใช่ธง officers.is_on_duty เพราะสองอย่าง desync
    // กันได้ ถ้าเชื่อธงจะพลาดเวรที่ค้างจริง) และหักคะแนน −15 ให้ด้วย
    if (!next) {
      const res = await forceCheckoutAllOpenLogs({ id: officer.id, name: officer.name });

      if (!res.ok) {
        setNotice({
          kind: 'err',
          text: `ปิดระบบเวรได้ แต่บังคับออกเวรไม่สำเร็จ ${res.failed} รายการ: ${res.errors[0] ?? 'ไม่ทราบสาเหตุ'}`,
        });
        return;
      }

      const hours = Math.floor(res.minutes / 60);
      const mins = res.minutes % 60;
      setNotice({
        kind: 'ok',
        text: res.closed > 0
          ? `ปิดระบบเข้าเวรแล้ว · บังคับออกเวร ${res.closed} รายการ `
            + `(รวม ${hours} ชม. ${mins} นาที · หักคะแนน ${AUTO_POINTS_RULES.forceCheckout} ต่อรายการ)`
          : 'ปิดระบบเข้าเวรแล้ว · ไม่มีใครกำลังเข้าเวรค้างอยู่',
      });
      return;
    }

    setNotice({ kind: 'ok', text: 'เปิดระบบเข้าเวรแล้ว' });
  }

  const autoPoints = settings?.auto_points_enabled ?? false;
  const dutyEnabled = settings?.duty_system_enabled ?? true;
  const reportsEnabled = settings?.work_reports_enabled ?? true;

  return (
    <div>
      <PageHeader
        icon={<Settings size={26} />}
        title="ตั้งค่าระบบ"
        subtitle="สวิตช์ควบคุมระบบทั้งหมด — เฉพาะหัวหน้ากรม"
        actions={
          <button onClick={load} className="btn-secondary flex items-center gap-2 text-xs">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> รีเฟรช
          </button>
        }
      />

      <div className="flex items-start gap-2.5 text-[12px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3.5 py-2.5 mb-5">
        <ShieldAlert size={15} className="mt-0.5 flex-shrink-0" />
        <span className="leading-relaxed">
          สวิตช์เหล่านี้มีผลกับทั้งหน่วยงานทันที และทุกการเปลี่ยนจะถูกบันทึกลง audit_logs
          พร้อมชื่อผู้กด
        </span>
      </div>

      {missingReportCol && (
        <div className="flex items-start gap-2.5 text-[12px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3.5 py-2.5 mb-4">
          <ShieldAlert size={15} className="mt-0.5 flex-shrink-0" />
          <div className="space-y-0.5">
            <div className="font-semibold">ยังเปิด/ปิดการรายงานปฏิบัติงานไม่ได้</div>
            <div className="text-[11px] text-amber-300/80">
              ตาราง <code className="text-amber-200">system_settings</code> ยังไม่มีคอลัมน์{' '}
              <code className="text-amber-200">work_reports_enabled</code>{' '}
              กรุณารัน <code className="text-amber-200">0034_work_reports_toggle.sql</code>{' '}
              ใน Supabase SQL Editor (อยู่ในไฟล์ APPLY_0026_and_0032.sql แล้ว)
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div className={`flex items-start gap-2 text-[12px] rounded-lg px-3.5 py-2.5 mb-4 border ${
          notice.kind === 'ok'
            ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
            : 'text-red-300 bg-red-500/10 border-red-500/30'
        }`}
        >
          <span className="flex-1">{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-gray-400 hover:text-white">✕</button>
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-400 py-12">กำลังโหลด...</div>
      ) : (
        <div className="space-y-4">
          {/* PPS Engine */}
          <div className={`card p-4 sm:p-5 border-2 ${autoPoints ? 'border-amber-500/30' : 'border-blue-900/40'}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  autoPoints ? 'bg-amber-500/15 text-amber-400' : 'bg-navy-700 text-gray-500'
                }`}
                >
                  <Award size={20} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-white">PPS Engine — คะแนนอัตโนมัติ</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {autoPoints
                      ? `ทำงานอัตโนมัติ — ${AUTO_POINTS_SUMMARY}`
                      : 'ปิดอยู่ — ระบบจะไม่ให้หักคะแนนอัตโนมัติ (หัวหน้ากรมยังให้/หักคะแนนเองได้)'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={runPointsSweep}
                  disabled={!autoPoints || busy}
                  className="btn-secondary text-xs py-2 px-3 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="สแกนหาคะแนนที่ค้างแล้วให้คะแนน/หักคะแนนตามเกณฑ์"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  สแกนคะแนนค้าง
                </button>
                <button
                  onClick={toggleAutoPoints}
                  disabled={busy}
                  className={`relative w-16 h-8 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${
                    autoPoints ? 'bg-amber-500' : 'bg-navy-600'
                  }`}
                  aria-label="เปิด/ปิดคะแนนอัตโนมัติ"
                  aria-pressed={autoPoints}
                >
                  <div className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-lg transition-transform ${
                    autoPoints ? 'translate-x-8' : ''
                  }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* ระบบเข้าเวร */}
          <div className={`card p-4 sm:p-5 border-2 ${dutyEnabled ? 'border-emerald-500/30' : 'border-red-500/30'}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  dutyEnabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                }`}
                >
                  <Power size={20} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-white">ระบบเข้าเวร</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {dutyEnabled
                      ? 'เปิดอยู่ — เจ้าหน้าที่เข้า-ออกเวรได้ตามปกติ'
                      : 'ปิดอยู่ — เจ้าหน้าที่เข้าเวรไม่ได้ (คนที่เข้าเวรค้างจะถูกบังคับออกเวรให้อัตโนมัติ)'}
                  </p>
                </div>
              </div>
              <button
                onClick={toggleDutySystem}
                disabled={busy}
                className={`relative w-16 h-8 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${
                  dutyEnabled ? 'bg-emerald-500' : 'bg-red-500'
                }`}
                aria-label="เปิด/ปิดระบบเข้าเวร"
                aria-pressed={dutyEnabled}
              >
                <div className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-lg transition-transform ${
                  dutyEnabled ? 'translate-x-8' : ''
                }`}
                />
              </button>
            </div>
          </div>

          {/* การรายงานปฏิบัติงาน */}
          <div className={`card p-4 sm:p-5 border-2 ${reportsEnabled ? 'border-blue-500/30' : 'border-red-500/30'}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  reportsEnabled ? 'bg-blue-500/15 text-blue-400' : 'bg-red-500/15 text-red-400'
                }`}
                >
                  <FileText size={20} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-white">การรายงานปฏิบัติงาน</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {missingReportCol
                      ? 'ยังเปิดใช้ไม่ได้ — ต้องรัน migration 0034_work_reports_toggle.sql ก่อน'
                      : reportsEnabled
                        ? 'เปิดอยู่ — เจ้าหน้าที่ส่งรายงานปฏิบัติงานได้ตามปกติ'
                        : 'ปิดอยู่ — เจ้าหน้าที่จะส่งรายงานไม่ได้ (หัวหน้ากรมยังอนุมัติรายงานที่ส่งไปแล้วได้)'}
                  </p>
                </div>
              </div>
              <button
                onClick={toggleWorkReports}
                disabled={busy}
                className={`relative w-16 h-8 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${
                  missingReportCol ? 'bg-navy-600'
                    : reportsEnabled ? 'bg-blue-500' : 'bg-red-500'
                }`}
                aria-label="เปิด/ปิดการรายงานปฏิบัติงาน"
                aria-pressed={reportsEnabled}
              >
                <div className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-lg transition-transform ${
                  reportsEnabled ? 'translate-x-8' : ''
                }`}
                />
              </button>
            </div>
          </div>

          {/* ค่าที่อ่านได้อย่างเดียว */}
          <div className="card p-4 sm:p-5">
            <h2 className="text-xs font-semibold text-gray-300 mb-3">สถานะระบบ</h2>
            <div className="grid sm:grid-cols-3 gap-2.5">
              <div className="rounded-lg bg-navy-900/50 border border-blue-900/40 px-3 py-2.5">
                <div className="text-[10px] text-gray-500">ระบบเข้าเวร</div>
                <div className={`text-sm font-bold mt-0.5 ${dutyEnabled ? 'text-emerald-400' : 'text-red-400'}`}>
                  {dutyEnabled ? 'เปิดอยู่' : 'ปิดอยู่'}
                </div>
              </div>
              <div className="rounded-lg bg-navy-900/50 border border-blue-900/40 px-3 py-2.5">
                <div className="text-[10px] text-gray-500">PPS Engine</div>
                <div className={`text-sm font-bold mt-0.5 ${autoPoints ? 'text-amber-400' : 'text-gray-400'}`}>
                  {autoPoints ? 'ทำงาน' : 'ปิดอยู่'}
                </div>
              </div>
              <div className="rounded-lg bg-navy-900/50 border border-blue-900/40 px-3 py-2.5">
                <div className="text-[10px] text-gray-500">รายงานปฏิบัติงาน</div>
                <div className={`text-sm font-bold mt-0.5 ${reportsEnabled ? 'text-blue-400' : 'text-red-400'}`}>
                  {reportsEnabled ? 'เปิดอยู่' : 'ปิดอยู่'}
                </div>
              </div>
              <div className="rounded-lg bg-navy-900/50 border border-blue-900/40 px-3 py-2.5">
                <div className="text-[10px] text-gray-500">ระบบล็อกอิน</div>
                <div className="text-sm font-bold mt-0.5 text-white">
                  {settings?.login_enabled === false ? 'ปิดอยู่' : 'เปิดอยู่'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
