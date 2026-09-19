import { supabase } from '../supabase';
import { RevenueConfig, ServiceRecord, ServiceRecordOfficer, RevenueOverride } from '../types';

export type RevenueScope = 'default' | 'vehicle_rescue';

export function getScopeForCategory(category: string | null | undefined): RevenueScope {
  return category === 'vehicle_rescue' ? 'vehicle_rescue' : 'default';
}

export async function fetchRevenueConfigs(): Promise<RevenueConfig[]> {
  const { data, error } = await supabase.from('revenue_sharing_config').select('*');
  if (error) throw error;
  return (data ?? []) as RevenueConfig[];
}

export async function updateRevenueConfig(
  scope: RevenueScope,
  officerPct: number,
  centralPct: number,
  notes: string | null,
  updatedBy: string,
): Promise<void> {
  const { error } = await supabase
    .from('revenue_sharing_config')
    .update({
      officer_share_percent: officerPct,
      central_share_percent: centralPct,
      notes,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    })
    .eq('scope', scope);
  if (error) throw error;
}

export async function fetchRecordOfficers(recordId: string): Promise<ServiceRecordOfficer[]> {
  const { data, error } = await supabase
    .from('service_record_officers')
    .select('*')
    .eq('service_record_id', recordId);
  if (error) throw error;
  return (data ?? []) as ServiceRecordOfficer[];
}

export async function assignRecordOfficers(
  recordId: string,
  officerIds: string[],
  assignedBy: string,
): Promise<void> {
  // ใช้ RPC function เพื่อ bypass RLS
  const { error } = await supabase.rpc('assign_record_officers', {
    p_record_id: recordId,
    p_officer_ids: officerIds,
    p_assigned_by: assignedBy,
  });
  if (error) throw error;
}

export async function fetchAssignedOfficerNames(
  recordId: string,
  officerLookup: Record<string, string>,
): Promise<string> {
  const { data, error } = await supabase
    .from('service_record_officers')
    .select('officer_id')
    .eq('service_record_id', recordId);
  if (error) return '';
  const ids = (data ?? []).map((r) => r.officer_id);
  const names = ids.map((id) => officerLookup[id]).filter(Boolean);
  return names.join(', ');
}

export async function fetchRevenueOverrides(): Promise<RevenueOverride[]> {
  const { data, error } = await supabase
    .from('service_record_revenue_overrides')
    .select('*');
  if (error) throw error;
  return (data ?? []) as RevenueOverride[];
}

export async function upsertRevenueOverride(
  recordId: string,
  officerShare: number,
  centralShare: number,
  reason: string | null,
  editedBy: string,
): Promise<void> {
  const { error } = await supabase
    .from('service_record_revenue_overrides')
    .upsert({
      service_record_id: recordId,
      officer_share: officerShare,
      central_share: centralShare,
      reason,
      edited_at: new Date().toISOString(),
      edited_by: editedBy,
    });
  if (error) throw error;
}

export async function deleteRevenueOverride(recordId: string): Promise<void> {
  const { error } = await supabase
    .from('service_record_revenue_overrides')
    .delete()
    .eq('service_record_id', recordId);
  if (error) throw error;
}

export function calculateShares(amount: number, officerPct: number) {
  const officerTotalRounded = Math.round(amount * officerPct) / 100;
  const officerRounded = Math.round(officerTotalRounded * 100) / 100;
  const central = Math.round((amount - officerRounded) * 100) / 100;
  return { officer_share: officerRounded, central_share: central };
}

export function getEffectiveShares(
  record: ServiceRecord,
  override: RevenueOverride | undefined,
  count: number,
) {
  if (override) {
    return {
      officer_share: override.officer_share,
      central_share: override.central_share,
      per_officer: override.officer_share / Math.max(1, count),
      is_overridden: true,
    };
  }
  return {
    officer_share: record.officer_share ?? 0,
    central_share: record.central_share ?? 0,
    per_officer: (record.officer_share ?? 0) / Math.max(1, count),
    is_overridden: false,
  };
}

export async function recalculateRecord(
  recordId: string,
  officerPct: number,
): Promise<void> {
  const { error } = await supabase.rpc('calculate_service_revenue', {
    p_service_record_id: recordId,
    p_officer_share_percent: officerPct,
  });
  if (error) throw error;
}
