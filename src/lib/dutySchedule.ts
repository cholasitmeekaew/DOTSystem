/* =============================================================
 * dutySchedule.ts
 * -------------------------------------------------------------
 * ตรรกะตารางเวรปฏิบัติงาน (migration 0028)
 *
 * กติกาการมองเห็นเวรของวันหนึ่ง ๆ:
 *   1) เริ่มจากตารางหลัก duty_schedules (วนซ้ำรายสัปดาห์)
 *   2) ถ้าวันนั้นมี schedule_overrides → ข้อมูลของวันนั้น "ทับ" ตารางหลัก
 *      (ลา / สลับเวร / เวรพิเศษ / หยุด)
 *   3) ใบลาที่อนุมัติแล้วจะถูกเขียนเป็น override อัตโนมัติ (source='leave_auto')
 *      → ยกเว้นการลงโทษขาดเวร
 * ============================================================= */

import type {
  DutySchedule, ScheduleOverride, ScheduleCellCode, ShiftCode, ShiftWindow, Officer,
  WorkReport, DutyLog,
} from './types';
import {
  WEEKDAY_SHORT, SHIFT_LABELS, OVERRIDE_TYPE_LABELS,
  WEEKDAY_SHIFT_WINDOWS, WEEKEND_SHIFT_WINDOWS, SERVER_HOURS, isWeekend,
} from './types';

/** ลำดับกะที่แสดงในตาราง */
export const SHIFT_ORDER: ShiftCode[] = ['s1', 's2'];

/**
 * ช่วงเวลาของแต่ละกะ ขึ้นอยู่กับประเภทวัน
 *   จันทร์–ศุกร์    เซิร์ฟเปิด 18:30–21:30
 *   เสาร์–อาทิตย์  เซิร์ฟเปิด 18:30–23:00
 */
export function shiftWindowsFor(weekday: number): Record<ShiftCode, ShiftWindow> {
  return isWeekend(weekday) ? WEEKEND_SHIFT_WINDOWS : WEEKDAY_SHIFT_WINDOWS;
}

export function shiftWindowFor(weekday: number, shift: ShiftCode): ShiftWindow {
  return shiftWindowsFor(weekday)[shift];
}

/** 'จันทร์–ศุกร์' | 'เสาร์–อาทิตย์' */
export function dayTypeLabel(weekday: number): string {
  return isWeekend(weekday) ? 'เสาร์–อาทิตย์' : 'จันทร์–ศุกร์';
}

/** เวลาเปิด–ปิดเซิร์ฟเวอร์ของวันนั้น */
export function serverHoursFor(weekday: number): { start: string; end: string } {
  return isWeekend(weekday) ? SERVER_HOURS.weekend : SERVER_HOURS.weekday;
}

export interface WeekDay {
  /** 0 = อาทิตย์ ... 6 = เสาร์ */
  weekday: number;
  /** YYYY-MM-DD */
  date: string;
  label: string;
  /** วันนี้หรือไม่ */
  isToday: boolean;
  dayOfMonth: number;
}

/** วันอาทิตย์ของสัปดาห์ที่มี anchorIso อยู่ */
export function startOfWeek(anchorIso: string): Date {
  const d = new Date(`${anchorIso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return d;
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function toIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** สร้าง 7 วันของสัปดาห์ (เริ่มวันอาทิตย์) */
export function buildWeekDays(anchorIso: string): WeekDay[] {
  const start = startOfWeek(anchorIso);
  const todayIso = toIso(new Date());
  const days: WeekDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const date = toIso(d);
    days.push({
      weekday: d.getDay(),
      date,
      label: WEEKDAY_SHORT[d.getDay()] ?? String(d.getDay()),
      isToday: date === todayIso,
      dayOfMonth: d.getDate(),
    });
  }
  return days;
}

export function shiftWeek(anchorIso: string, delta: number): string {
  const start = startOfWeek(anchorIso);
  start.setDate(start.getDate() + delta * 7);
  return toIso(start);
}

/* ---------- ผลลัพธ์ต่อช่องตาราง ---------- */

export interface RosterCell {
  date: string;
  shift: ScheduleCellCode;
  officerId: string | null;
  officerName: string | null;
  /** ป้ายสถานะพิเศษ: ลา / เวรสลับ / เวรพิเศษ / หยุด */
  badge: string | null;
  overrideType: ScheduleOverride['override_type'] | null;
  /** มาจาก schedule_overrides หรือไม่ */
  fromOverride: boolean;
  /** ช่วงเวลาของกะนี้ในวันนั้น (คำนวณจากประเภทวัน) */
  startTime: string;
  endTime: string;
  /** เป็นวันหยุด (เสาร์–อาทิตย์) หรือไม่ */
  weekend: boolean;
}

export interface WeeklyRoster {
  days: WeekDay[];
  /** rows[shift][date] = RosterCell */
  rows: Record<ScheduleCellCode, Record<string, RosterCell>>;
  /** จำนวนช่องที่มีคนจริง */
  assignedCount: number;
  /** จำนวนช่องที่ถูกทำเครื่องหมายว่าไม่มีคน (เช่น ว่าง/ลา) */
  gapCount: number;
}

export function buildWeeklyRoster(params: {
  anchorIso: string;
  schedules: DutySchedule[];
  overrides: ScheduleOverride[];
  officers: Officer[];
  /** เวลาเริ่ม/จบของแต่ละกะ ใช้แสดงผลในหัวตาราง */
  shiftTimes?: Record<ScheduleCellCode, { start: string; end: string }>;
}): WeeklyRoster {
  const { anchorIso, schedules, overrides, officers } = params;
  void params.shiftTimes;
  const days = buildWeekDays(anchorIso);
  const daySet = new Set(days.map((d) => d.date));

  const nameById = new Map(officers.map((o) => [o.id, o.name]));
  const scheduleByCell = new Map<string, DutySchedule>();
  for (const s of schedules) {
    if (s.is_active === false) continue;
    scheduleByCell.set(`${s.weekday}:${s.shift_code}`, s);
  }
  const overrideByCell = new Map<string, ScheduleOverride>();
  for (const o of overrides) {
    if (!daySet.has(o.override_date)) continue;
    overrideByCell.set(`${o.override_date}:${o.shift_code}`, o);
  }

  const rows = {} as Record<ScheduleCellCode, Record<string, RosterCell>>;
  let assignedCount = 0;
  let gapCount = 0;

  for (const shift of SHIFT_ORDER) {
    rows[shift] = {};
    for (const day of days) {
      const key = `${day.date}:${shift}`;
      const override = overrideByCell.get(key);
      const base = scheduleByCell.get(`${day.weekday}:${shift}`);

      let officerId: string | null = base?.officer_id ?? null;
      let fromOverride = false;
      let badge: string | null = null;
      let overrideType: ScheduleOverride['override_type'] | null = null;

      if (override) {
        fromOverride = true;
        overrideType = override.override_type;
        badge = OVERRIDE_TYPE_LABELS[override.override_type] ?? null;
        // 'off' = หยุดประจำสัปดาห์นี้ → ไม่มีคน
        if (override.override_type === 'off') {
          officerId = null;
        } else {
          officerId = override.officer_id ?? null;
        }
      }

      const name = officerId ? nameById.get(officerId) ?? null : null;
      if (name) assignedCount++;
      else gapCount++;

      // เวลาอ้างอิงจากตารางเวลาจริงของเซิร์ฟเวอร์ (จ-ศ ต่างจาก ส-อา)
      // ถ้า duty_schedules มีเวลากำหนดเองไว้ ให้ใช้ค่านั้นแทน
      const fallback = shiftWindowFor(day.weekday, shift);
      rows[shift][day.date] = {
        date: day.date,
        shift,
        officerId,
        officerName: name,
        badge,
        overrideType,
        fromOverride,
        startTime: base?.start_time || fallback.start,
        endTime: base?.end_time || fallback.end,
        weekend: isWeekend(day.weekday),
      };
    }
  }

  return { days, rows, assignedCount, gapCount };
}

/**
 * หา id ของเจ้าหน้าที่ที่ "มีผังเวร" ในช่วงวันที่กำหนด
 * ใช้เป็นเงื่อนไขตั้งต้นก่อนตัดคะแนนขาดเวร — คนที่ไม่ได้ลงตารางไม่ถูกตัดคะแนน
 */
export function resolveScheduledOfficerIds(params: {
  schedules: DutySchedule[];
  overrides: ScheduleOverride[];
  fromIso: string;
  toIso: string;
}): Set<string> {
  const { schedules, overrides, fromIso, toIso: toDateIso } = params;
  const ids = new Set<string>();

  for (const o of overrides) {
    if (!o.officer_id) continue;
    if (o.override_date < fromIso || o.override_date > toDateIso) continue;
    if (o.override_type === 'off') continue;   // หยุด = ไม่ถือว่ามีเวร
    ids.add(o.officer_id);
  }

  for (const s of schedules) {
    if (s.is_active === false) continue;
    if (!s.officer_id) continue;
    // ตารางหลักเป็นรายสัปดาห์ → ดูว่าสัปดาห์นั้นทับกับช่วงที่ถามไหม
    const weeklyDates = datesForWeekdayBetween(fromIso, toDateIso, s.weekday);
    if (weeklyDates.length === 0) continue;
    // ถ้าทุกวันที่ตรงกันถูก override เป็น 'off' ให้ถือว่ามีเวรจริงเฉพาะวันที่ยังไม่ถูกปิด
    const allOff = weeklyDates.every((d) =>
      overrides.some((o) => o.override_date === d && o.shift_code === s.shift_code && o.override_type === 'off'),
    );
    if (!allOff) ids.add(s.officer_id);
  }

  return ids;
}

/** วันที่ที่ตรงกับ weekday ภายในช่วง [fromDate, toDate] */
function datesForWeekdayBetween(fromDate: string, toDate: string, weekday: number): string[] {
  const out: string[] = [];
  const d = new Date(`${fromDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return out;
  for (let i = 0; i <= 400; i++) {
    const cur = new Date(d);
    cur.setDate(d.getDate() + i);
    const iso = toIso(cur);
    if (iso > toDate) break;
    if (cur.getDay() === weekday) out.push(iso);
  }
  return out;
}

/* ---------- ตรวจจับช่องว่าง / ขาดเวร ---------- */

export interface RosterGap {
  date: string;
  weekday: number;
  shift: ScheduleCellCode;
}

/** ช่องตารางที่ไม่มีคนและไม่ได้ทำเครื่องหมายว่าลา/หยุด */
export function findRosterGaps(roster: WeeklyRoster): RosterGap[] {
  const gaps: RosterGap[] = [];
  for (const shift of SHIFT_ORDER) {
    for (const day of roster.days) {
      const cell = roster.rows[shift]?.[day.date];
      if (!cell) continue;
      if (cell.officerId) continue;
      if (cell.overrideType === 'leave' || cell.overrideType === 'off') continue;
      gaps.push({ date: day.date, weekday: day.weekday, shift });
    }
  }
  return gaps;
}

/* ---------- ตรวจจับ "ออกเวรไม่ส่งรายงาน" และ "ขาดเวร 1 สัปดาห์" ---------- */

/** duty_log ที่ปิดแล้วแต่ไม่มีรายงานปฏิบัติงานผูกไว้ */
export function findLogsMissingReport(
  logs: DutyLog[],
  reports: WorkReport[],
): DutyLog[] {
  const reported = new Set(
    reports.map((r) => r.duty_log_id).filter((id): id is string => !!id),
  );
  return logs.filter((log) => {
    if (!log.clock_out || log.deleted_at) return false;
    if (log.checkout_method === 'forced') return false;
    if (reported.has(log.id)) return false;
    return true;
  });
}

/**
 * เจ้าหน้าที่ที่ "ไม่เข้าเวรเลย" ในช่วง 7 วันที่ผ่านมา
 * (ไม่นับคนที่กำลังลาอยู่ และไม่นับคนที่ไม่ได้ active)
 */
export function findWeeklyAbsentees(params: {
  officers: Officer[];
  logs: DutyLog[];
  approvedLeaveOfficerIds: string[];
  days?: number;
}): Officer[] {
  const { officers, logs, approvedLeaveOfficerIds, days = 7 } = params;
  const today = new Date();
  const since = new Date(today);
  since.setDate(since.getDate() - days);
  const sinceIso = toIso(since);
  const todayIso = toIso(today);

  const worked = new Set<string>();
  for (const log of logs) {
    if (!log.officer_id || log.deleted_at || !log.clock_in) continue;
    const d = log.clock_in.slice(0, 10);
    if (d < sinceIso || d > todayIso) continue;
    worked.add(log.officer_id);
  }

  const onLeave = new Set(approvedLeaveOfficerIds);
  return officers.filter(
    (o) => o.status === 'active' && !worked.has(o.id) && !onLeave.has(o.id),
  );
}

/** สรุปสถานะช่องตารางสำหรับแสดงในหัวตาราง */
export function cellToneClass(cell: RosterCell): string {
  if (cell.overrideType === 'leave') return 'bg-blue-500/10 border-blue-500/40 text-blue-300';
  if (cell.overrideType === 'off') return 'bg-navy-800 border-blue-900/40 text-gray-500';
  if (cell.overrideType === 'swap') return 'bg-amber-500/10 border-amber-500/40 text-amber-300';
  if (cell.overrideType === 'extra') return 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300';
  if (!cell.officerId) return 'bg-navy-900/60 border-red-500/25 text-gray-600';
  return 'bg-navy-700/60 border-blue-900/50 text-gray-200';
}

export { SHIFT_LABELS };