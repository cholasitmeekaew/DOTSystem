import { supabase, isJsonMode } from '../supabase';
import {
  ClaimRecord, ClaimPreview, ServiceRecord, ServiceRecordOfficer, RevenueConfig,
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
  if (code === 'P0001') return msg || 'สถานะ claim ไม่ถูกต้อง';
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
    if (data) return data as ClaimPreview;
  } catch (e) {
    console.warn('[previewClaimShare] RPC failed, using fallback:', e);
  }
  return previewClaimShareFallback(officerId, period, scope);
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
