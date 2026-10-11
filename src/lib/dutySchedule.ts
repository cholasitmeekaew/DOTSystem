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

/* ---------- ผลลัพธ์ต่อช่องตาราง (รองรับหลายคนต่อกะ) ---------- */

/** กำลังพลที่ต้องการเมื่อยังไม่ได้กำหนด */
export const DEFAULT_REQUIRED_OFFICERS = 2;

/** 1 คนในช่องกะของวันนั้น */
export interface RosterMember {
  officerId: string;
  officerName: string;
  /** ป้ายเฉพาะของคนนี้: ลา / เวรสลับ / เวรพิเศษ */
  badge: string | null;
  /** มาจาก schedule_overrides หรือผังประจำ */
  fromOverride: boolean;
}

export interface RosterCell {
  date: string;
  shift: ScheduleCellCode;
  members: RosterMember[];
  /** ช่วงเวลาของกะนี้ในวันนั้น (คำนวณจากประเภทวัน) */
  startTime: string;
  endTime: string;
  /** เป็นวันหยุด (เสาร์–อาทิตย์) หรือไม่ */
  weekend: boolean;
  /** จำนวนคนที่ต้องการ */
  required: number;
  /** ช่องนี้มีข้อยกเว้นอยู่ */
  fromOverride: boolean;
  /** ปิดทั้งช่องกะ */
  closed: boolean;
}

export interface WeeklyRoster {
  days: WeekDay[];
  rows: Record<ScheduleCellCode, Record<string, RosterCell>>;
  /** จำนวนช่องที่มีคนจริง */
  assignedCount: number;
  /** จำนวนช่องที่ยังขาดคนจากกำลังพลที่กำหนด */
  understaffedCount: number;
  /** จำนวนช่องที่ไม่มีคนเลย */
  gapCount: number;
}

/**
 * สร้างตารางเวรรายสัปดาห์ที่ resolve แล้ว
 *
 * กติกาการรวม (ต่อช่องกะของ 1 วัน):
 *   1. มี override 'off' ที่ officer_id = null  → ปิดทั้งช่อง
 *   2. มี override 'swap'                      → ใช้คนใน swap แทนผังประจำทั้งช่อง
 *   3. ไม่งั้น → เริ่มจากผังประจำ (รองรับหลายคน)
 *   4. ตัดคนที่ 'leave' / 'off' เฉพาะบุคคลออก
 *   5. เติมคนที่ 'extra'
 */
export function buildWeeklyRoster(params: {
  anchorIso: string;
  schedules: DutySchedule[];
  overrides: ScheduleOverride[];
  officers: Officer[];
}): WeeklyRoster {
  const { anchorIso, schedules, overrides, officers } = params;
  const days = buildWeekDays(anchorIso);
  const daySet = new Set(days.map((d) => d.date));

  const nameById = new Map(officers.map((o) => [o.id, o.name]));

  // ผังประจำ: weekday+shift → หลายแถว (หลายคน)
  const baseBySlot = new Map<string, DutySchedule[]>();
  for (const s of schedules) {
    if (s.is_active === false) continue;
    const key = `${s.weekday}:${s.shift_code}`;
    const list = baseBySlot.get(key) ?? [];
    list.push(s);
    baseBySlot.set(key, list);
  }

  // ข้อยกเว้น: date+shift → หลายแถว
  const overrideBySlot = new Map<string, ScheduleOverride[]>();
  for (const o of overrides) {
    if (!daySet.has(o.override_date)) continue;
    const key = `${o.override_date}:${o.shift_code}`;
    const list = overrideBySlot.get(key) ?? [];
    list.push(o);
    overrideBySlot.set(key, list);
  }

  const rows = {} as Record<ScheduleCellCode, Record<string, RosterCell>>;
  let assignedCount = 0;
  let understaffedCount = 0;
  let gapCount = 0;

  for (const shift of SHIFT_ORDER) {
    rows[shift] = {};
    for (const day of days) {
      const base = baseBySlot.get(`${day.weekday}:${shift}`) ?? [];
      const ovs = overrideBySlot.get(`${day.date}:${shift}`) ?? [];

      const closed = ovs.some((o) => !o.officer_id && o.override_type === 'off');
      const swaps = ovs.filter((o) => o.override_type === 'swap' && o.officer_id);
      const leaves = ovs.filter((o) => o.override_type === 'leave' && o.officer_id);
      const extras = ovs.filter((o) => o.override_type === 'extra' && o.officer_id);
      const offPeople = ovs.filter((o) => o.override_type === 'off' && o.officer_id);

      const badgeById = new Map<string, string>();
      for (const o of leaves) badgeById.set(o.officer_id!, OVERRIDE_TYPE_LABELS.leave);
      for (const o of swaps) badgeById.set(o.officer_id!, OVERRIDE_TYPE_LABELS.swap);
      for (const o of extras) badgeById.set(o.officer_id!, OVERRIDE_TYPE_LABELS.extra);

      let pool: string[];
      if (closed) {
        pool = [];
      } else if (swaps.length > 0) {
        pool = swaps.map((o) => o.officer_id!);      // สลับเวร = ใช้คนชุดใหม่ล้วน
      } else {
        pool = base.map((s) => s.officer_id).filter((id): id is string => !!id);
      }

      const removed = new Set<string>([
        ...leaves.map((o) => o.officer_id!),
        ...offPeople.map((o) => o.officer_id!),
      ]);

      const members: RosterMember[] = [];
      const seen = new Set<string>();
      for (const id of pool) {
        if (removed.has(id) || seen.has(id)) continue;
        seen.add(id);
        members.push({
          officerId: id,
          officerName: nameById.get(id) ?? 'ไม่ทราบชื่อ',
          badge: badgeById.get(id) ?? null,
          fromOverride: ovs.some((o) => o.officer_id === id),
        });
      }
      for (const o of extras) {
        const id = o.officer_id!;
        if (seen.has(id)) continue;
        seen.add(id);
        members.push({
          officerId: id,
          officerName: nameById.get(id) ?? 'ไม่ทราบชื่อ',
          badge: OVERRIDE_TYPE_LABELS.extra,
          fromOverride: true,
        });
      }

      // กำลังพลที่ต้องการ: override ของวันนั้น > ผังประจำ > ค่าเริ่มต้น
      const ovRequired = ovs.find((o) => typeof o.required_officers === 'number')?.required_officers;
      const baseRequired = base.find((s) => typeof s.required_officers === 'number')?.required_officers;
      const required = ovRequired ?? baseRequired ?? DEFAULT_REQUIRED_OFFICERS;

      const fallback = shiftWindowFor(day.weekday, shift);

      if (members.length > 0) assignedCount++;
      else gapCount++;
      if (members.length > 0 && members.length < required) understaffedCount++;

      rows[shift][day.date] = {
        date: day.date,
        shift,
        members,
        startTime: base[0]?.start_time || fallback.start,
        endTime: base[0]?.end_time || fallback.end,
        weekend: isWeekend(day.weekday),
        required,
        fromOverride: ovs.length > 0,
        closed,
      };
    }
  }

  return { days, rows, assignedCount, understaffedCount, gapCount };
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
    if (o.override_type === 'leave' || o.override_type === 'off') continue; // ไม่มีเวรจริง
    ids.add(o.officer_id);
  }

  for (const s of schedules) {
    if (s.is_active === false) continue;
    if (!s.officer_id) continue;
    const weeklyDates = datesForWeekdayBetween(fromIso, toDateIso, s.weekday);
    if (weeklyDates.length === 0) continue;
    // ถ้าทุกวันของสัปดาห์นั้นถูก override ออก (ลา/ปิด) ให้ถือว่าไม่มีเวร
    const allRemoved = weeklyDates.every((d) =>
      overrides.some(
        (o) =>
          o.override_date === d &&
          o.shift_code === s.shift_code &&
          (o.override_type === 'off' ||
            (o.override_type === 'leave' && o.officer_id === s.officer_id)),
      ),
    );
    if (!allRemoved) ids.add(s.officer_id);
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
      if (cell.members.length > 0) continue;
      if (cell.closed) continue;        // ปิดทั้งช่อง = ตั้งใจ ไม่ถือว่าว่าง
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
  if (cell.closed) return 'bg-navy-800 border-blue-900/40 text-gray-500';
  if (cell.members.length === 0) return 'bg-navy-900/60 border-red-500/25 text-gray-600';
  if (cell.members.length < cell.required) return 'bg-amber-500/[0.07] border-amber-500/35 text-gray-200';
  return 'bg-navy-700/60 border-emerald-500/25 text-gray-200';
}

/** ป้ายสถานะกำลังพลของช่อง: "กำลังพลครบ" / "ยังว่างอยู่" / "ยังไม่มีคน" */
export function cellStaffingLabel(cell: RosterCell): {
  text: string; tone: 'ok' | 'short' | 'empty' | 'closed';
} {
  if (cell.closed) return { text: 'ปิดเวร', tone: 'closed' };
  const n = cell.members.length;
  if (n === 0) return { text: 'ยังไม่มีคน', tone: 'empty' };
  if (n < cell.required) return { text: `ยังว่างอยู่ ${cell.required - n}`, tone: 'short' };
  return { text: 'กำลังพลครบ', tone: 'ok' };
}

/** สีของป้ายสถานะกำลังพล */
export function staffingToneClass(tone: 'ok' | 'short' | 'empty' | 'closed'): string {
  switch (tone) {
    case 'ok': return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
    case 'short': return 'bg-amber-500/15 text-amber-300 border-amber-500/40';
    case 'closed': return 'bg-navy-700 text-gray-500 border-blue-900/50';
    default: return 'bg-red-500/15 text-red-300 border-red-500/40';
  }
}

export { SHIFT_LABELS };