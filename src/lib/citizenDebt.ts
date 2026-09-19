import type { Citizen, CitizenStatus, ServiceRecord } from './types';

export type DebtSortMode = 'amount_desc' | 'amount_asc' | 'days_desc' | 'usage_desc';

export function isDebtExcludedStatus(status: CitizenStatus | null | undefined): boolean {
  return status === 'banned' || status === 'suspended';
}

export function getDebtExclusionMessage(status: CitizenStatus | null | undefined): string | null {
  if (status === 'banned') return 'ระงับการคิดยอดเนื่องจากถูกแบน';
  if (status === 'suspended') return 'ระงับการคิดยอดเนื่องจากถูกระงับสิทธิ์';
  return null;
}

export function getRemainingDebt(record: ServiceRecord): number {
  if (record.status === 'paid') return 0;
  return Math.max(0, Number(record.amount) - Number(record.paid_amount ?? 0));
}

export function getCitizenDebtTotal(records: ServiceRecord[], citizen?: Citizen | null): number {
  if (isDebtExcludedStatus(citizen?.status)) return 0;
  return records.reduce((sum, record) => sum + getRemainingDebt(record), 0);
}

export interface CitizenLookup {
  byId: Map<string, Pick<Citizen, 'id' | 'status' | 'roblox_username'>>;
  byUsername: Map<string, Pick<Citizen, 'id' | 'status' | 'roblox_username'>>;
}

export function buildCitizenLookup(
  citizens: Array<Pick<Citizen, 'id' | 'status' | 'roblox_username'>>,
): CitizenLookup {
  const byId = new Map<string, Pick<Citizen, 'id' | 'status' | 'roblox_username'>>();
  const byUsername = new Map<string, Pick<Citizen, 'id' | 'status' | 'roblox_username'>>();
  for (const c of citizens) {
    if (c.id) byId.set(c.id, c);
    if (c.roblox_username) byUsername.set(c.roblox_username.trim().toLowerCase(), c);
  }
  return { byId, byUsername };
}

export function isRecordDebtExcluded(
  record: ServiceRecord,
  lookup: CitizenLookup,
): boolean {
  if (record.citizen_id) {
    const c = lookup.byId.get(record.citizen_id);
    if (c) return isDebtExcludedStatus(c.status);
  }
  if (record.roblox_username) {
    const c = lookup.byUsername.get(record.roblox_username.trim().toLowerCase());
    if (c) return isDebtExcludedStatus(c.status);
  }
  return false;
}

export interface RevenueAndDebtSummary {
  /** รายได้รวม (BC) ภาพรวม — ชำระแล้ว + ยอดค้างชำระที่ชอบธรรม (ยกเว้นยอดหนี้ของประชาชนที่ถูกแบนหรือระงับสิทธิ์เด็ดขาด) */
  totalRevenue: number;
  /** ยอดที่ชำระแล้วทั้งหมด */
  paidTotal: number;
  /** จำนวนรายการที่ชำระแล้ว */
  paidCount: number;
  /** ยอดค้างชำระทั้งหมดของประชาชนที่มีสิทธิ์ (ตรงกันทั้งแดชบอร์ดและสถิติหน่วยงาน) */
  unpaidTotal: number;
  /** จำนวนรายการค้างชำระที่ชอบธรรม */
  unpaidCount: number;
  /** ยอดหนี้ค้างชำระที่ถูกตัดออกเนื่องจากสถานะแบน/ระงับสิทธิ์ */
  excludedDebtTotal: number;
  /** จำนวนรายการหนี้ที่ถูกตัดออก */
  excludedDebtCount: number;
  /** จำนวนรายการทั้งหมดในระบบ */
  totalRecordsCount: number;
  /** รายการค้างชำระที่ชอบธรรม */
  unpaidRecords: ServiceRecord[];
}

export function calculateRevenueAndDebtSummary(
  records: ServiceRecord[],
  citizens: Array<Pick<Citizen, 'id' | 'status' | 'roblox_username'>>,
): RevenueAndDebtSummary {
  const lookup = buildCitizenLookup(citizens);

  let paidTotal = 0;
  let paidCount = 0;
  let unpaidTotal = 0;
  let excludedDebtTotal = 0;
  let excludedDebtCount = 0;
  const unpaidRecords: ServiceRecord[] = [];

  for (const r of records) {
    const amt = Number(r.amount) || 0;
    const paidAmt = r.status === 'paid' ? amt : Math.min(amt, Number(r.paid_amount ?? 0));
    const remaining = r.status === 'paid' ? 0 : Math.max(0, amt - paidAmt);

    if (r.status === 'paid') {
      paidTotal += paidAmt;
      paidCount += 1;
    } else {
      if (paidAmt > 0) {
        paidTotal += paidAmt;
      }
      if (remaining > 0) {
        const excluded = isRecordDebtExcluded(r, lookup);
        if (excluded) {
          excludedDebtTotal += remaining;
          excludedDebtCount += 1;
        } else {
          unpaidTotal += remaining;
          unpaidRecords.push(r);
        }
      }
    }
  }

  return {
    totalRevenue: paidTotal + unpaidTotal,
    paidTotal,
    paidCount,
    unpaidTotal,
    unpaidCount: unpaidRecords.length,
    excludedDebtTotal,
    excludedDebtCount,
    totalRecordsCount: records.length,
    unpaidRecords,
  };
}


export interface CitizenDebtRow {
  citizen: Citizen;
  amount: number;
  days: number;
  count: number;
  usageCount: number;
  usageTotal: number;
}

export function buildCitizenDebtRows(
  citizens: Citizen[],
  records: ServiceRecord[],
  options?: {
    statusFilter?: CitizenStatus | 'all';
    startDate?: string;
    endDate?: string;
    sortMode?: DebtSortMode;
  },
): CitizenDebtRow[] {
  const statusFilter = options?.statusFilter ?? 'all';
  const startTime = options?.startDate ? new Date(`${options.startDate}T00:00:00`).getTime() : null;
  const endTime = options?.endDate ? new Date(`${options.endDate}T23:59:59.999`).getTime() : null;
  const byCitizen = new Map(citizens.map((c) => [c.id, c]));
  const byUsername = new Map(
    citizens.map((c) => [(c.roblox_username ?? '').trim().toLowerCase(), c]),
  );
  const rows = new Map<string, CitizenDebtRow>();
  const now = Date.now();

  const ensureRow = (citizen: Citizen): CitizenDebtRow => {
    const current = rows.get(citizen.id);
    if (current) return current;
    const next: CitizenDebtRow = {
      citizen,
      amount: 0,
      days: 0,
      count: 0,
      usageCount: 0,
      usageTotal: 0,
    };
    rows.set(citizen.id, next);
    return next;
  };

  for (const record of records) {
    // ผูกประชาชนด้วย citizen_id ก่อน, ถ้าไม่มีให้ fallback ด้วย roblox_username
    // (ตรรกะเดียวกับ calculateRevenueAndDebtSummary / isRecordDebtExcluded)
    // เพื่อให้ยอดในตาราง = ยอด Dashboard (เช่นเคส Jazintoe 150 BC ที่ citizen_id=null)
    let citizen: Citizen | undefined;
    if (record.citizen_id) {
      citizen = byCitizen.get(record.citizen_id);
    }
    if (!citizen && record.roblox_username) {
      citizen = byUsername.get(record.roblox_username.trim().toLowerCase());
    }
    if (!citizen) continue;
    if (statusFilter !== 'all' && citizen.status !== statusFilter) continue;

    const recordDate = record.service_date || record.created_at;
    const recordTime = recordDate ? new Date(recordDate).getTime() : NaN;
    if (startTime != null && (Number.isNaN(recordTime) || recordTime < startTime)) continue;
    if (endTime != null && (Number.isNaN(recordTime) || recordTime > endTime)) continue;

    const row = ensureRow(citizen);
    row.usageCount += 1;
    row.usageTotal += Number(record.amount) || 0;

    if (isDebtExcludedStatus(citizen.status)) continue;
    const remaining = getRemainingDebt(record);
    if (remaining <= 0) continue;

    row.amount += remaining;
    row.count += 1;
    if (!Number.isNaN(recordTime)) {
      const days = Math.max(0, Math.floor((now - recordTime) / 86_400_000));
      row.days = Math.max(row.days, days);
    }
  }

  return [...rows.values()]
    .filter((row) => row.amount > 0 || row.usageCount > 0)
    .sort((a, b) => {
      switch (options?.sortMode ?? 'amount_desc') {
        case 'amount_asc':
          return a.amount - b.amount || b.days - a.days;
        case 'days_desc':
          return b.days - a.days || b.amount - a.amount;
        case 'usage_desc':
          return b.usageCount - a.usageCount || b.usageTotal - a.usageTotal;
        case 'amount_desc':
        default:
          return b.amount - a.amount || b.days - a.days;
      }
    });
}

/**
 * รายการค้างชำระที่ผูกกับประชาชนไม่ได้เลย (ไม่มีทั้ง citizen_id และ roblox_username ตรง)
 * ใช้แสดงส่วนกระทบยอด: Dashboard = ตาราง + กลุ่มนี้
 */
export function findUnlinkedDebtRecords(
  records: ServiceRecord[],
  citizens: Array<Pick<Citizen, 'id' | 'status' | 'roblox_username'>>,
): ServiceRecord[] {
  const lookup = buildCitizenLookup(citizens);
  return records.filter((r) => {
    if (getRemainingDebt(r) <= 0) return false;
    if (r.citizen_id && lookup.byId.has(r.citizen_id)) return false;
    if (
      r.roblox_username &&
      lookup.byUsername.has(r.roblox_username.trim().toLowerCase())
    )
      return false;
    // ถ้าเป็นยอดที่ถูกกันออก (ban/suspend) อยู่แล้ว ไม่ต้องนับเป็นส่วนต่าง
    if (isRecordDebtExcluded(r, lookup)) return false;
    return true;
  });
}
