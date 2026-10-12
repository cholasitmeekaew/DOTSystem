/* =============================================================
 * profileData.ts — รวบรวมข้อมูลประวัติของเจ้าหน้าที่ 1 คน จากทุกตารางที่มี
 * -------------------------------------------------------------
 * ทุกอย่างกรองด้วย officer_id ของผู้ใช้ที่ล็อกอินอยู่
 *
 * หมายเหตุเรื่องตารางที่ "ยังไม่มี" ในระบบ (ไม่ได้แต่งขึ้น แต่ไม่พบใน schema):
 *   - ไม่มีตารางบันทึกการเบิก/นำรถหน่วยงานออก-คืน  → ตาราง vehicles เป็น
 *     ทะเบียนรถของประชาชน มีแค่ข้อมูลการยึด/ปลดยึด ไม่ใช่รถหน่วยงาน
 *   - ไม่มีตารางบันทึกการแจ้งซ่อม/บำรุงรักษา
 *   - ไม่มีตารางบันทึกการเข้าสู่ระบบ (IP / อุปกรณ์ / last login)
 *     ระบบล็อกอินด้วยตาราง officers + localStorage จึงไม่มีให้ดึง
 * ============================================================= */

import { supabase } from './supabase';

export interface ProfileServices {
  /** รายการที่ลงบันทึกเอง (officer_id) หรือถูกมอบหมายให้ร่วมทำ */
  created: ServiceRow[];
  assigned: ServiceRow[];
  stats: {
    createdCount: number;
    totalAmount: number;
    paidAmount: number;
    unpaidAmount: number;
    /** ส่วนแบ่งสะสมของเจ้าหน้าที่ (จากตาราง officers.accumulated_share) */
    accumulatedShare: number;
  };
}

export interface ServiceRow {
  id: string;
  roblox_username: string | null;
  service_name: string | null;
  amount: number | null;
  paid_amount: number | null;
  status: string | null;
  service_date: string | null;
  officer_name: string | null;
  notes: string | null;
  officer_id?: string | null;
}

export interface VehicleRow {
  id: string;
  license_plate: string;
  owner_name: string | null;
  brand_model: string | null;
  color: string | null;
  is_impounded: boolean;
  impound_reason: string | null;
  impound_location: string | null;
  impounded_at: string | null;
  released_at: string | null;
}

export interface IncidentRow {
  id: string;
  type: 'emergency' | 'complaint';
  title: string;
  detail: string;
  status: string | null;
  when: string | null;
  role: string;
}

export interface ActivityRow {
  id: string;
  action: string;
  targetType: string | null;
  at: string | null;
}

export interface ProfileExtra {
  services: ProfileServices;
  vehicles: { impounded: VehicleRow[]; released: VehicleRow[] };
  incidents: { emergency: IncidentRow[]; complaints: IncidentRow[] };
  activity: ActivityRow[];
  announcements: Array<{ id: string; title: string; is_pinned: boolean; created_at: string | null }>;
  /** ประวัติการเข้าสู่ระบบ — ต้องมี migration 0033 */
  logins: LoginRow[];
  /** true = ยังไม่ได้รัน migration 0033 (ตารางไม่มีอยู่) */
  loginUnavailable: boolean;
  errors: string[];
}

export interface LoginRow {
  id: string;
  logged_in_at: string | null;
  ip_address: string | null;
  device: string | null;
}

const EMPTY = (): ProfileExtra => ({
  services: {
    created: [], assigned: [],
    stats: { createdCount: 0, totalAmount: 0, paidAmount: 0, unpaidAmount: 0, accumulatedShare: 0 },
  },
  vehicles: { impounded: [], released: [] },
  incidents: { emergency: [], complaints: [] },
  activity: [],
  announcements: [],
  logins: [],
  loginUnavailable: false,
  errors: [],
});

const asArray = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

/** ดึงข้อมูลประวัติทั้งหมดของเจ้าหน้าที่ 1 คน (ทุก query จบในตัวมันเอง ไม่ throw) */
export async function fetchProfileExtra(
  officerId: string,
  officerName: string,
): Promise<ProfileExtra> {
  const out = EMPTY();
  if (!officerId) return out;

  const [
    createdRes, assignRes, officerRes,
    vehImpRes, vehRelRes,
    emgRes, cmpRes,
    actRes, annRes, loginRes,
  ] = await Promise.all([
    // 1) ค่าบริการที่ลงบันทึกเอง
    supabase.from('service_records').select('id, roblox_username, service_name, amount, paid_amount, status, service_date, officer_name, notes')
      .eq('officer_id', officerId).order('service_date', { ascending: false }).limit(60),
    // 1b) ค่าบริการที่ถูกมอบหมายให้ร่วมทำ
    supabase.from('service_record_officers').select('service_record_id')
      .eq('officer_id', officerId),
    supabase.from('officers').select('accumulated_share').eq('id', officerId).maybeSingle(),
    // 2) รถที่ตนยึด / ปลดยึด (impounded_by_name เป็น text ไม่มี FK)
    supabase.from('vehicles').select('id, license_plate, owner_name, brand_model, color, is_impounded, impound_reason, impound_location, impounded_at, released_at')
      .eq('impounded_by_name', officerName).order('impounded_at', { ascending: false }).limit(40),
    supabase.from('vehicles').select('id, license_plate, owner_name, brand_model, color, is_impounded, impound_reason, impound_location, impounded_at, released_at')
      .eq('released_by_name', officerName).order('released_at', { ascending: false }).limit(40),
    // 3) เหตุฉุกเฉินที่ตนไปรับช่วยเหลือ (responded_by เป็น uuid จริง)
    supabase.from('emergency_reports').select('id, discord_username, report_type, details, location, status, created_at')
      .eq('responded_by', officerId).order('created_at', { ascending: false }).limit(40),
    // 3b) เรื่องร้องเรียน (officer_name เป็น text → เทียบด้วยชื่อ)
    supabase.from('complaints').select('id, complainant_name, category, description, status, created_at')
      .eq('officer_name', officerName).order('created_at', { ascending: false }).limit(40),
    // 4) กิจกรรมล่าสุดของตัวเอง
    supabase.from('audit_logs').select('id, action, target_type, created_at')
      .eq('performed_by', officerId).order('created_at', { ascending: false }).limit(30),
    // 4b) ประกาศล่าสุด
    supabase.from('announcements').select('id, title, is_pinned, created_at')
      .order('is_pinned', { ascending: false }).order('created_at', { ascending: false }).limit(8),
    // 4c) ประวัติการเข้าสู่ระบบ (migration 0033)
    supabase.from('officer_login_logs')
      .select('id, logged_in_at, ip_address, device')
      .eq('officer_id', officerId)
      .order('logged_in_at', { ascending: false }).limit(20),
  ]);

  const collect = (label: string, r: { error: { message: string } | null }) => {
    if (r.error) out.errors.push(`${label}: ${r.error.message}`);
  };
  collect('ค่าบริการ', createdRes);
  collect('รายการที่มอบหมาย', assignRes);
  collect('ยึดรถ', vehImpRes);
  collect('ปลดยึดรถ', vehRelRes);
  collect('เหตุฉุกเฉิน', emgRes);
  collect('เรื่องร้องเรียน', cmpRes);
  collect('กิจกรรม', actRes);
  if (loginRes.error && /does not exist|schema cache|PGRST/i.test(loginRes.error.message)) {
    out.loginUnavailable = true;
  } else if (loginRes.error) {
    out.errors.push(`ประวัติการเข้าสู่ระบบ: ${loginRes.error.message}`);
  }

  /* ---- ค่าบริการ ---- */
  const created = asArray<ServiceRow>(createdRes.data);
  const assignIds = new Set(
    asArray<{ service_record_id: string }>(assignRes.data).map((a) => a.service_record_id),
  );
  let assigned: ServiceRow[] = [];
  if (assignIds.size > 0) {
    const { data, error } = await supabase
      .from('service_records')
      .select('id, roblox_username, service_name, amount, paid_amount, status, service_date, officer_name, notes, officer_id')
      .in('id', [...assignIds]);
    if (error) out.errors.push(`รายการที่มอบหมาย: ${error.message}`);
    else {
      assigned = asArray<ServiceRow>(data)
        .filter((r) => r.officer_id !== officerId)
        .map(({ officer_id: _omit, ...rest }) => rest);
    }
  }

  const total = created.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const paid = created.reduce((s, r) => s + (Number(r.paid_amount) || 0), 0);
  out.services = {
    created,
    assigned,
    stats: {
      createdCount: created.length,
      totalAmount: total,
      paidAmount: paid,
      unpaidAmount: Math.max(0, total - paid),
      accumulatedShare: Number((officerRes.data as { accumulated_share?: number } | null)?.accumulated_share) || 0,
    },
  };

  /* ---- ยานพาหนะ ---- */
  const impounded = asArray<VehicleRow>(vehImpRes.data);
  const releasedIds = new Set(impounded.map((v) => v.id));
  const released = asArray<VehicleRow>(vehRelRes.data).filter((v) => !releasedIds.has(v.id));
  out.vehicles = { impounded, released };

  /* ---- เหตุฉุกเฉิน / ร้องเรียน ---- */
  out.incidents.emergency = asArray<{
    id: string; discord_username: string | null; report_type: string | null;
    details: string | null; location: string | null; status: string | null; created_at: string | null;
  }>(emgRes.data).map((r) => ({
    id: r.id,
    type: 'emergency' as const,
    title: r.report_type ?? 'เหตุฉุกเฉิน',
    detail: [r.location, r.details].filter(Boolean).join(' · ').slice(0, 140),
    status: r.status,
    when: r.created_at,
    role: 'ผู้เข้ารับช่วยเหลือ',
  }));

  out.incidents.complaints = asArray<{
    id: string; complainant_name: string | null; category: string | null;
    description: string | null; status: string | null; created_at: string | null;
  }>(cmpRes.data).map((r) => ({
    id: r.id,
    type: 'complaint' as const,
    title: r.category ?? 'เรื่องร้องเรียน',
    detail: [r.complainant_name, r.description].filter(Boolean).join(' · ').slice(0, 140),
    status: r.status,
    when: r.created_at,
    role: 'ผู้ถูกแจ้ง',
  }));

  /* ---- กิจกรรม + ประกาศ ---- */
  out.activity = asArray<{
    id: string; action: string; target_type: string | null; created_at: string | null;
  }>(actRes.data).map((r) => ({
    id: r.id, action: r.action, targetType: r.target_type, at: r.created_at,
  }));

  out.announcements = asArray<{
    id: string; title: string; is_pinned: boolean; created_at: string | null;
  }>(annRes.data);

  out.logins = asArray<LoginRow>(loginRes.data);

  return out;
}
