import { supabase } from '../supabase';
import { RevenueConfig, ServiceRecord, ServiceRecordOfficer, RevenueOverride } from '../types';

export type RevenueScope = 'default' | 'vehicle_rescue';

export function getScopeForCategory(category: string | null | undefined): RevenueScope {
  return category === 'vehicle_rescue' ? 'vehicle_rescue' : 'default';
}

export const DEFAULT_REVENUE_CONFIGS: RevenueConfig[] = [
  {
    scope: 'default',
    officer_share_percent: 10.00,
    central_share_percent: 90.00,
    notes: 'เคสบริการทั่วไป: 10% เจ้าหน้าที่รับเคส (หารเฉลี่ย), 90% กองกลาง',
    updated_at: new Date().toISOString(),
    updated_by: null,
  },
  {
    scope: 'vehicle_rescue',
    officer_share_percent: 10.00,
    central_share_percent: 90.00,
    notes: 'หน่วยกู้ภัยรถยก: 10% เจ้าหน้าที่รับเคส (หารเฉลี่ย), 90% กองหน่วย',
    updated_at: new Date().toISOString(),
    updated_by: null,
  },
];

const LOCAL_REVENUE_CONFIG_KEY = 'dot_revenue_sharing_config';

function loadLocalRevenueConfigs(): RevenueConfig[] | null {
  try {
    const raw = localStorage.getItem(LOCAL_REVENUE_CONFIG_KEY);
    return raw ? (JSON.parse(raw) as RevenueConfig[]) : null;
  } catch {
    return null;
  }
}

function saveLocalRevenueConfigs(configs: RevenueConfig[]) {
  try {
    localStorage.setItem(LOCAL_REVENUE_CONFIG_KEY, JSON.stringify(configs));
  } catch (e) {
    console.warn('[saveLocalRevenueConfigs] error:', e);
  }
}

export async function fetchRevenueConfigs(): Promise<RevenueConfig[]> {
  const local = loadLocalRevenueConfigs();
  try {
    const { data, error } = await supabase
      .from('revenue_sharing_config')
      .select('*')
      .order('updated_at', { ascending: false });

    if (!error && data && data.length > 0) {
      // Deduplicate by scope — keep only the latest row per scope
      const seen = new Set<string>();
      const unique: RevenueConfig[] = [];
      for (const row of data as RevenueConfig[]) {
        if (!seen.has(row.scope)) {
          seen.add(row.scope);
          unique.push(row);
        }
      }
      const sorted = unique.sort((a, b) => a.scope.localeCompare(b.scope));
      saveLocalRevenueConfigs(sorted);
      return sorted;
    }
  } catch (e) {
    console.warn('[fetchRevenueConfigs] Supabase error, falling back to local:', e);
  }

  // Return local if exists, otherwise fallback to defaults
  if (local && local.length > 0) {
    return local;
  }
  return DEFAULT_REVENUE_CONFIGS;
}

export async function updateRevenueConfig(
  scope: RevenueScope,
  officerPct: number,
  centralPct: number,
  notes: string | null,
  updatedBy: string,
): Promise<void> {
  const payload = {
    officer_share_percent: officerPct,
    central_share_percent: centralPct,
    notes,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy || null,
  };

  // Always save to localStorage first for instant, guaranteed persistence
  const currentConfigs = (await fetchRevenueConfigs()).slice();
  const index = currentConfigs.findIndex((c) => c.scope === scope);
  const updatedItem: RevenueConfig = { scope, ...payload };
  if (index >= 0) {
    currentConfigs[index] = updatedItem;
  } else {
    currentConfigs.push(updatedItem);
  }
  saveLocalRevenueConfigs(currentConfigs);

  // Try updating Supabase database
  try {
    // 1. Try UPDATE first
    const { data: updated, error: updateErr } = await supabase
      .from('revenue_sharing_config')
      .update(payload)
      .eq('scope', scope)
      .select('scope');

    if (!updateErr && updated && updated.length > 0) {
      return; // Update succeeded in DB
    }

    // 2. If row did not exist, try INSERT
    if (!updateErr && (!updated || updated.length === 0)) {
      const { error: insertErr } = await supabase
        .from('revenue_sharing_config')
        .insert({ scope, ...payload });

      if (insertErr) {
        console.warn('[updateRevenueConfig] Supabase insert warning (saved locally):', insertErr.message);
      }
    } else if (updateErr) {
      console.warn('[updateRevenueConfig] Supabase update warning (saved locally):', updateErr.message);
    }
  } catch (err) {
    console.warn('[updateRevenueConfig] Network/RLS error (saved locally):', err);
  }
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
  try {
    const { error } = await supabase.rpc('assign_record_officers', {
      p_record_id: recordId,
      p_officer_ids: officerIds,
      p_assigned_by: assignedBy,
    });
    if (error) {
      console.warn('[assignRecordOfficers] RPC fallback to direct update:', error.message);
      await supabase.from('service_record_officers').delete().eq('service_record_id', recordId);
      if (officerIds.length > 0) {
        await supabase.from('service_record_officers').insert(
          officerIds.map((id) => ({
            service_record_id: recordId,
            officer_id: id,
            assigned_by: assignedBy,
          }))
        );
      }
    }
  } catch (err) {
    console.warn('[assignRecordOfficers] Exception, direct table update:', err);
    await supabase.from('service_record_officers').delete().eq('service_record_id', recordId);
    if (officerIds.length > 0) {
      await supabase.from('service_record_officers').insert(
        officerIds.map((id) => ({
          service_record_id: recordId,
          officer_id: id,
          assigned_by: assignedBy,
        }))
      );
    }
  }
}

/**
 * Read case assignments through an app-login-safe RPC. The direct table
 * query is retained as a fallback for older databases before migration 0022.
 */
export async function fetchAssignedOfficerIds(recordIds: string[]): Promise<Record<string, string[]>> {
  if (recordIds.length === 0) return {};

  const { data, error } = await supabase.rpc('list_service_record_officers', {
    p_record_ids: recordIds,
  });

  if (!error && data) {
    const result: Record<string, string[]> = {};
    for (const row of data as { service_record_id: string; officer_id: string }[]) {
      if (!result[row.service_record_id]) result[row.service_record_id] = [];
      result[row.service_record_id].push(row.officer_id);
    }
    return result;
  }

  if (error) console.warn('[fetchAssignedOfficerIds] RPC fallback:', error.message);
  const result: Record<string, string[]> = {};
  await Promise.all(recordIds.map(async (recordId) => {
    const response = await supabase
      .from('service_record_officers')
      .select('officer_id')
      .eq('service_record_id', recordId);
    const ids = ((response.data ?? []) as { officer_id: string }[]).map((row) => row.officer_id);
    if (ids.length > 0) result[recordId] = ids;
  }));
  return result;
}

export async function fetchAssignedOfficerNames(
  recordId: string,
  officerLookup: Record<string, string>,
): Promise<string> {
  const assigned = await fetchAssignedOfficerIds([recordId]);
  const ids = assigned[recordId] ?? [];
  const names = ids.map((id: string) => officerLookup[id]).filter(Boolean);
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

/**
 * คำนวณ shares จาก config (สำหรับ preview ใน UI ก่อน save)
 */
export function calculateShares(amount: number, officerPct: number) {
  const officerTotal = Math.round(amount * officerPct) / 100;
  const officerTotalRounded = Math.round(officerTotal * 100) / 100;
  const central = Math.round((amount - officerTotalRounded) * 100) / 100;
  return { officer_share: officerTotalRounded, central_share: central };
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
