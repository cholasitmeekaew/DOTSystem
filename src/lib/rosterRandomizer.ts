/* =============================================================
 * rosterRandomizer.ts
 * -------------------------------------------------------------
 * สุ่มตารางเวรประจำสัปดาห์ โดยบังคับกติกา:
 *   1) ทุกช่องกะต้องมี "ผู้นำ" อย่างน้อย 1 คน (หัวหน้า / รอง / ผู้คุม)
 *   2) เติมกำลังพลให้ครโควตาของกะนั้น
 *   3) ห้ามสุ่มเจ้าหน้าที่ที่ลาในวันนั้น
 *   4) หนึ่งคนทำได้ไม่เกิน 1 กะต่อวัน (ไม่ให้ชนกัน)
 *   5) แจกแจงให้กระจาย: ใครได้กะน้อยกว่า ได้ก่อน
 * ============================================================= */

import type {
  Officer, OfficerRankRecord, DutySchedule, ScheduleOverride,
  ShiftCode, ScheduleCellCode,
} from './types';
import { SHIFT_LABELS } from './types';

/* ---------- การจัดกลุ่มผู้นำ ---------- */

/** sort_order ที่ถือว่าเป็นผู้นำ (1 = หัวหน้า, 2 = รอง/ผู้คุม) */
export const LEADER_SORT_ORDERS = [1, 2];

/**
 * ตำแหน่งนี้เป็นผู้นำหรือไม่
 * อิง officer_ranks.sort_order ก่อน (รองรับตำแหน่งที่หัวหน้ากรมสร้างเพิ่ม)
 * ถ้าไม่มีตารางอ้างอิง จะ fallback ไป rank_key ค่าเริ่มต้น
 */
export function isLeader(officer: Officer, ranks: OfficerRankRecord[] = []): boolean {
  const rec = ranks.find((r) => r.rank_key === officer.rank || r.label === officer.rank);
  if (rec) return LEADER_SORT_ORDERS.includes(rec.sort_order ?? 99);
  return officer.rank === 'commissioner' || officer.rank === 'inspector';
}

export function leaderLabel(officer: Officer, ranks: OfficerRankRecord[] = []): string {
  const rec = ranks.find((r) => r.rank_key === officer.rank || r.label === officer.rank);
  return rec?.label ?? officer.rank;
}

/* ---------- ตัวเลือก ---------- */

/** สถานะการลาที่ต้องกันออกจากการสุ่ม */
export interface LeaveRecord {
  officer_id: string | null;
  start_date: string;
  end_date: string;
}

/** officer_id ที่ลาอยู่ในวันนั้น (ครอบคลุมทั้งช่วงเริ่ม-จบ) */
export function onLeaveAt(leaves: LeaveRecord[], date: string): Set<string> {
  const ids = new Set<string>();
  for (const l of leaves) {
    if (!l.officer_id) continue;
    if (l.start_date <= date && date <= l.end_date) ids.add(l.officer_id);
  }
  return ids;
}

export interface RandomizeOptions {
  /** 7 วันของสัปดาห์ที่จะสุ่ม (ใช้วันที่จริง เพื่อเช็คการลาให้ตรงช่วงเวลา) */
  days: string[];
  shifts: ShiftCode[];
  /** ผังเดิม — ใช้อ่านค่า required ของแต่ละกะ */
  schedules: DutySchedule[];
  /** ข้อยกเว้นของสัปดาห์นี้ — ใช้ตัดคนที่ลา/สลับออก */
  overrides: ScheduleOverride[];
  /** การลาที่อนุมัติแล้วครอบคลุมสัปดาห์นี้ */
  leaves: LeaveRecord[];
  /** เจ้าหน้าที่ที่ active ทั้งหมด */
  officers: Officer[];
  ranks: OfficerRankRecord[];
  /** จำนวนคนต่อกะเมื่อไม่มีผังเดิม */
  defaultRequired: number;
  /** บังคับให้มีผู้นำทุกกะ (ปิดไว้ได้ถ้าอยากให้สุ่มตามโควตาอย่างเดียว) */
  requireLeader: boolean;
}

export interface RandomizeCell {
  date: string;
  weekday: number;
  shift: ShiftCode;
  shiftLabel: string;
  required: number;
  officerIds: string[];
  /** มีผู้นำในกะนี้แล้วหรือไม่ */
  hasLeader: boolean;
  /** ข้อความเตือน (ถ้ามีปัญหา) */
  issues: string[];
}

export interface RandomizeResult {
  cells: RandomizeCell[];
  /** จำนวนกะที่มีผู้นำแล้ว */
  slotsWithLeader: number;
  /** จำนวนกะที่สุ่มได้ไม่ครบโควตา */
  slotsUnderfilled: number;
  /** จำนวนช่องกะทั้งหมด */
  totalSlots: number;
  /** ข้อความสรุประดับรวบ */
  notes: string[];
  officersUsed: number;
}

/** รายการช่องกะที่ถูกปิด/ลา/สลับไว้แล้วของวันนั้น (ไม่ควรถูกสุ่มทับ) */
function blockedOfficerIds(
  overrides: ScheduleOverride[],
  date: string,
  shift: ScheduleCellCode,
): Set<string> {
  const blocked = new Set<string>();
  for (const o of overrides) {
    if (o.override_date !== date) continue;
    if (o.shift_code !== shift) continue;
    // off ทั้งช่อง = ไม่ต้องสุ่มช่องนี้เลย (คืน skip ทั้งช่อง)
    if (!o.officer_id && o.override_type === 'off') return new Set(['__all__']);
    if (o.officer_id) blocked.add(o.officer_id);
  }
  return blocked;
}

/**
 * จำนวนคนที่ต้องการของช่องกะ
 * ลำดับ: ค่าเฉพาะวันนี้ใน schedule_overrides → ค่าหลักใน duty_schedules → default
 * (migration 0030: duty_schedules.required_officers default 2)
 */
function requiredFor(
  schedules: DutySchedule[],
  overrides: ScheduleOverride[],
  date: string,
  weekday: number,
  shift: ShiftCode,
): number {
  const ov = overrides.find(
    (o) => o.override_date === date
      && o.shift_code === shift
      && typeof o.required_officers === 'number',
  );
  if (ov?.required_officers != null) return ov.required_officers;

  const base = schedules.find((s) => s.weekday === weekday && s.shift_code === shift);
  return base?.required_officers ?? 0;
}

/** สุ่มแบบ deterministic-seed ได้ เพื่อให้ "สุ่มใหม่" ได้คนละผลแน่นอน */
function shuffled<T>(list: T[], rand: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * สุ่มตารางเวรทั้งสัปดาห์
 * @param seed ใส่ตัวเลขเพื่อให้ผลทำซ้ำได้ (ใช้ตอนผู้ใช้กด "สุ่มใหม่" แล้วอยากคืนผลเดิม)
 */
export function randomizeWeeklyRoster(
  opts: RandomizeOptions,
  seed?: number,
): RandomizeResult {
  const {
    days, shifts, schedules, overrides, leaves, officers, ranks,
    defaultRequired, requireLeader,
  } = opts;

  // PRNG แบบง่าย เพื่อให้ผลซ้ำได้เมื่อส่ง seed เดิม
  let s = (seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };

  const active = officers.filter((o) => o.status === 'active');
  const leaders = active.filter((o) => isLeader(o, ranks));
  const staff = active.filter((o) => !isLeader(o, ranks));

  // นับจำนวนกะสะสมของแต่ละคนทั้งสัปดาห์ เพื่อกระจายให้เท่ากัน
  const weekLoad = new Map<string, number>();
  for (const o of active) weekLoad.set(o.id, 0);

  const cells: RandomizeCell[] = [];
  const notes: string[] = [];
  let slotsWithLeader = 0;
  let slotsUnderfilled = 0;

  for (const date of days) {
    // คนที่ถูกจัดให้ทำงานวันนี้แล้ว — กันชนกันระหว่างกะ 1 และกะ 2
    const usedToday = new Set<string>();
    // คนที่ลาอยู่จริงในวันนี้ (จาก officer_leaves ที่อนุมัติแล้ว)
    const leaveToday = onLeaveAt(leaves, date);
    // คำนวณจากวันที่จริงเสมอ กัน caller ส่ง weekday ไม่ตรงกับ date
    const weekday = new Date(`${date}T00:00:00`).getDay();

    for (const shift of shifts) {
      const issues: string[] = [];
      const blocked = blockedOfficerIds(overrides, date, shift);

      if (blocked.has('__all__')) {
        cells.push({
          date: date, weekday: weekday, shift,
          shiftLabel: SHIFT_LABELS[shift], required: 0, officerIds: [],
          hasLeader: false, issues: ['ปิดเวรไว้แล้ว — ไม่ได้สุ่ม'],
        });
        continue;
      }

      const need = requiredFor(schedules, overrides, date, weekday, shift) || defaultRequired;
      const pool = (list: Officer[]) => list.filter(
        (o) => !blocked.has(o.id) && !usedToday.has(o.id) && !leaveToday.has(o.id),
      );

      // 1) ผู้นำก่อนเสมอ
      const picked: Officer[] = [];
      let hasLeader = false;

      if (requireLeader) {
        const leaderPool = shuffled(pool(leaders), rand)
          .sort((a, b) => (weekLoad.get(a.id) ?? 0) - (weekLoad.get(b.id) ?? 0));
        if (leaderPool.length > 0) {
          picked.push(leaderPool[0]);
          hasLeader = true;
          usedToday.add(leaderPool[0].id);
          weekLoad.set(leaderPool[0].id, (weekLoad.get(leaderPool[0].id) ?? 0) + 1);
        } else {
          issues.push('ไม่มีผู้นำที่ว่างในวันนี้ (อาจลาอยู่หรือทำกะอื่นแล้ว)');
        }
      }

      // 2) เติมกำลังพลให้ครโควตา
      //    เรียงตามภาระทั้งสัปดาห์ก่อน แล้วสุ่มเฉพาะตัวที่ภาระเท่ากัน
      const remaining = shuffled(pool(staff), rand)
        .sort((a, b) => (weekLoad.get(a.id) ?? 0) - (weekLoad.get(b.id) ?? 0));

      for (const o of remaining) {
        if (picked.length >= need) break;
        picked.push(o);
        usedToday.add(o.id);
        weekLoad.set(o.id, (weekLoad.get(o.id) ?? 0) + 1);
      }

      // ถ้ายังว่างอยู่ ใช้ผู้นำที่ยังว่างวันนี้เติม (เช่น โควตา 3 คน แต่ผู้นำเหลือ 1)
      if (picked.length < need) {
        for (const o of shuffled(pool(leaders), rand)) {
          if (picked.length >= need) break;
          if (picked.some((p) => p.id === o.id)) continue;
          picked.push(o);
          usedToday.add(o.id);
          weekLoad.set(o.id, (weekLoad.get(o.id) ?? 0) + 1);
          if (!hasLeader) hasLeader = true;
        }
      }

      if (picked.length < need) {
        const onLeave = active.filter((o) => leaveToday.has(o.id)).length;
        issues.push(
          `ได้ ${picked.length}/${need} คน`
          + (onLeave > 0 ? ` (ลาวันนี้ ${onLeave} คน)` : ' (คนที่ว่างไม่พอ)'),
        );
        slotsUnderfilled += 1;
      }
      if (hasLeader) slotsWithLeader += 1;

      cells.push({
        date: date, weekday: weekday, shift,
        shiftLabel: SHIFT_LABELS[shift], required: need,
        officerIds: picked.map((o) => o.id),
        hasLeader, issues,
      });
    }
  }

  const totalSlots = cells.length;
  if (slotsUnderfilled > 0) {
    notes.push(`มี ${slotsUnderfilled} กะที่สุ่มได้ไม่ครบโควตา — ตรวจประวัติการลาหรือเพิ่มจำนวนเจ้าหน้าที่`);
  }
  if (requireLeader && slotsWithLeader < totalSlots) {
    notes.push(`มี ${totalSlots - slotsWithLeader} กะที่ไม่มีผู้นำ — ต้องมีผู้นำอย่างน้อย 1 คนต่อกะ`);
  }
  if (active.length === 0) notes.push('ไม่มีเจ้าหน้าที่ที่ active เลย');

  return {
    cells, slotsWithLeader, slotsUnderfilled, totalSlots, notes,
    officersUsed: new Set(cells.flatMap((c) => c.officerIds)).size,
  };
}