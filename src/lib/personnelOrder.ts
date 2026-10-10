/* =============================================================
 * personnelOrder.ts
 * -------------------------------------------------------------
 * ศูนย์กลางตรรกะ "การเรียงลำดับ / การจัดกลุ่ม / ป้ายกำกับ" ของบุคลากร
 *
 * ใช้ร่วมกัน 2 หน้า เพื่อไม่ให้สูตรซ้ำผิดกัน:
 *   - src/pages/public/PersonnelPage.tsx        (หน้าสาธารณะ — อ่านอย่างเดียว)
 *   - src/pages/officer/OfficerManagementPage.tsx (หัวหน้ากรม — เขียน/จัดลำดับ)
 *
 * ลำดับชั้นของการเรียง (เรียงจากสำคัญที่สุดไปน้อยที่สุด):
 *   1. sort_order  (ลำดับที่หัวหน้ากรมกำหนดเอง — migration 0027)
 *   2. rank        (ตำแหน่ง: commissioner → inspector → officer)
 *   3. department  (แผนก/ฝ่าย)
 *   4. generation  (รุ่น — กลุ่มพนักงานทดลองงานอยู่กลุ่มแรก)
 *   5. name        (ไทย, a→z)  เสมอเป็นตัวสุดท้ายเพื่อความชัดเจน
 * ============================================================= */

import type {
  Officer,
  OfficerRankRecord,
  OfficerGenerationRecord,
} from './types';
import {
  DEPARTMENTS,
  RANK_LABELS,
  DEPARTMENT_LABELS,
  GENERATION_FALLBACK_LABELS,
  GENERATION_UNSET_LABEL,
} from './types';

/* ---------- ชนิดข้อมูลตัวเลือก ---------- */

export type PersonnelSortMode = 'manual' | 'rank' | 'department' | 'generation';
export type PersonnelGroupMode = 'none' | 'rank' | 'department' | 'generation';

export const PERSONNEL_SORT_OPTIONS: { value: PersonnelSortMode; label: string }[] = [
  { value: 'manual', label: 'ลำดับที่กำหนด' },
  { value: 'rank', label: 'ตำแหน่ง (สูง → ต่ำ)' },
  { value: 'department', label: 'แผนก / ฝ่าย' },
  { value: 'generation', label: 'รุ่น' },
];

export const PERSONNEL_GROUP_OPTIONS: { value: PersonnelGroupMode; label: string }[] = [
  { value: 'none', label: 'ไม่จัดกลุ่ม' },
  { value: 'rank', label: 'จัดกลุ่มตามตำแหน่ง' },
  { value: 'department', label: 'จัดกลุ่มตามแผนก' },
  { value: 'generation', label: 'จัดกลุ่มตามรุ่น' },
];

/* ---------- ค่าคงที่สำรอง (ใช้เมื่อตารางอ้างอิงยังโหลดไม่เสร็จ) ---------- */

/** ลำดับตำแหน่งสำรอง — น้อย = สูงกว่า */
const RANK_FALLBACK_ORDER: Record<string, number> = {
  commissioner: 1,
  inspector: 2,
  officer: 3,
};

export const UNGROUPED_KEY = '__none__';
const UNGROUPED_SORT = 9999;

/* ---------- ดัชนีข้อมูลอ้างอิง ---------- */

export interface PersonnelIndex {
  /** rank → ลำดับ (น้อย = สูงกว่า) */
  rankOrder: Map<string, number>;
  /** rank → ป้ายชื่อตำแหน่ง */
  rankLabel: (rank: string | null | undefined) => string;
  /** department → ลำดับ */
  deptOrder: Map<string, number>;
  /** department → ป้ายชื่อแผนก */
  deptLabel: (dept: string | null | undefined) => string;
  /** generation_key → ลำดับรุ่น */
  genOrder: Map<string, number>;
  /** generation_key → ป้ายชื่อรุ่น */
  genLabel: (key: string | null | undefined) => string;
  /** generation_key → เป็นกลุ่มพนักงานทดลองงานไหม */
  isTrainee: (key: string | null | undefined) => boolean;
  /** รายการรุ่นทั้งหมดที่ active เรียงตาม sort_order */
  activeGenerations: OfficerGenerationRecord[];
}

/**
 * สร้างดัชนีอ้างอิงจากตาราง officer_ranks / officer_generations
 * ถ้าตารางใดโหลดไม่ได้ (JSON mode ที่ยังไม่มีข้อมูล) จะ fallback ไปค่าคงที่
 */
export function buildPersonnelIndex(
  ranks: OfficerRankRecord[] = [],
  generations: OfficerGenerationRecord[] = [],
): PersonnelIndex {
  // --- ตำแหน่ง ---
  const rankOrder = new Map<string, number>(Object.entries(RANK_FALLBACK_ORDER));
  const rankLabels = new Map<string, string>(
    (Object.entries(RANK_LABELS) as [string, string][]).map(([k, v]) => [k, v]),
  );
  const sortedRanks = [...ranks].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  sortedRanks.forEach((r, i) => {
    const key = r.rank_key ?? r.label;
    if (!key) return;
    rankOrder.set(key, r.sort_order ?? i + 1);
    if (r.label) rankLabels.set(key, r.label);
  });

  // --- แผนก ---
  const deptOrder = new Map<string, number>();
  DEPARTMENTS.forEach((d, i) => deptOrder.set(d, i + 1));

  // --- รุ่น ---
  const activeGenerations = [...generations]
    .filter((g) => g.is_active !== false)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const genOrder = new Map<string, number>();
  const genLabels = new Map<string, string>();
  const genTrainee = new Map<string, boolean>();
  activeGenerations.forEach((g, i) => {
    const key = (g.generation_key ?? g.label ?? '').trim();
    if (!key) return;
    genOrder.set(key, g.sort_order ?? i + 1);
    genLabels.set(key, g.label);
    if (g.is_trainee) genTrainee.set(key, true);
  });

  return {
    rankOrder,
    rankLabel: (rank) =>
      !rank ? '—' : rankLabels.get(rank) ?? RANK_LABELS[rank] ?? rank,
    deptOrder,
    deptLabel: (dept) =>
      !dept ? '—' : DEPARTMENT_LABELS[dept as keyof typeof DEPARTMENT_LABELS] ?? dept,
    genOrder,
    genLabel: (key) => {
      const k = (key ?? '').trim();
      if (!k) return GENERATION_UNSET_LABEL;
      return genLabels.get(k) ?? GENERATION_FALLBACK_LABELS[k] ?? `รุ่นที่ ${k}`;
    },
    isTrainee: (key) => {
      const k = (key ?? '').trim();
      return k ? genTrainee.get(k) === true : false;
    },
    activeGenerations,
  };
}

/* ---------- ตัวช่วยดึงค่า ---------- */

const sortOrderOf = (o: Officer) =>
  Number.isFinite(o.sort_order) ? Number(o.sort_order) : 0;
const genKeyOf = (o: Officer) => (o.generation ?? '').trim();
const rankSortOf = (o: Officer, idx: PersonnelIndex) => idx.rankOrder.get(o.rank) ?? 500;
const deptSortOf = (o: Officer, idx: PersonnelIndex) => idx.deptOrder.get(o.department) ?? 500;
const genSortOf = (o: Officer, idx: PersonnelIndex) => {
  const k = genKeyOf(o);
  return k ? idx.genOrder.get(k) ?? UNGROUPED_SORT : UNGROUPED_SORT;
};

/* ---------- เรียงลำดับ ---------- */

/**
 * ตัวเปรียบเทียบหลักของทั้งระบบ
 * tie-breaker ตามลำดับ: sort_order → ตำแหน่ง → แผนก → รุ่น → ชื่อ
 */
export function compareOfficers(
  a: Officer,
  b: Officer,
  mode: PersonnelSortMode,
  idx: PersonnelIndex,
): number {
  const cmpSort = sortOrderOf(a) - sortOrderOf(b);
  const cmpRank = rankSortOf(a, idx) - rankSortOf(b, idx);
  const cmpDept = deptSortOf(a, idx) - deptSortOf(b, idx);
  const cmpGen = genSortOf(a, idx) - genSortOf(b, idx);
  const cmpName = a.name.localeCompare(b.name, 'th');

  switch (mode) {
    case 'rank':
      return cmpRank || cmpSort || cmpDept || cmpGen || cmpName;
    case 'department':
      return cmpDept || cmpRank || cmpSort || cmpGen || cmpName;
    case 'generation':
      return cmpGen || cmpRank || cmpDept || cmpSort || cmpName;
    case 'manual':
    default:
      return cmpSort || cmpRank || cmpDept || cmpGen || cmpName;
  }
}

/** เรียงลำดับรายชื่อ (คืนค่าใหม่ ไม่แก้ของเดิม) */
export function sortOfficers(
  list: Officer[],
  mode: PersonnelSortMode,
  idx: PersonnelIndex,
): Officer[] {
  return [...list].sort((a, b) => compareOfficers(a, b, mode, idx));
}

/* ---------- จัดกลุ่ม ---------- */

export interface PersonnelGroup {
  key: string;
  label: string;
  count: number;
  /** กลุ่มพนักงานทดลองงาน (ใช้แสดงป้ายพิเศษ) */
  trainee: boolean;
  officers: Officer[];
}

function groupKeyOf(o: Officer, mode: PersonnelGroupMode, idx: PersonnelIndex): string {
  switch (mode) {
    case 'rank':
      return o.rank || '__none__';
    case 'department':
      return o.department || '__none__';
    case 'generation':
      return genKeyOf(o) || UNGROUPED_KEY;
    default:
      return 'all';
  }
}

function groupLabelOf(key: string, mode: PersonnelGroupMode, idx: PersonnelIndex): string {
  if (key === UNGROUPED_KEY) return GENERATION_UNSET_LABEL;
  switch (mode) {
    case 'rank':
      return idx.rankLabel(key);
    case 'department':
      return idx.deptLabel(key);
    case 'generation':
      return idx.genLabel(key);
    default:
      return 'ทั้งหมด';
  }
}

function groupSortOf(key: string, mode: PersonnelGroupMode, idx: PersonnelIndex): number {
  switch (mode) {
    case 'rank':
      return idx.rankOrder.get(key) ?? 500;
    case 'department':
      return idx.deptOrder.get(key) ?? 500;
    case 'generation':
      return key === UNGROUPED_KEY ? UNGROUPED_SORT : idx.genOrder.get(key) ?? UNGROUPED_SORT;
    default:
      return 0;
  }
}

/** จัดกลุ่ม + เรียงลำดับภายในกลุ่มด้วย sortMode */
export function groupOfficers(
  list: Officer[],
  mode: PersonnelGroupMode,
  sortMode: PersonnelSortMode,
  idx: PersonnelIndex,
): PersonnelGroup[] {
  if (list.length === 0) return [];

  if (mode === 'none') {
    return [{
      key: 'all',
      label: '',
      count: list.length,
      trainee: false,
      officers: sortOfficers(list, sortMode, idx),
    }];
  }

  const buckets = new Map<string, Officer[]>();
  for (const o of list) {
    const key = groupKeyOf(o, mode, idx);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(o);
    else buckets.set(key, [o]);
  }

  return [...buckets.entries()]
    .sort(([ka], [kb]) => groupSortOf(ka, mode, idx) - groupSortOf(kb, mode, idx))
    .map(([key, officers]) => ({
      key,
      label: groupLabelOf(key, mode, idx),
      count: officers.length,
      trainee: mode === 'generation' && idx.isTrainee(key === UNGROUPED_KEY ? null : key),
      officers: sortOfficers(officers, sortMode, idx),
    }));
}

/* ---------- ค้นหา ---------- */

/** ค้นหาจากชื่อ / username / ตำแหน่ง / แผนก / รุ่น (รวมถึงเลขรุ่นดิบ เช่น ค้นว่า "1") */
export function matchesOfficerSearch(
  o: Officer,
  rawQuery: string,
  idx: PersonnelIndex,
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;

  const haystack = [
    o.name ?? '',
    o.username ?? '',
    idx.rankLabel(o.rank),
    o.rank ?? '',
    idx.deptLabel(o.department),
    o.department ?? '',
    idx.genLabel(o.generation),
    o.generation ?? '',
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(q);
}

/** กรองตามแผนก (ค่าว่าง = ไม่กรอง) */
export function filterByDepartment(list: Officer[], dept: string): Officer[] {
  return !dept ? list : list.filter((o) => o.department === dept);
}

/** กรองตามรุ่น (ค่าว่าง = ไม่กรอง) */
export function filterByGeneration(list: Officer[], genKey: string): Officer[] {
  return !genKey ? list : list.filter((o) => genKeyOf(o) === genKey);
}

/* ---------- ตัวช่วยอื่น ๆ ---------- */

/** ตำแหน่งต่อไปของเจ้าหน้าที่ใหม่ = max(sort_order) + 1 */
export function nextSortOrder(list: Officer[]): number {
  return list.reduce((max, o) => Math.max(max, sortOrderOf(o)), 0) + 1;
}

/** นับจำนวนต่อกลุ่ม (ใช้ทำชิปตัวกรอง) */
export function countBy<T>(list: T[], keyOf: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of list) {
    const k = keyOf(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}