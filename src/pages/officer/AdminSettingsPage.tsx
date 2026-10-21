/* =============================================================
 * AdminSettingsPage.tsx — ตั้งค่าระบบ (หัวหน้ากรมเท่านั้น)
 * -------------------------------------------------------------
 * ย้ายสวิตช์ควบคุมระบบออกจากหน้าปฏิบัติงานมาไว้ที่นี่
 *   - PPS Engine (คะแนนอัตโนมัติ) + สแกนคะแนนค้าง
 *   - ระบบเข้าเวร (เปิด/ปิด)
 * เจ้าหน้าที่ทั่วไปไม่มีทางเข้าถึงหน้านี้ (ถูกบล็อกที่ App.tsx)
 * ============================================================= */

import type { WorkReport, DutyLog, ServiceRecord } from '../../lib/types';
import { getOfficerFields } from '../../lib/officerColumns';
import {
  describeRange, filterByRangeDetailed, presetRange,
  type SweepDatePreset,
} from '../../lib/sweepDateFilter';
import { forceCheckoutAllOpenLogs } from '../../lib/api/forceCheckout';
import { useEffect, useState } from 'react';
import {
  Settings, Award, Power, Loader2, Sparkles, ShieldAlert, RefreshCw, FileText, AlertTriangle,
  CalendarDays, Wrench, Save,
} from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';
import { supabase } from '../../lib/supabase';
import { PageHeader } from '../../components/PageHeader';
import type { SystemSettings } from '../../lib/types';
import {
  applyMissingReportPoints, applyWeeklyAbsencePoints, applyPaidRecordsSweep,
  applyCheckoutPointsSweep, applyForceCheckoutSweep,
  applyReportApprovalSweep, applyCompletedCaseSweep, applyVerifiedComplaintSweep,
  type AutoAwardResult,
  AUTO_POINTS_SUMMARY, AUTO_POINTS_RULES,
} from '../../lib/api/autoPoints';
import { resolveScheduledOfficerIds } from '../../lib/dutySchedule';
import { StorageCleanupPage } from './StorageCleanupPage';
import { toIso } from '../../lib/dutySchedule';

/** วันเริ่มสัปดาห์ (จันทร์) ของวันที่ที่ระบุ */
function weekKeyOf(iso: string): string {
  const dt = new Date(`${iso}T00:00:00`);
  const dow = dt.getDay();
  dt.setDate(dt.getDate() - dow + (dow === 0 ? -6 : 1));
  return toIso(dt);
}

/**
 * ตาราง "ใครมีเวรในสัปดาห์ไหน" ย้อนหลัง 52 สัปดาห์
 *
 * ใช้เป็นเงื่อนไขหลักของกฎ "ขาดเวรต่อสัปดาห์" — สัปดาห์ที่ไม่มีตารางเวร
 * แปลว่ายังไม่มีระบบจัดเวร จึงห้ามหักคะแนนขาดเวรย้อนไปถึงช่วงนั้น
 */
function buildWeeklyScheduleMap(
  schedules: { data: never[] | null },
  overrides: { data: never[] | null },
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const add = (week: string, id: string) => {
    const set = result.get(week) ?? new Set<string>();
    set.add(id);
    result.set(week, set);
  };

  // จัดทำ override ลง Map ตามวันที่ เพื่อไม่ต้อง .some() ทั้งอาร์เรย์ทุกครั้ง
  // (เดิมเป็น 364 รอบ × จำนวน override = แพงมาก)
  const blocked = new Map<string, Array<string | null>>();
  for (const o of (overrides.data ?? []) as Array<{
    override_date: string; override_type: string; officer_id: string | null;
  }>) {
    if (o.override_type !== 'leave' && o.override_type !== 'off') continue;
    const list = blocked.get(o.override_date) ?? [];
    list.push(o.officer_id);
    blocked.set(o.override_date, list);
  }

  const today = new Date();
  for (const sch of (schedules.data ?? []) as Array<{
    weekday: number; officer_id: string | null; is_active?: boolean;
  }>) {
    if (sch.is_active === false || !sch.officer_id) continue;
    for (let back = 0; back <= 52 * 7; back++) {
      const dt = new Date(today);
      dt.setDate(dt.getDate() - back);
      if (dt.getDay() !== sch.weekday) continue;
      const iso = toIso(dt);
      const list = blocked.get(iso);
      if (list?.some((id) => id === null || id === sch.officer_id)) continue;
      add(weekKeyOf(iso), sch.officer_id);
    }
  }
  return result;
}

/** ตาราง "ใครลาอยู่ในสัปดาห์ไหน" จากใบลาที่อนุมัติแล้ว */
function buildLeaveWeekMap(
  leaves: { data: never[] | null },
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const lv of (leaves.data ?? []) as Array<{
    officer_id: string | null; start_date: string | null; end_date: string | null;
  }>) {
    if (!lv.officer_id || !lv.start_date || !lv.end_date) continue;
    const cur = new Date(`${lv.start_date.slice(0, 10)}T00:00:00`);
    const end = new Date(`${lv.end_date.slice(0, 10)}T00:00:00`);
    for (let guard = 0; guard <= 400 && cur <= end; guard++) {
      const wk = weekKeyOf(toIso(cur));
      const list = result.get(wk) ?? [];
      list.push(lv.officer_id);
      result.set(wk, list);
      cur.setDate(cur.getDate() + 1);
    }
  }
  return result;
}

export function AdminSettingsPage() {
  const { officer } = useAuth();
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  /** migration 0034 ยังไม่ถูกรัน → คอลัมน์ work_reports_enabled ไม่มีในตาราง */
  const [missingReportCol, setMissingReportCol] = useState(false);
  /** migration 0051 ยังไม่ถูกรัน → คอลัมน์ maintenance_mode ไม่มีในตาราง */
  const [missingMaintCol, setMissingMaintCol] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  /** หัวข้อ + เนื้อหา maintenance ที่กำลังแก้ (ยังไม่ save) */
  const [maintTitleDraft, setMaintTitleDraft] = useState('');
  const [maintSubtitleDraft, setMaintSubtitleDraft] = useState('');
  const [maintMsgDraft, setMaintMsgDraft] = useState('');
  const [maintEtaDraft, setMaintEtaDraft] = useState('');
  const [maintEtaLabelDraft, setMaintEtaLabelDraft] = useState('');

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('system_settings').select('*').eq('id', 1).maybeSingle();
    const row = data as Record<string, unknown> | null;
    setSettings(row as SystemSettings | null);
    // ตรวจว่าคอลัมน์ของ 0034 มีจริงหรือยัง — ถ้าไม่มี สวิตช์จะกดไม่ได้
    setMissingReportCol(!(row && 'work_reports_enabled' in row));
    setMissingMaintCol(!(row && 'maintenance_mode' in row));
    const r = row as Record<string, unknown> | null;
    setMaintTitleDraft((r?.maintenance_title as string) ?? '');
    setMaintSubtitleDraft((r?.maintenance_subtitle as string) ?? '');
    setMaintMsgDraft((r?.maintenance_message as string) ?? '');
    // timestamptz → datetime-local format (YYYY-MM-DDTHH:MM)
    const eta = r?.maintenance_eta as string | null;
    setMaintEtaDraft(eta ? eta.slice(0, 16) : '');
    setMaintEtaLabelDraft((r?.maintenance_eta_label as string) ?? '');
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

  /** ช่วงวันที่สำหรับสแกนคะแนน — เว่งเพื่อความเป็นธรรม */
  const [sweepFrom, setSweepFrom] = useState('');
  const [sweepTo, setSweepTo] = useState('');
  const [sweepPreset, setSweepPreset] = useState<SweepDatePreset>('all');

  /** สแกนหาคะแนนค้างแล้วให้/หักตามเกณฑ์ */

  /** กฎคะแนนที่ตรวจย้อนหลังได้ */
type PointsSweepKey =
  | 'checkout' | 'force' | 'report' | 'case' | 'paid'
  | 'noreport' | 'absent' | 'complaint';

/** ปุ่มตรวจคะแนนค้าง แยกทีละกฎ */
const SWEEP_BUTTONS: Array<{
  key: PointsSweepKey;
  label: string;
  hint: string;
  tone: string;
}> = [
  { key: 'checkout', label: 'ออกเวร', hint: `+5/ชม. ต่อเวรที่ออกแล้วแต่ยังไม่ได้คะแนน`, tone: 'text-emerald-300' },
  { key: 'report', label: 'รายงานได้รับอนุมัติ', hint: '+10 ต่อรายงานที่อนุมัติแล้ว', tone: 'text-emerald-300' },
  { key: 'case', label: 'ปิดเคส', hint: '+5 ต่อเคสย่อยที่ปิดสำเร็จ', tone: 'text-emerald-300' },
  { key: 'paid', label: 'รับชำระครบ', hint: '+5 ต่อ 1 รายการที่ชำระแล้ว ให้ทุกคนที่ดูแลเคส', tone: 'text-emerald-300' },
  { key: 'absent', label: 'ขาดเวรต่อสัปดาห์', hint: '-5 ต่อคนที่ไม่เข้าเวรครบ 7 วัน', tone: 'text-red-300' },
  { key: 'noreport', label: 'ไม่ส่งรายงาน', hint: '-5 ต่อเวรที่ออกแล้วไม่ส่งรายงาน', tone: 'text-red-300' },
  { key: 'force', label: 'ถูกบังคับออกเวร', hint: '-15 ต่อเวรที่ถูกบังคับออก', tone: 'text-red-300' },
  { key: 'complaint', label: 'ร้องเรียนผลเป็นจริง', hint: '-30 ต่อเรื่องร้องเรียนที่ยืนยันแล้ว', tone: 'text-red-300' },
];

/**
 * โหลดเฉพาะข้อมูลที่กฎที่กดต้องใช้
 *
 * เดิมดึงทั้งระบบทุกครั้งที่กดปุ่มไหนก็ตาม (9 query + สร้างตารางเวร 364 รอบ)
 * ทำให้กดปุ่มเดียวก็เหมือนสแกนทั้งระบบ และช้าผิดปกติ
 * ตอนนี้แต่ละปุ่มดึงเฉพาะตารางที่ตัวเองใช้
 */
  async function loadSweepData(keys: PointsSweepKey[]) {
  const fields = await getOfficerFields();
    const need = new Set(keys);
    const needLogs = need.has('checkout') || need.has('force')
      || need.has('noreport') || need.has('absent');
    const needReports = need.has('report') || need.has('case') || need.has('noreport');
    const needSchedules = need.has('absent');
    const needPaid = need.has('paid');
    const needOfficers = need.has('absent') || need.has('complaint');
    const needComplaints = need.has('complaint');
    const needLeaves = need.has('absent');

    /** ใช้แทน query ที่ไม่ต้องดึง */
    const skip = { data: null } as { data: never[] | null };

    const todayIso = toIso(new Date());
    const weekStartDate = new Date();
    weekStartDate.setDate(weekStartDate.getDate() - 7);
    const weekStart7 = toIso(weekStartDate);
    const backfillDate = new Date();
    backfillDate.setDate(backfillDate.getDate() - 7 * 52);
    const backfillIso = toIso(backfillDate);

    const [officersRes, logsRes, reportsRes, leavesRes, schedRes, ovRes,
      paidRes, assignRes, casesRes, complaintsRes] = await Promise.all([
      needOfficers
        ? supabase.from('officers').select(fields).eq('status', 'active')
        : Promise.resolve(skip),
      needLogs
        ? supabase.from('duty_logs').select('*').is('deleted_at', null)
        : Promise.resolve(skip),
      needReports
        ? supabase.from('work_reports').select('*')
        : Promise.resolve(skip),
      needLeaves
        ? supabase.from('officer_leaves')
          .select('officer_id, start_date, end_date').eq('status', 'approved')
        : Promise.resolve(skip),
      needSchedules
        ? supabase.from('duty_schedules').select('*').eq('is_active', true)
        : Promise.resolve(skip),
      needSchedules
        ? supabase.from('schedule_overrides').select('*')
          .gte('override_date', backfillIso).lte('override_date', todayIso)
        : Promise.resolve(skip),
      // บิลที่ชำระแล้ว — เกณฑ์ +5 ต่อ 1 รายการ
      needPaid
        ? supabase.from('service_records').select('*').eq('status', 'paid')
        : Promise.resolve(skip),
      needPaid
        ? supabase.from('service_record_officers').select('service_record_id, officer_id')
        : Promise.resolve(skip),
      // เคสย่อยต้องอ่านผ่าน RPC เท่านั้น (query ตรงโดน RLS)
      need.has('case')
        ? supabase.rpc('get_all_completed_report_cases')
        : Promise.resolve(skip),
      needComplaints
        ? supabase.from('complaints').select('id, officer_name, status, created_at')
        : Promise.resolve(skip),
    ]);

    const assignedMap = new Map<string, string[]>();
    for (const row of (assignRes.data ?? []) as Array<{ service_record_id: string; officer_id: string }>) {
      const list = assignedMap.get(row.service_record_id) ?? [];
      list.push(row.officer_id);
      assignedMap.set(row.service_record_id, list);
    }

    /**
     * ตารางเวรรายสัปดาห์ — เงื่อนไขหลักของกฎ "ขาดเวรต่อสัปดาห์"
     * สัปดาห์ที่ไม่มีตารางเวร = ยังไม่มีระบบจัดเวร จึงห้ามหักคะแนน
     * (กันไม่ให้หักย้อนไปถึงช่วงก่อนระบบเริ่มใช้งาน)
     */
    // สร้างตารางเวร/ตารางลา เฉพาะตอนกด "ขาดเวรต่อสัปดาห์" เท่านั้น
    // (เป็นส่วนที่หนักที่สุด — 364 รอบ × ทุกแถวของตารางเวร)
    const scheduledByWeek = needSchedules
      ? buildWeeklyScheduleMap(schedRes, ovRes)
      : new Map<string, Set<string>>();
    const leaveByWeek = needLeaves ? buildLeaveWeekMap(leavesRes) : new Map<string, string[]>();


    return {
      todayIso,
      weekStart7,
      officers: (officersRes.data ?? []) as never[],
      logs: (logsRes.data ?? []) as DutyLog[],
      reports: (reportsRes.data ?? []) as WorkReport[],
      onLeave: ((leavesRes.data ?? []) as Array<{ officer_id: string | null }>)
        .map((r) => r.officer_id).filter((id): id is string => !!id),
      schedules: (schedRes.data ?? []) as never[],
      overrides: (ovRes.data ?? []) as never[],
      paidRecords: (paidRes.data ?? []) as ServiceRecord[],
      assignedMap,
      scheduledByWeek,
      leaveByWeek,
      allCases: (casesRes.data ?? []) as Array<{ id: string; work_report_id: string; case_status?: string }>,
      complaints: (complaintsRes.data ?? []) as Array<{ id: string; officer_name: string | null; status: string; created_at?: string | null }>,
      casesAvailable: !casesRes.error,
    };
  }

  /** รันกฎคะแนนที่เลือก (key = PointsSweepKey) */
  async function runPointsSweep(keys: PointsSweepKey[]) {
    if (!settings?.auto_points_enabled || busy) return;
    setBusy(true);
    setNotice(null);

    try {
      const d = await loadSweepData(keys);
      const scheduledIds = resolveScheduledOfficerIds({
        schedules: d.schedules,
        overrides: d.overrides,
        fromIso: d.weekStart7,
        toIso: d.todayIso,
      });

      const runs: Array<Promise<AutoAwardResult[]> | AutoAwardResult[]> = [];
      /** จำนวนรายการที่แต่ละกฎไปตรวจเทียบ — ใช้บอกผู้ใช้ว่า "ตรวจแล้ว ไม่ได้ไม่ทำงาน" */
      const checked: Partial<Record<PointsSweepKey, number>> = {};

      /*
       * จำกัดช่วงวันที่ก่อนให้แต่ละกฎไปคำนวณ
       *
       * ทำตรงนี้ (ไม่ใช่ใน loadSweepData) เพราะแต่ละกฎอ้างคอลัมน์วันที่คนละชื่อ
       * และบางกฎต้องเห็นข้อมูลนอกช่วงเพื่อคำนวณให้ถูก
       * เช่น "รายงานได้รับอนุมัติ" ใช้วันที่สร้างรายงาน แต่ปิดเคสใช้วันที่ของเคส
       *
       * รายการที่ถูกตัดเพราะ "ไม่มีวันที่" นับไว้แล้วจะแจ้งผู้ใช้ท้ายหน้า
       * ไม่ปล่อยให้หายเงียบ
       */
      let noDateSkipped = 0;

      const logsInRange = filterByRangeDetailed(d.logs, sweepFrom, sweepTo, (l) => l.clock_in).kept;
      const reportsInRange = filterByRangeDetailed(d.reports, sweepFrom, sweepTo, (r) => r.created_at).kept;
      // เคสย่อยไม่มีวันที่ของตัวเอง (RPC คืนมาแค่ id/work_report_id/status)
      // จึงใช้ "วันที่ของรายงานแม่" แทน ซึ่งเป็นวันที่ทำงานจริง
      const reportIdsInRange = new Set(reportsInRange.map((r) => r.id));
      const casesInRange = d.allCases.filter((c) => reportIdsInRange.has(c.work_report_id));
      const paidInRange = filterByRangeDetailed(d.paidRecords, sweepFrom, sweepTo, (r) => r.service_date).kept;
      const complaintsInRange = filterByRangeDetailed(d.complaints, sweepFrom, sweepTo, (c) => c.created_at ?? null).kept;

      noDateSkipped
        += filterByRangeDetailed(d.logs, sweepFrom, sweepTo, (l) => l.clock_in).skipped
        + filterByRangeDetailed(d.reports, sweepFrom, sweepTo, (r) => r.created_at).skipped
        + filterByRangeDetailed(d.paidRecords, sweepFrom, sweepTo, (r) => r.service_date).skipped
        + filterByRangeDetailed(d.complaints, sweepFrom, sweepTo, (c) => c.created_at ?? null).skipped;

      // รายงานที่ผ่านการกรอง — ใช้ทั้งกฎ report, case และ noreport
      // (noreport ต้องรู้ duty_log_id ของรายงานที่ส่งแล้ว แม้รายงานนั้นอยู่นอกช่วง)
      const reportsForNoReport = d.reports;

      for (const key of keys) {
        if (key === 'checkout') {
          checked.checkout = logsInRange.filter(
            (l) => l.id && l.clock_out && l.checkout_method !== 'forced').length;
          runs.push(applyCheckoutPointsSweep(logsInRange));
        } else if (key === 'force') {
          checked.force = logsInRange.filter(
            (l) => l.id && l.clock_out && l.checkout_method === 'forced').length;
          runs.push(applyForceCheckoutSweep(logsInRange));
        } else if (key === 'report') {
          // เฉพาะรายงานที่อนุมัติแล้ว — ยังไม่เคยได้คะแนน
          const approved = reportsInRange.filter((r) => (r.status ?? 'pending') === 'approved');
          checked.report = approved.length;
          runs.push(applyReportApprovalSweep(approved));
        } else if (key === 'case') {
          checked.case = casesInRange.filter((c) => c.case_status === 'completed').length;
          const map = new Map<string, Array<{ id: string; case_status?: string | null }>>();
          for (const c of casesInRange) {
            const list = map.get(c.work_report_id) ?? [];
            list.push(c);
            map.set(c.work_report_id, list);
          }
          runs.push(applyCompletedCaseSweep(
            async (reportId) => map.get(reportId) ?? [],
            d.reports,
          ));
        } else if (key === 'paid') {
          // +5 ต่อ 1 รายการที่ชำระแล้ว ให้ทุกเจ้าหน้าที่ที่ดูแลเคส
          let pairCount = 0;
          for (const r of paidInRange) {
            if (!r?.id || (r.status as string) !== 'paid') continue;
            const ids = new Set<string>();
            if (r.officer_id) ids.add(r.officer_id);
            for (const id of d.assignedMap.get(r.id) ?? []) if (id) ids.add(id);
            pairCount += ids.size;
          }
          checked.paid = pairCount;
          runs.push(applyPaidRecordsSweep(paidInRange, d.assignedMap));
        } else if (key === 'noreport') {
          // รายงานที่ส่งแล้วต้องดูทั้งหมด ไม่งั้นเวรในช่วงที่เลือก
          // จะถูกหักเพราะ "ไม่ส่งรายงาน" ทั้งที่ส่งแล้วเมื่อวันที่อยู่นอกช่วง
          runs.push(applyMissingReportPoints(logsInRange as never, new Set(
            reportsForNoReport.map((r) => r.duty_log_id).filter((id): id is string => !!id),
          )));
        } else if (key === 'complaint') {
          checked.complaint = complaintsInRange.filter(
            (c) => (c.status as string) === 'verified').length;
          runs.push(applyVerifiedComplaintSweep(complaintsInRange));
        } else if (key === 'absent') {
          checked.absent = d.scheduledByWeek.size;
          runs.push(applyWeeklyAbsencePoints({
            officers: d.officers,
            dutyLogs: logsInRange,
            scheduledOfficerIds: [...scheduledIds],
            approvedLeaveOfficerIds: d.onLeave,
            scheduledByWeek: new Map(
              [...d.scheduledByWeek].map(([w, ids]) => [w, [...ids]]),
            ),
            approvedLeaveByWeek: d.leaveByWeek,
            maxWeeks: 26,
          }));
        }
      }

      const results = (await Promise.all(runs)).flat();
      const given = results.filter((r) => r.awarded);

      const label = keys.length === 1
        ? SWEEP_BUTTONS.find((b) => b.key === keys[0])?.label ?? keys[0]
        : `${keys.length} เกณฑ์`;
      const checkedTotal = keys.reduce((s, k) => s + (checked[k] ?? 0), 0);

      if (given.length === 0) {
        const dup = results.length;
        setNotice({
          kind: 'ok',
          text: dup > 0
            ? `[${label}] ตรวจแล้ว ${checkedTotal} รายการ · เคยให้/หักไปแล้วทั้งหมด ${dup} รายการ ไม่มีคะแนนค้าง`
            : checkedTotal > 0
              ? `[${label}] ตรวจแล้ว ${checkedTotal} รายการ · ไม่พบรายการที่เข้าเกณฑ์ (ยังไม่ต้องให้คะแนน)`
              : `[${label}] ยังไม่มีข้อมูลที่เข้าเกณฑ์ในระบบ`,
        });
      } else {
        const plus = given.filter((r) => r.delta > 0).reduce((s, r) => s + r.delta, 0);
        const minus = given.filter((r) => r.delta < 0).reduce((s, r) => s + r.delta, 0);
        setNotice({
          kind: 'ok',
          text: `ให้/หักคะแนน ${given.length} รายการ`
            + (plus ? ` · ให้ +${plus}` : '')
            + (minus ? ` · หัก ${minus}` : '')
            + ((sweepFrom || sweepTo) ? `\nช่วงวันที่: ${describeRange(sweepFrom, sweepTo)}` : '')
            + (noDateSkipped > 0
              ? `\nข้าม ${noDateSkipped} รายการที่ไม่มีวันที่ จึงเทียบช่วงไม่ได้`
              : ''),
        });
      }
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
    if (next) {
      setNotice({
        kind: 'ok',
        text: 'เปิดการรายงานปฏิบัติงานแล้ว — เจ้าหน้าที่ส่งรายงานได้ตามปกติ (ยังไม่มีการหักคะแนน)',
      });
      return;
    }

    // ---------------------------------------------------------------
    // กดปิด = ปิดรอบรายงานของวันนี้
    //
    // คนที่ออกเวรวันนี้แล้วแต่ยังไม่ส่งรายงาน → หัก -5 ทันที
    // หัวหน้ากรมเป็นคนสั่งปิดเอง จึงถือว่าตั้งใจปิดรอบ
    // (ตอนยังเปิดอยู่ ระบบจะไม่หักเลย เพราะยังส่งได้)
    // ---------------------------------------------------------------
    const { data: res, error: sweepErr } = await supabase.rpc('run_pps_report_penalty');

    if (sweepErr) {
      setNotice({
        kind: 'err',
        text: `ปิดรายงานแล้ว แต่หักคะแนนไม่สำเร็จ: ${sweepErr.message}`
          + ' — กด "ตรวจคะแนนทั้งหมด" เพื่อหักเติมภายหลัง',
      });
      return;
    }

    const paid = (res as { noreport_awarded?: number; skipped?: boolean; reason?: string } | null);
    if (paid?.skipped) {
      setNotice({
        kind: 'err',
        text: `ปิดรายงานแล้ว แต่ยังหักไม่ได้: ${paid.reason ?? 'ไม่ทราบสาเหตุ'}`,
      });
      return;
    }

    const n = paid?.noreport_awarded ?? 0;
    setNotice({
      kind: 'ok',
      text: n > 0
        ? `ปิดรายงานแล้ว · หัก -5 จำนวน ${n} รายการที่ออกเวรแล้วแต่ไม่ส่งรายงาน`
        : 'ปิดรายงานแล้ว — ไม่มีรายการที่ต้องหัก (ทุกคนที่ออกเวรวันนี้ส่งรายงานครบแล้ว)',
    });
  }

  /* ---------- Maintenance Mode (3 โหมด) ---------- */
  type MaintMode = 'off' | 'standard' | 'readonly' | 'emergency';

  const MAINT_LABELS: Record<MaintMode, string> = {
    off:       'ปิด',
    standard:  '🔴 โหมดปิดปรับปรุงตามแผน',
    readonly:  '🟡 โหมดอ่านอย่างเดียว',
    emergency: '⚠️ โหมดปิดระบบฉุกเฉิน',
  };

  async function setMaintenanceMode(mode: MaintMode) {
    if (!officer || !settings || busy || missingMaintCol) return;
    const prev = (settings.maintenance_mode as string) || 'off';

    setSettings({ ...settings, maintenance_mode: mode });
    setNotice(null);

    const { error } = await supabase.from('system_settings').update({
      maintenance_mode: mode,
      updated_at: new Date().toISOString(),
      updated_by: officer.id,
      updated_by_name: officer.name,
    }).eq('id', 1);

    if (error) {
      setSettings({ ...settings, maintenance_mode: prev });
      setNotice({ kind: 'err', text: `เปลี่ยนโหมดไม่สำเร็จ: ${error.message}` });
      return;
    }

    await supabase.from('audit_logs').insert({
      action: 'SET_MAINTENANCE_MODE',
      target_type: 'system',
      performed_by: officer.id,
      performed_by_name: officer.name,
      details: { from: prev, to: mode },
    });

    const TEXTS: Record<MaintMode, string> = {
      off:       'ปิดโหมดปิดปรับปรุง — ทุกคนใช้งานได้ตามปกติ',
      standard:  'เปิดโหมดปิดปรับปรุงตามแผน — เจ้าหน้าที่ทุกคนเห็นหน้าแจ้งเตือน (หัวหน้ากรมเข้าได้)',
      readonly:  'เปิดโหมดอ่านอย่างเดียว — เจ้าหน้าที่ดูข้อมูลได้แต่ทำรายการไม่ได้',
      emergency: 'เปิดโหมดปิดระบบฉุกเฉิน — ล็อกทุกช่องทาง (เฉพาะหัวหน้ากรมเข้าได้)',
    };
    setNotice({ kind: 'ok', text: TEXTS[mode] });
  }

  /** บันทึกหัวข้อ + ข้อความรอง + เนื้อหา + เวลานับถอยหลัง */
  async function saveMaintenanceMessage() {
    if (!officer || !settings || busy) return;

    const etaIso = maintEtaDraft ? new Date(maintEtaDraft).toISOString() : null;

    const { error } = await supabase.from('system_settings').update({
      maintenance_title: maintTitleDraft.trim() || null,
      maintenance_subtitle: maintSubtitleDraft.trim() || null,
      maintenance_message: maintMsgDraft.trim() || null,
      maintenance_eta: etaIso,
      maintenance_eta_label: maintEtaLabelDraft.trim() || null,
      updated_at: new Date().toISOString(),
      updated_by: officer.id,
      updated_by_name: officer.name,
    }).eq('id', 1);

    if (error) {
      setNotice({ kind: 'err', text: `บันทึกไม่สำเร็จ: ${error.message}` });
      return;
    }

    setSettings({
      ...settings,
      maintenance_title: maintTitleDraft.trim() || null,
      maintenance_subtitle: maintSubtitleDraft.trim() || null,
      maintenance_message: maintMsgDraft.trim() || null,
      maintenance_eta: etaIso,
      maintenance_eta_label: maintEtaLabelDraft.trim() || null,
    });
    setNotice({ kind: 'ok', text: 'บันทึกข้อมูล maintenance แล้ว' });
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
                  onClick={() => runPointsSweep(SWEEP_BUTTONS.map((b) => b.key))}
                  disabled={!autoPoints || busy}
                  className="btn-secondary text-xs py-2 px-3 flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="ตรวจและให้คะแนนที่ค้างทั้งหมดตามทุกเกณฑ์"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  ตรวจคะแนนค้างทั้งหมด
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

          {/* ── ตรวจคะแนนค้าง แยกรายกฎ ── */}
          <div className="card p-4 sm:p-5">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center flex-shrink-0">
                <Award size={20} className="text-amber-400" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-white">ตรวจสอบคะแนนค้างรายเกณฑ์</h2>
                <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                  ถ้าเครื่องล่มหรือปิดเบราว์เซอร์ก่อนคะแนนจะบันทึก
                  กดปุ่มของเกณฑ์นั้นเพื่อให้คะแนนที่ค้างย้อนหลังได้
                  <br />
                  <strong className="text-amber-400">ตรวจทั้งประวัติในระบบทุกรายการ</strong> —
                  ไม่จำกัดเฉพาะเดือนนี้ และกดซ้ำได้โดยไม่ให้คะแนนซ้ำ
                </p>
              </div>
            </div>

            {/* ---------- ช่วงวันที่สำหรับสแกน ---------- */}
            <div className="mt-3 p-3 rounded-lg border border-blue-900/50 bg-navy-800/30">
              <div className="flex items-center gap-1.5 mb-2">
                <CalendarDays size={13} className="text-amber-400" />
                <span className="text-xs font-semibold text-white">ช่วงวันที่ที่จะสแกน</span>
                <span className="text-[10px] text-gray-500">เว่งไว้เพื่อความเป็นธรรม</span>
              </div>

              {/* ตัวเลือกลัด */}
              <div className="flex flex-wrap gap-1 mb-2">
                {([
                  ['all', 'ทั้งหมด'],
                  ['today', 'วันนี้'],
                  ['last7', '7 วันล่าสุด'],
                  ['last30', '30 วันล่าสุด'],
                  ['thisMonth', 'เดือนนี้'],
                  ['lastMonth', 'เดือนก่อน'],
                ] as Array<[SweepDatePreset, string]>).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => {
                      const r = presetRange(key);
                      setSweepPreset(key);
                      setSweepFrom(r.from);
                      setSweepTo(r.to);
                    }}
                    className={`px-2 py-1 rounded text-[11px] border transition-colors ${
                      sweepPreset === key
                        ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                        : 'border-blue-900/40 text-gray-400 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* เลือกเอง */}
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
                  <span>ตั้งแต่</span>
                  <input
                    type="date"
                    value={sweepFrom}
                    max={sweepTo || undefined}
                    onChange={(e) => {
                      setSweepFrom(e.target.value);
                      if (!sweepTo || (e.target.value && e.target.value > sweepTo)) {
                        setSweepTo(e.target.value);
                      }
                      setSweepPreset('all');
                    }}
                    className="bg-navy-900 border border-blue-900/50 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-amber-500"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
                  <span>ถึง</span>
                  <input
                    type="date"
                    value={sweepTo}
                    min={sweepFrom || undefined}
                    onChange={(e) => {
                      setSweepTo(e.target.value);
                      setSweepPreset('all');
                    }}
                    className="bg-navy-900 border border-blue-900/50 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-amber-500"
                  />
                </label>
                {(sweepFrom || sweepTo) && (
                  <button
                    onClick={() => { setSweepFrom(''); setSweepTo(''); setSweepPreset('all'); }}
                    className="text-[11px] text-gray-500 hover:text-white"
                  >
                    ล้าง
                  </button>
                )}
              </div>

              <p className="text-[11px] text-gray-500 mt-1.5">
                กำลังสแกน: <span className="text-amber-300">{describeRange(sweepFrom, sweepTo)}</span>
                {' · '}แต่ละเกณฑ์ใช้วันที่ของตัวเอง
                {' · '}รายการที่ยังไม่เคยได้คะแนนจะได้เฉพาะในช่วงนี้
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {SWEEP_BUTTONS.map((b) => (
                <button
                  key={b.key}
                  onClick={() => runPointsSweep([b.key])}
                  disabled={!autoPoints || busy}
                  title={`กดเพื่อสแกนเฉพาะเกณฑ์นี้ — ${b.hint}`}
                  className="text-left p-2.5 rounded-lg border border-blue-900/50 hover:border-amber-500/40
                             disabled:opacity-40 disabled:cursor-not-allowed transition-colors
                             bg-navy-800/40 hover:bg-navy-800/70"
                >
                  <span className="flex items-center gap-1.5">
                    {busy
                      ? <Loader2 size={12} className="animate-spin text-amber-400" />
                      : <Sparkles size={12} className={b.tone} />}
                    <span className="text-xs font-semibold text-white leading-tight">
                      {b.label}
                    </span>
                  </span>
                  <span className="block text-[10px] text-gray-500 mt-1 leading-snug">
                    {b.hint}
                  </span>
                </button>
              ))}
            </div>

            {!autoPoints && (
              <p className="text-[11px] text-amber-400 mt-3 flex items-center gap-1.5">
                <AlertTriangle size={12} /> ต้องเปิดสวิตช์ PPS Engine ก่อน จึงจะตรวจคะแนนค้างได้
              </p>
            )}
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

          {/* ── 📊 Storage Chart & Cleanup (ศูนย์กลาง) ── */}
      <StorageCleanupPage />

      {/* ── โหมดปิดปรับปรุงระบบ (3 โหมด) ── */}
          <div className={`card p-4 sm:p-5 border-2 ${
            missingMaintCol ? 'border-gray-700'
              : settings?.maintenance_mode === 'emergency' ? 'border-red-500/50'
              : settings?.maintenance_mode === 'readonly' ? 'border-yellow-500/40'
              : settings?.maintenance_mode === 'standard' ? 'border-amber-500/40'
              : 'border-gray-700'
          }`}>
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                missingMaintCol ? 'bg-navy-800 text-gray-600'
                  : settings?.maintenance_mode === 'emergency' ? 'bg-red-500/15 text-red-400'
                  : settings?.maintenance_mode === 'readonly' ? 'bg-yellow-500/15 text-yellow-400'
                  : settings?.maintenance_mode === 'standard' ? 'bg-amber-500/15 text-amber-400'
                  : 'bg-navy-800 text-gray-500'
              }`}
              >
                <Wrench size={20} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-white">โหมดปิดปรับปรุงระบบ</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {missingMaintCol
                    ? 'ยังใช้ไม่ได้ — ต้องรัน migration 0051 + 0053 ก่อน'
                    : `สถานะปัจจุบัน: ${MAINT_LABELS[(settings?.maintenance_mode as MaintMode) ?? 'off']}`}
                </p>
              </div>
            </div>

            {/* Toggle เปิด/ปิด */}
            {!missingMaintCol && (
              <div className="flex items-center justify-between mb-4 p-3 rounded-lg bg-navy-900/50 border border-gray-800">
                <span className="text-sm font-semibold text-white">
                  {settings?.maintenance_mode && settings.maintenance_mode !== 'off'
                    ? 'เปิดใช้งานอยู่' : 'ปิดอยู่'}
                </span>
                <button
                  onClick={() => void setMaintenanceMode(
                    settings?.maintenance_mode && settings.maintenance_mode !== 'off'
                      ? 'off' : 'standard'
                  )}
                  disabled={busy}
                  className={`relative w-16 h-8 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${
                    settings?.maintenance_mode && settings.maintenance_mode !== 'off'
                      ? 'bg-red-500' : 'bg-navy-600'
                  }`}
                  aria-label="เปิด/ปิดโหมดปิดปรับปรุง"
                  aria-pressed={!!settings?.maintenance_mode && settings.maintenance_mode !== 'off'}
                >
                  <div className={`absolute top-1 left-1 w-6 h-6 bg-white rounded-full shadow-lg transition-transform ${
                    settings?.maintenance_mode && settings.maintenance_mode !== 'off' ? 'translate-x-8' : ''
                  }`}
                  />
                </button>
              </div>
            )}

            {/* Mode Badge — เลือกหมวดหมู่เมื่อเปิดอยู่ */}
            {!missingMaintCol && settings?.maintenance_mode && settings.maintenance_mode !== 'off' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
                {(['standard', 'readonly', 'emergency'] as MaintMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => void setMaintenanceMode(m)}
                    disabled={busy}
                    className={`px-3 py-2.5 rounded-lg text-xs font-semibold border-2 transition-colors disabled:opacity-50 text-left ${
                      settings.maintenance_mode === m
                        ? m === 'standard' ? 'border-red-500 bg-red-500/15 text-red-300'
                        : m === 'readonly' ? 'border-yellow-500 bg-yellow-500/15 text-yellow-300'
                        : 'border-orange-500 bg-orange-500/15 text-orange-300'
                        : 'border-gray-700 bg-navy-900/50 text-gray-500 hover:border-gray-600'
                    }`}
                  >
                    {m === 'standard' && '🔴 โหมดปิดปรับปรุงตามแผน'}
                    {m === 'readonly' && '🟡 โหมดอ่านอย่างเดียว'}
                    {m === 'emergency' && '⚠️ โหมดปิดระบบฉุกเฉิน'}
                    <div className="text-[9px] font-normal mt-0.5 leading-tight">
                      {m === 'standard' && 'บล็อกทุกคน ยกเว้นหัวหน้ากรม'}
                      {m === 'readonly' && 'ดูได้ ทำรายการไม่ได้'}
                      {m === 'emergency' && 'ล็อกทั้งหมดด่วน'}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* หัวข้อ + เนื้อหา — รูปแบบเดียวกับฟอร์มประกาศ */}
            {!missingMaintCol && (
              <div className="pt-3 border-t border-gray-800 space-y-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">หัวข้อ *</label>
                  <input
                    className="input-field w-full"
                    placeholder="เช่น ปิดปรับปรุงระบบชั่วคราว"
                    value={maintTitleDraft}
                    onChange={(e) => setMaintTitleDraft(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">ข้อความรอง (ใต้หัวข้อ)</label>
                  <input
                    className="input-field w-full"
                    placeholder="เช่น ระบบอยู่ระหว่างการบำรุงรักษา กรุณารอสักครู่"
                    value={maintSubtitleDraft}
                    onChange={(e) => setMaintSubtitleDraft(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">เนื้อหา *</label>
                  <textarea
                    className="input-field w-full resize-none"
                    rows={4}
                    placeholder="เช่น ปิดปรับปรุงระบบฐานข้อมูล คาดว่าจะแล้วเสร็จเวลา 18:00 น. (พิมพ์ขึ้นบรรทัดใหม่ได้)"
                    value={maintMsgDraft}
                    onChange={(e) => setMaintMsgDraft(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">ข้อความเหนือนับถอยหลัง (พิมพ์เองได้)</label>
                  <input
                    className="input-field w-full"
                    placeholder="เช่น คาดว่าจะเสร็จภายใน"
                    value={maintEtaLabelDraft}
                    onChange={(e) => setMaintEtaLabelDraft(e.target.value)}
                  />
                  <div className="text-[10px] text-gray-600 mt-1">
                    ปล่อยว่าง = ใช้ข้อความเริ่มต้น "คาดว่าจะเสร็จภายใน"
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">วัน-เวลาที่คาดว่าจะเสร็จ (นับถอยหลัง)</label>
                  <input
                    type="datetime-local"
                    className="input-field w-full"
                    value={maintEtaDraft}
                    onChange={(e) => setMaintEtaDraft(e.target.value)}
                  />
                  <div className="text-[10px] text-gray-600 mt-1">
                    ระบบจะแสดงวันที่ + จำนวนวันที่เหลืออัตโนมัติ · ปล่อยว่าง = ไม่นับถอยหลัง
                  </div>
                </div>
                <button
                  onClick={saveMaintenanceMessage}
                  disabled={busy}
                  className="btn btn-outline text-xs inline-flex items-center gap-1.5"
                >
                  <Save size={12} />
                  บันทึกทั้งหมด
                </button>
              </div>
            )}

            {/* ตัวอย่างหน้าจอ */}
            {settings?.maintenance_mode && settings.maintenance_mode !== 'off' && (
              <div className="mt-4 pt-3 border-t border-gray-800">
                <div className="text-[10px] text-gray-500 mb-1.5">ตัวอย่างหน้าจอที่เจ้าหน้าที่จะเห็น</div>
                <div className="rounded-lg bg-navy-950 border border-gray-800 p-4 text-center">
                  <Wrench size={20} className={`mx-auto mb-2 ${
                    settings.maintenance_mode === 'emergency' ? 'text-red-400/70'
                      : settings.maintenance_mode === 'readonly' ? 'text-yellow-400/70'
                      : 'text-amber-400/60'
                  }`} />
                  <div className="text-xs font-bold text-white">
                    {settings.maintenance_title || 'ปิดปรับปรุงระบบชั่วคราว'}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    {settings.maintenance_mode === 'emergency'
                      ? 'ระบบกำลังปิดปรับปรุงกรณีเร่งด่วน'
                      : settings.maintenance_mode === 'readonly'
                        ? 'ดูข้อมูลได้อย่างเดียว ไม่สามารถทำรายการได้'
                        : 'ระบบอยู่ระหว่างการบำรุงรักษา'}
                  </div>
                  {settings.maintenance_message && (
                    <div className="text-[10px] text-amber-400/80 mt-2 whitespace-pre-wrap">
                      {settings.maintenance_message}
                    </div>
                  )}
                  {settings.maintenance_eta && (
                    <div className="mt-2 pt-2 border-t border-gray-800 text-left">
                      <div className="text-[9px] text-gray-500">
                        {(settings.maintenance_eta_label as string) || 'คาดว่าจะเสร็จภายใน'}
                      </div>
                      <div className="text-lg font-mono font-bold text-amber-400">
                        {(() => {
                          const diff = new Date(settings.maintenance_eta!).getTime() - Date.now();
                          if (diff <= 0) return 'ครบกำหนดแล้ว';
                          const d = Math.floor(diff / 86_400_000);
                          const h = Math.floor((diff % 86_400_000) / 3_600_000);
                          const m = Math.floor((diff % 3_600_000) / 60_000);
                          const s = Math.floor((diff % 60_000) / 1000);
                          const p = (n: number) => String(n).padStart(2, '0');
                          return `${p(h)}:${p(m)}:${p(s)}`;
                        })()}
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-[10px] text-gray-400">
                          📅 {(() => {
                            const d = new Date(settings.maintenance_eta!);
                            const TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
                            return `${d.getDate()} ${TH[d.getMonth()]} ${d.getFullYear() + 543}`;
                          })()}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-950/50 border border-blue-800 text-blue-300">
                          เหลือ {Math.max(0, Math.ceil((new Date(settings.maintenance_eta!).getTime() - Date.now()) / 86_400_000))} วัน
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
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
