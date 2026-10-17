import { supabase, isJsonMode } from '../supabase';
import {
  ClaimRecord, ClaimPreview, ServiceRecord, ServiceRecordOfficer, RevenueConfig,
  PendingClaimSummary,
} from '../types';
import { getScopeForCategory } from './revenueSharing';

export type ClaimScope = 'default' | 'vehicle_rescue';

export interface ClaimRpcResult {
  success: boolean;
  claim_ids: string[];
  record_count: number;
  total_amount: number;
}

/**
 * แปลง error code จาก Postgres / Supabase เป็นข้อความที่ actionable
 */
export function translateClaimError(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
  const code = error.code ?? '';
  const msg = error.message ?? '';
  if (code === '23505' || /duplicate key|already exists/i.test(msg)) {
    return 'รายการนี้ถูก claim ไปแล้ว (มีการบันทึกซ้ำ)';
  }
  if (code === '23514' || /check constraint|violates/i.test(msg)) {
    return 'ยอดส่วนแบ่งไม่ถูกต้อง (ต้องไม่ติดลบ)';
  }
  if (code === '42501' || /row[- ]level security|permission/i.test(msg)) {
    return 'คุณไม่มีสิทธิ์ดำเนินการนี้ (RLS block)';
  }
  if (code === 'P0001') {
    // migration 0038: กันรับส่วนแบ่งของงวดที่ยังไม่ปิดเดือน
    if (/CLAIM_PERIOD_NOT_CLOSED/i.test(msg)) {
      return 'รับส่วนแบ่งได้เฉพาะงวดที่ปิดเดือนแล้วเท่านั้น (งวดเดือนปัจจุบันต้องรอสิ้นเดือน)';
    }
    return msg || 'สถานะ claim ไม่ถูกต้อง';
  }
  if (code === 'P0002') return 'ไม่พบรายการ claim ที่ต้องการ';
  if (/function .* does not exist/i.test(msg)) {
    return 'RPC claim ยังไม่พร้อมใช้งาน (ต้อง apply migration 0009)';
  }
  return msg || 'เกิดข้อผิดพลาด กรุณาลองใหม่';
}

/**
 * Fallback: คำนวณ preview ฝั่ง client (ใช้เมื่อ RPC ยังไม่พร้อม)
 */
async function previewClaimShareFallback(
  officerId: string, period: string, scope: ClaimScope,
): Promise<ClaimPreview> {
  const [{ data: recordsData }, { data: sroData }, { data: overridesData }, configs] = await Promise.all([
    supabase.from('service_records').select('*').eq('status', 'paid'),
    supabase.from('service_record_officers').select('*'),
    supabase.from('service_record_revenue_overrides').select('*'),
    // load config — ใช้ default 10% ถ้าหาไม่เจอ
    Promise.resolve<RevenueConfig[]>([]),
  ]);

  const records = (recordsData ?? []) as ServiceRecord[];
  const sro = (sroData ?? []) as ServiceRecordOfficer[];
  const overrides = (overridesData ?? []) as { service_record_id: string; officer_share: number }[];

  const sroCount = new Map<string, number>();
  for (const row of sro) {
    sroCount.set(row.service_record_id, (sroCount.get(row.service_record_id) ?? 0) + 1);
  }
  const myOfficerRecords = new Set(
    sro.filter((r) => r.officer_id === officerId).map((r) => r.service_record_id)
  );
  const overrideMap = new Map(overrides.map((o) => [o.service_record_id, o.officer_share]));

  const pct = 10; // fallback default
  let gross = 0;
  let total = 0;
  let count = 0;
  const previewRecords: ClaimPreview['records'] = [];

  for (const r of records) {
    if (!myOfficerRecords.has(r.id)) continue;
    // Fallback: ถ้าไม่มี service_category ให้ใช้ service_name เป็น category (เหมือน ServiceFeesPage)
    const categoryValue = r.service_category ?? r.service_name;
    const recordScope = getScopeForCategory(categoryValue);
    if (recordScope !== scope) continue;
    if (!r.service_date.startsWith(period)) continue;

    const assignedCount = sroCount.get(r.id) ?? 1;
    const ovShare = overrideMap.get(r.id);
    const perOfficer = ovShare && ovShare > 0
      ? ovShare / Math.max(assignedCount, 1)
      : (r.officer_share && r.officer_share > 0
          ? r.officer_share / Math.max(assignedCount, 1)
          : (r.amount * pct / 100) / Math.max(assignedCount, 1));

    gross += r.amount;
    total += perOfficer;
    count += 1;
    previewRecords.push({
      id: r.id,
      service_name: r.service_name,
      amount: r.amount,
      assigned_count: assignedCount,
      per_officer_share: Math.round(perOfficer * 100) / 100,
    });
  }

  return {
    scope, period,
    officer_share_percent: pct,
    record_count: count,
    gross_amount: Math.round(gross * 100) / 100,
    per_officer_total: Math.round(total * 100) / 100,
    records: previewRecords,
  };
}

/**
 * ดึง preview ยอดส่วนแบ่งที่ officer จะได้รับ (ยังไม่ claim)
 */
export async function previewClaimShare(
  officerId: string, period: string, scope: ClaimScope,
): Promise<ClaimPreview> {
  try {
    const { data, error } = await supabase.rpc('preview_claim_share', {
      p_officer_id: officerId,
      p_period: period,
      p_scope: scope,
    });
    if (error) throw error;
    if (data) return normalisePreview(data as Record<string, unknown>);
  } catch (e) {
    console.warn('[previewClaimShare] RPC failed, using fallback:', e);
  }
  return previewClaimShareFallback(officerId, period, scope);
}

/**
 * RPC คืนฟิลด์ชื่อ `gross` แต่ fallback ฝั่ง client ใช้ `amount`
 * ทำให้รายการเคสพังเงียบ ๆ เมื่อสลับเส้นทาง (RPC ใช้ได้ / ใช้ไม่ได้)
 * จึงต้องแปลงให้เป็นชื่อเดียวกันเสมอ
 */
function normalisePreview(raw: Record<string, unknown>): ClaimPreview {
  const rows = Array.isArray(raw.records) ? (raw.records as Array<Record<string, unknown>>) : [];
  return {
    scope: (raw.scope as ClaimScope) ?? 'default',
    period: String(raw.period ?? ''),
    officer_share_percent: Number(raw.officer_share_percent ?? 10),
    record_count: Number(raw.record_count ?? 0),
    gross_amount: Number(raw.gross_amount ?? 0),
    per_officer_total: Number(raw.per_officer_total ?? 0),
    closed: raw.closed !== false,
    records: rows.map((r) => ({
      id: String(r.id ?? ''),
      service_name: String(r.service_name ?? '—'),
      amount: Number(r.gross ?? r.amount ?? 0),
      assigned_count: Number(r.assigned_count ?? 1),
      per_officer_share: Number(r.share ?? r.per_officer_share ?? 0),
    })),
    months: (Array.isArray(raw.months) ? raw.months : []).map((m) => {
      const row = m as Record<string, unknown>;
      return {
        month: String(row.month ?? ''),
        record_count: Number(row.record_count ?? 0),
        total: Number(row.total ?? 0),
      };
    }),
  };
}

/**
 * ส่วนแบ่งที่ยังไม่ได้รับ รายคน-รายเดือน (สำหรับหัวหน้ากรม)
 *
 * คืนเฉพาะเดือนที่ปิดแล้วและยังไม่เคยถูก claim
 * ใช้ในหน้าการเงินเพื่อกดรับส่วนแบ่งแทนเจ้าหน้าที่ได้
 */
export async function fetchPendingClaimSummary(): Promise<PendingClaimSummary[]> {
  const { data, error } = await supabase.rpc('list_pending_claims_by_officer');
  if (error) {
    console.warn('[fetchPendingClaimSummary] error:', error);
    return [];
  }
  return (data ?? []) as unknown as PendingClaimSummary[];
}

/**
 * Submit claim: INSERT รายการ pending ลง claim_records
 */
export async function submitClaim(
  officerId: string, period: string, scope: ClaimScope,
  actorId: string, note?: string,
): Promise<ClaimRpcResult> {
  try {
    const { data, error } = await supabase.rpc('claim_service_share', {
      p_officer_id: officerId,
      p_period: period,
      p_scope: scope,
      p_actor_id: actorId,
      p_note: note ?? null,
    });
    if (error) throw error;
    if (data) return data as ClaimRpcResult;
  } catch (e) {
    console.warn('[submitClaim] RPC failed:', e);
    throw e;
  }
  return { success: false, claim_ids: [], record_count: 0, total_amount: 0 };
}

/**
 * Commissioner: อนุมัติ claim
 */
export async function approveClaim(claimId: string, approverId: string): Promise<void> {
  const { error } = await supabase.rpc('approve_claim', {
    p_claim_id: claimId,
    p_approver_id: approverId,
  });
  if (error) throw error;
}

/**
 * Commissioner: ปฏิเสธ claim
 */
export async function rejectClaim(claimId: string, rejecterId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('reject_claim', {
    p_claim_id: claimId,
    p_rejecter_id: rejecterId,
    p_reason: reason,
  });
  if (error) throw error;
}

/**
 * Commissioner: mark claim ที่ approved แล้วเป็น paid + ตัด accumulated
 */
export async function markClaimPaid(claimId: string, payerId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_claim_paid', {
    p_claim_id: claimId,
    p_payer_id: payerId,
  });
  if (error) throw error;
}

/**
 * ดึง claim ทั้งหมดของ officer (รวมทุกสถานะ)
 */
export async function fetchOfficerClaims(officerId: string): Promise<ClaimRecord[]> {
  const { data, error } = await supabase.rpc('list_claims_for_officer', {
    p_officer_id: officerId,
  });
  if (error) {
    console.warn('[fetchOfficerClaims] error:', error);
    return [];
  }
  return (data ?? []) as ClaimRecord[];
}

/**
 * Commissioner: ดึง claim pending ทั้งหมด
 */
export async function fetchPendingClaims(commissionerId: string): Promise<ClaimRecord[]> {
  const { data, error } = await supabase.rpc('list_claims_for_commissioner', {
    p_viewer_id: commissionerId,
    p_status: 'pending',
  });
  if (error) {
    console.warn('[fetchPendingClaims] error:', error);
    return [];
  }
  return (data ?? []) as ClaimRecord[];
}

/**
 * Commissioner: ดึง claim approved ที่ยังไม่จ่าย
 */
export async function fetchApprovedClaims(commissionerId: string): Promise<ClaimRecord[]> {
  const { data, error } = await supabase.rpc('list_claims_for_commissioner', {
    p_viewer_id: commissionerId,
    p_status: 'approved',
  });
  if (error) {
    console.warn('[fetchApprovedClaims] error:', error);
    return [];
  }
  return (data ?? []) as ClaimRecord[];
}

export { isJsonMode };

/* =========================================================================
 * งวดที่เปิดรับส่วนแบ่งได้
 * ========================================================================= */

/** เดือนปัจจุบันตามเวลาไทย (ระบบคิดงวดตาม Asia/Bangkok) */
export function currentClaimPeriod(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7);
}

/** งวดนี้ปิดแล้วหรือยัง — ใช้เงื่อนไขเดียวกับ claim_period_is_closed() ใน migration 0038 */
export function isPeriodClosed(period: string): boolean {
  return /^\d{4}-\d{2}$/.test(period) && period < currentClaimPeriod();
}

/**
 * งวดที่เลือกรับส่วนแบ่งได้ = งวดที่ผ่านมาแล้วเท่านั้น
 * คืนมาจากใหม่สุดไปเก่าสุด พร้อมเดือนที่ยังไม่ปิด (ถ้ามี ให้แสดงเป็นตัวเลือกที่ปิดการกดไว้)
 */
export function claimablePeriods(monthsBack = 12): Array<{
  period: string;
  closed: boolean;
  label: string;
}> {
  const now = new Date();
  return Array.from({ length: monthsBack + 1 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const closed = isPeriodClosed(period);
    const thai = period.slice(0, 4).toString().replace(/^20(\d{2})$/, '$1') + '/' + period.slice(5, 7);
    return {
      period,
      closed,
      label: closed ? `เดือน ${thai} (ปิดแล้ว)` : `เดือน ${thai} (ยังไม่ปิด — รอสิ้นเดือน)`,
    };
  });
}

/* =========================================================================
 * จัดการคำขอรออนุมัติ (หัวหน้ากรม)
 * ========================================================================= */

/**
 * ล้างคำขอรออนุมัติทั้งหมด
 *
 * claim_records ถูก RLS บัง → client query ตรงได้ 0 แถวเสมอ
 * จึงต้องผ่าน RPC (migration 0041) ไม่งั้นหัวหน้ากรมจะล้างไม่ได้
 * ลบเฉพาะสถานะ pending — ที่อนุมัติ/จ่ายแล้ว/ไม่อนุมัติ ไม่แตะ
 */
export async function clearPendingClaims(
  actorId: string,
  period?: string,
): Promise<{ deleted: number }> {
  const fn = period ? 'clear_pending_claims_by_period' : 'clear_pending_claims';
  const args = period
    ? { p_actor_id: actorId, p_period: period }
    : { p_actor_id: actorId };

  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return { deleted: Number((data as { deleted?: number })?.deleted ?? 0) };
}

/**
 * กดรับส่วนแบ่งให้ทุกคนที่ยังมีส่วนแบ่งค้าง ในครั้งเดียว
 *
 * วนทีละคนโดยเรียก claim_service_share ของแต่ละคน
 * (ฟังก์ชันนี้รวมทุกเดือนที่ค้างของคนนั้นให้อัตโนมัติอยู่แล้ว)
 */
export async function claimAllPending(
  actorId: string,
  onProgress?: (done: number, total: number, name: string) => void,
): Promise<{ officers: number; claims: number; total: number; errors: string[] }> {
  const pending = await fetchPendingClaimSummary();
  if (pending.length === 0) {
    return { officers: 0, claims: 0, total: 0, errors: [] };
  }

  // จัดกลุ่มตามคน → ใช้เดือนล่าสุดของคนนั้น (ซึ่งจะดึงทุกเดือนก่อนหน้ามาให้)
  const byOfficer = new Map<string, PendingClaimSummary>();
  for (const row of pending) {
    const prev = byOfficer.get(row.officer_id);
    if (!prev || row.month > prev.month) byOfficer.set(row.officer_id, row);
  }

  const errors: string[] = [];
  let claims = 0;
  let total = 0;
  const entries = [...byOfficer.entries()];

  for (let i = 0; i < entries.length; i++) {
    const [officerId, row] = entries[i];
    onProgress?.(i, entries.length, row.officer_name);
    try {
      const res = await submitClaim(
        officerId,
        row.month,
        row.scope as ClaimScope,
        actorId,
        'หัวหน้ากรมกดรับทั้งหมด (รวมเดือนค้าง)',
      );
      const inserted = Number((res as { inserted?: number }).inserted ?? 0);
      claims += inserted;
      total += Number((res as { total?: number }).total ?? 0);
    } catch (e) {
      errors.push(`${row.officer_name}: ${(e as Error).message}`);
    }
  }

  onProgress?.(entries.length, entries.length, '');
  return { officers: entries.length, claims, total, errors };
}
