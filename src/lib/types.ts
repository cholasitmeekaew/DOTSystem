export type OfficerRank = string;
export type OfficerStatus = 'active' | 'suspended' | 'deleted';

export interface OfficerRankRecord {
  id: string;
  label: string;
  rank_key: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
export type ServiceStatus = 'paid' | 'unpaid'; // 'partial' is rendered in UI when 0 < paid_amount < amount
export type ServiceType = 'normal' | 'impound';

export type Department =
  | 'civil_maintenance'
  | 'vehicle_rescue'
  | 'electrical'
  | 'traffic_management'
  | 'emergency_assistance';

export interface Officer {
  id: string;
  /** รหัสเจ้าหน้าที่ เช่น CDT-01 (แยกจากชื่อ — migration 0050) */
  officer_code?: string | null;
  /**
   * ย้ายข้อมูลเข้าระบบ (username / password_hash) ไปไว้ใน schema `private`
   * แล้ว (migration 0043) — anon อ่านจากตาราง officers ไม่ได้อีกต่อไป
   *
   * โหลดได้เฉพาะตอนล็อกอินผ่าน `login_officer()` เท่านั้น
   */
  username?: string;
  password_hash?: string;
  name: string;
  rank: OfficerRank;
  department: Department;
  status: OfficerStatus;
  is_on_duty: boolean;
  photo_url: string | null;
  // Performance Point System (optional — column added in migration 0006)
  points?: number;
  points_period?: string | null;
  points_log?: PointsLogEntry[];
  // Rates (optional — column added in migration 0007)
  duty_rate?: number;
  service_category?: string | null;
  // Claim share accumulator (optional — column added in migration 0009)
  accumulated_share?: number;
  // Generation / batch (optional — column added in migration 0027)
  generation?: string | null;
  // Manual display priority set by the commissioner (optional — column added in migration 0027)
  sort_order?: number | null;
  created_at: string;
  updated_at: string;
}

/** ตารางอ้างอิง "รุ่น" (Generation) — migration 0027 */
export interface OfficerGenerationRecord {
  id: string;
  label: string;
  generation_key: string | null;
  sort_order: number;
  /** true = กลุ่มพนักงานทดลองงาน */
  is_trainee: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DepartmentBalance {
  department: string;
  balance: number;
  total_earned: number;
  updated_at: string;
}

export interface OfficerPayrollOverride {
  officer_id: string;
  period_month: string;
  manual_duty_income: number | null;
  manual_service_income: number | null;
  manual_bonus: number | null;
  manual_total_net_payout: number | null;
  is_manual_mode: boolean;
  updated_at: string;
  updated_by_id: string;
  updated_by_name: string;
}

export const SERVICE_CATEGORIES = [
  { value: 'vehicle_rescue', label: 'กู้ภัยรถยก' },
  { value: 'civil_maintenance', label: 'โยธาซ่อมบำรุง' },
  { value: 'electrical', label: 'การไฟฟ้า' },
  { value: 'traffic_management', label: 'จัดการจราจร' },
  { value: 'emergency_assistance', label: 'ช่วยเหลือฉุกเฉิน' },
  { value: 'general', label: 'ทั่วไป' },
] as const;

export interface Announcement {
  id: string;
  title: string;
  content: string;
  image_url: string | null;
  is_pinned: boolean;
  created_by: string | null;
  created_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface ServiceRate {
  id: string;
  rate_key?: string | null;
  name: string;
  description: string;
  price: number;
  category: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ServiceRecord {
  id: string;
  roblox_username: string;
  discord_username: string;
  service_rate_id: string | null;
  service_name: string;
  amount: number;
  // Payment installments (added in migration 0011)
  paid_amount?: number;
  status: ServiceStatus;
  service_type: ServiceType;
  officer_id: string | null;
  officer_name: string;
  notes: string;
  evidence_url: string | null;
  service_date: string;
  citizen_id: string | null;
  // Revenue sharing (added in migration 0008)
  officer_share?: number;
  central_share?: number;
  assigned_officer_count?: number;
  // Service category for scope calculation (optional — may be inferred from service_name)
  service_category?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServicePayment {
  id: string;
  service_record_id: string;
  amount: number;
  recorded_by: string | null;
  recorded_by_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceRecordOfficer {
  service_record_id: string;
  officer_id: string;
  assigned_at: string;
  assigned_by: string | null;
}

export interface RevenueConfig {
  scope: 'default' | 'vehicle_rescue';
  officer_share_percent: number;
  central_share_percent: number;
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface RevenueOverride {
  service_record_id: string;
  officer_share: number;
  central_share: number;
  reason: string | null;
  edited_at: string;
  edited_by: string | null;
}

export type ClaimStatus = 'pending' | 'approved' | 'rejected' | 'paid';

export interface ClaimRecord {
  id: string;
  officer_id: string;
  service_record_id: string | null;
  amount: number;
  scope: 'default' | 'vehicle_rescue';
  officer_share_percent: number;
  claim_period: string;
  record_count: number;
  status: ClaimStatus;
  claimed_by: string;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  paid_by: string | null;
  paid_at: string | null;
  note: string | null;
  created_at: string;
}

export interface ClaimPreviewRecord {
  id: string;
  service_name: string;
  amount: number;
  assigned_count: number;
  per_officer_share: number;
  /** เดือนของบิลนี้ (YYYY-MM) — มีเมื่อรวมหลายเดือนเข้าด้วยกัน */
  month?: string;
  /** หมวดของบิลนี้ — มีเมื่อรวมทั้งสองหมวดเข้าด้วยกัน */
  scope?: 'default' | 'vehicle_rescue';
}

export interface ClaimPreviewMonth {
  month: string;
  record_count: number;
  total: number;
}

export interface ClaimPreview {
  scope: 'default' | 'vehicle_rescue';
  period: string;
  /** false = งวดนี้ยังไม่ปิดเดือน รับไม่ได้ */
  closed?: boolean;
  officer_share_percent: number;
  record_count: number;
  gross_amount: number;
  per_officer_total: number;
  records: ClaimPreviewRecord[];
  /** เดือนที่ถูกรวมมาด้วย (อาจมากกว่า 1 เดือน เพราะเดือนที่ลืมกดจะสะสมไว้) */
  months?: ClaimPreviewMonth[];
}

/** สรุปส่วนแบ่งที่ยังไม่ได้รับ รายคน-รายเดือน สำหรับหัวหน้ากรม */
export interface PendingClaimSummary {
  officer_id: string;
  officer_name: string;
  month: string;
  record_count: number;
  gross_amount: number;
  officer_total: number;
  scope: 'default' | 'vehicle_rescue';
}

export interface DutyLog {
  id: string;
  officer_id: string | null;
  officer_name: string;
  clock_in: string;
  clock_out: string | null;
  duration_minutes: number | null;
  forced_by: string | null;
  forced_by_name: string | null;
  checkout_method: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  deleted_by_name: string | null;
  delete_reason: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  performed_by: string | null;
  performed_by_name: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface WorkReport {
  id: string;
  officer_id: string;
  officer_name: string;
  duty_log_id: string | null;
  duty_category?: string | null;
  summary: string | null;
  report_text: string;
  cases?: WorkReportCase[];
  // Review flow (added in migration 0028)
  status?: WorkReportStatus;
  reviewed_by?: string | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  reviewed_points?: number;
  created_at: string;
  updated_at: string;
}

export type WorkReportStatus = 'pending' | 'approved' | 'rejected';

export const WORK_REPORT_STATUS_LABELS: Record<WorkReportStatus, string> = {
  pending: 'รอตรวจ',
  approved: 'อนุมัติแล้ว',
  rejected: 'ไม่อนุมัติ',
};

/* ============== ตารางเวรปฏิบัติงาน (migration 0028, ปรับใน 0029) ==============
 * กะเปลี่ยนจาก "กะเช้า/กะดึก" เป็น "กะที่ 1 / กะที่ 2" ให้ตรงกับเวลาเปิดเซิร์ฟเวอร์จริง
 *   จันทร์–ศุกร์    เซิร์ฟเปิด 18:30–21:30 → กะที่ 1: 18:30–20:00 · กะที่ 2: 20:00–21:30
 *   เสาร์–อาทิตย์ เซิร์ฟเปิด 18:30–23:00 → กะที่ 1: 18:30–20:45 · กะที่ 2: 20:45–23:00
 * ======================================================================== */

export type ShiftCode = 's1' | 's2';
export type ScheduleCellCode = ShiftCode | 'off';

/** ตารางเวลาของแต่ละกะ แยกตามประเภทวัน */
export interface ShiftWindow {
  start: string;
  end: string;
}

export const WEEKDAY_SHIFT_WINDOWS: Record<ShiftCode, ShiftWindow> = {
  s1: { start: '18:30', end: '20:00' },
  s2: { start: '20:00', end: '21:30' },
};

export const WEEKEND_SHIFT_WINDOWS: Record<ShiftCode, ShiftWindow> = {
  s1: { start: '18:30', end: '20:45' },
  s2: { start: '20:45', end: '23:00' },
};

/** เวลาเปิด/ปิดเซิร์ฟเวอร์ */
export const SERVER_HOURS = {
  weekday: { start: '18:30', end: '21:30' },
  weekend: { start: '18:30', end: '23:00' },
} as const;

/** 0 = อาทิตย์, 6 = เสาร์ → เป็นวันหยุด */
export function isWeekend(weekday: number): boolean {
  return weekday === 0 || weekday === 6;
}

export interface DutySchedule {
  id: string;
  /** 0 = อาทิตย์ ... 6 = เสาร์ */
  weekday: number;
  shift_code: ShiftCode;
  shift_name: string | null;
  start_time: string;
  end_time: string;
  officer_id: string | null;
  /** จำนวนคนที่ต้องการในกะนี้ (migration 0030) — 1 ช่องกะมีหลายคนได้ */
  required_officers?: number;
  note: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type ScheduleOverrideType = 'swap' | 'leave' | 'extra' | 'off';
export type ScheduleOverrideSource = 'manual' | 'leave_auto';

export interface ScheduleOverride {
  id: string;
  /** YYYY-MM-DD */
  override_date: string;
  shift_code: ScheduleCellCode;
  officer_id: string | null;
  override_type: ScheduleOverrideType;
  /** กำลังพลที่ต้องการเฉพาะวันนี้ (migration 0030) — ไม่ระบุ = ใช้ค่าของตารางหลัก */
  required_officers?: number | null;
  note: string | null;
  source: ScheduleOverrideSource;
  ref_id: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export const WEEKDAY_LABELS: Record<number, string> = {
  0: 'อาทิตย์',
  1: 'จันทร์',
  2: 'อังคาร',
  3: 'พุธ',
  4: 'พฤหัสบดี',
  5: 'ศุกร์',
  6: 'เสาร์',
};

export const WEEKDAY_SHORT: Record<number, string> = {
  0: 'อา.',
  1: 'จ.',
  2: 'อ.',
  3: 'พ.',
  4: 'พฤ.',
  5: 'ศ.',
  6: 'ส.',
};

export const SHIFT_LABELS: Record<ScheduleCellCode, string> = {
  s1: 'กะที่ 1',
  s2: 'กะที่ 2',
  off: 'หยุด',
};

export const OVERRIDE_TYPE_LABELS: Record<ScheduleOverrideType, string> = {
  swap: 'เวรสลับ',
  leave: 'ลา',
  extra: 'เวรพิเศษ',
  off: 'หยุดประจำสัปดาห์',
};

/* ============== โควตาการลา (migration 0028) ============== */

export interface LeaveQuota {
  leave_type: LeaveType;
  /** 0 = ไม่จำกัดโควตา */
  quota_days: number;
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
  updated_by_name: string | null;
}

/** โควตาตั้งต้น (วัน/คน/เดือน) — ใช้เมื่อยังไม่ได้ตั้งค่าใน leave_quotas */
export const DEFAULT_LEAVE_QUOTAS: Record<LeaveType, number> = {
  sick: 3,
  personal: 2,
  vacation: 3,
  maternity: 0,
  ordained: 0,
  other: 0,
};

/* ============== ป้ายกำกับป้องกันคะแนนซ้ำ (migration 0028) ============== */

export interface PointsAwardMark {
  id: string;
  mark_key: string;
  officer_id: string | null;
  delta: number;
  reason: string | null;
  created_at: string;
}

export interface WorkReportCase {
  id: string;
  work_report_id: string;
  case_name?: string | null;
  case_type: string | null;
  citizen_username?: string | null;
  citizen_id?: string | null;
  case_status?: 'completed' | 'in_progress' | 'transferred' | string | null;
  details: string;
  evidence_url: string | null;
  created_at: string;
}

export interface SystemSettings {
  id: number;
  duty_system_enabled: boolean;
  login_enabled: boolean;
  /** สวิตช์เปิด/ปิดการให้คะแนนอัตโนมัติ (migration 0028) */
  auto_points_enabled?: boolean;
  /** สวิตช์เปิด/ปิดการรายงานปฏิบัติงาน (migration 0034) */
  work_reports_enabled?: boolean;
  /**
   * โหมดปิดปรับปรุงระบบ (migration 0051 → 0053)
   * 'off' | 'standard' | 'readonly' | 'emergency'
   */
  maintenance_mode?: string;
  /** หัวข้อหน้า maintenance (migration 0052) */
  maintenance_title?: string | null;
  /** เนื้อหาที่แสดงให้ผู้ใช้เห็นเมื่อระบบปิดปรับปรุง */
  maintenance_message?: string | null;
  /** ข้อความรองใต้หัวข้อ (migration 0054) */
  maintenance_subtitle?: string | null;
  maintenance_eta_label?: string | null;
  /** เวลาคาดว่าจะเสร็จ — นับถอยหลัง (migration 0054) */
  maintenance_eta?: string | null;
  updated_at: string;
  updated_by: string | null;
  updated_by_name: string | null;
}

export interface License {
  id: string;
  roblox_username: string;
  discord_username: string | null;
  license_type: string;
  license_number: string | null;
  issue_date: string;
  expiry_date: string | null;
  status: string;
  issued_by: string | null;
  issued_by_name: string | null;
  notes: string | null;
  citizen_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Complaint {
  id: string;
  complainant_name: string | null;
  complainant_contact: string | null;
  officer_name: string | null;
  category: string | null;
  description: string | null;
  discord_username: string | null;
  incident_datetime: string | null;
  details: string | null;
  evidence_url: string | null;
  status: string;
  created_at: string;
}

export type EmergencyReportType = 'accident' | 'breakdown' | 'towing' | 'other';
export type EmergencyReportStatus = 'pending' | 'responding' | 'resolved' | 'dismissed';

export interface EmergencyReport {
  id: string;
  discord_username: string;
  report_type: EmergencyReportType;
  details: string;
  location: string;
  image_url: string | null;
  status: EmergencyReportStatus;
  responded_by: string | null;
  responded_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export const EMERGENCY_TYPE_LABELS: Record<EmergencyReportType, string> = {
  accident: 'อุบัติเหตุจราจร',
  breakdown: 'รถเสีย',
  towing: 'ต้องการรถยก',
  other: 'อื่นๆ',
};

export const EMERGENCY_STATUS_LABELS: Record<EmergencyReportStatus, string> = {
  pending: 'รอดำเนินการ',
  responding: 'กำลังเข้าช่วยเหลือ',
  resolved: 'จัดการเรียบร้อย',
  dismissed: 'ยกเลิก',
};

export type VehicleType = 'sedan' | 'suv' | 'pickup' | 'motorcycle' | 'truck' | 'van' | 'other';

export interface Vehicle {
  id: string;
  license_plate: string;
  owner_name: string | null;
  vehicle_type: VehicleType;
  color: string | null;
  brand_model: string | null;
  vehicle_category: string | null;
  citizen_id: string | null;
  is_impounded: boolean;
  impound_reason: string | null;
  impound_location: string | null;
  impounded_at: string | null;
  impounded_by: string | null;
  impounded_by_name: string | null;
  released_at: string | null;
  released_by: string | null;
  released_by_name: string | null;
  notes: string | null;
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

export type CitizenStatus = 'normal' | 'watched' | 'suspended' | 'banned';

export interface Citizen {
  id: string;
  roblox_username: string;
  discord_username: string | null;
  status: CitizenStatus;
  /**
   * บันทึกภายในของเจ้าหน้าที่
   *
   * ย้ายออกจากตาราง citizens แล้ว (migration 0044) เพราะ anon อ่านได้
   * ต้องโหลดผ่าน `fetchCitizenNote()` / `withCitizenNotes()` เท่านั้น
   * จึงเป็น optional — query ปกติจะไม่ได้ค่านี้มา
   */
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export const CITIZEN_STATUS_LABELS: Record<CitizenStatus, string> = {
  normal: 'ปกติ',
  watched: 'เฝ้าระวัง',
  suspended: 'ระงับสิทธิ์',
  banned: 'แบน',
};

export const VEHICLE_CATEGORY_LABELS: Record<string, string> = {
  personal: 'รถส่วนตัว',
  public: 'รถสาธารณะ',
  transport: 'รถขนส่ง',
};

export const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = {
  sedan: 'รถเก๋ง',
  suv: 'รถ SUV',
  pickup: 'รถกระบะ',
  motorcycle: 'รถจักรยานยนต์',
  truck: 'รถบรรทุก',
  van: 'รถตู้',
  other: 'อื่นๆ',
};

// Legacy fallback labels — used only before ranks are loaded from DB
export const RANK_LABELS: Record<string, string> = {
  commissioner: 'หัวหน้ากรมขนส่ง',
  // ⚠ rank_key ตัวนี้มาจากตาราง officer_ranks ไม่ใช่ค่าคงที่ในระบบ
  //   ถ้าไม่แมปไว้ หน้าจอจะโชว์คีย์ดิบว่า "Deputy Head"
  'Deputy Head': 'รองหัวหน้ากรมขนส่ง',
  inspector: 'ผู้คุมสอบกรมขนส่ง',
  officer: 'พนักงาน',
};

/** Fallback label ของ "รุ่น" — ใช้เมื่อ officer_generations ยังโหลดไม่เสร็จ / ไม่มีในระบบ */
export const GENERATION_FALLBACK_LABELS: Record<string, string> = {
  '1': 'รุ่นที่ 1',
  '2': 'รุ่นที่ 2',
  '3': 'รุ่นที่ 3',
};

/** ข้อความแสดงผลเมื่อเจ้าหน้าที่ยังไม่ได้ระบุรุ่น */
export const GENERATION_UNSET_LABEL = 'ไม่ระบุรุ่น';

export const DEPARTMENT_LABELS: Record<Department, string> = {
  civil_maintenance: 'โยธาซ่อมบำรุง',
  vehicle_rescue: 'กู้ภัยรถยก',
  electrical: 'การไฟฟ้า',
  traffic_management: 'จัดการจราจร',
  emergency_assistance: 'ช่วยเหลือฉุกเฉิน',
};

export const DEPARTMENTS: Department[] = [
  'civil_maintenance',
  'vehicle_rescue',
  'electrical',
  'traffic_management',
  'emergency_assistance',
];

// The commissioner rank identifier — always stored as this string in officers.rank
export const COMMISSIONER_RANK = 'commissioner';

export type LeaveType = 'sick' | 'personal' | 'vacation' | 'maternity' | 'ordained' | 'other';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface OfficerLeave {
  id: string;
  officer_id: string | null;
  officer_name: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  status: LeaveStatus;
  reason: string | null;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  /** จำนวนวันลา (cache สำหรับคำนวณโควตา — migration 0028) */
  days?: number;
  created_at: string;
  updated_at: string;
}

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  sick: 'ลาป่วย',
  personal: 'ลากิจ',
  vacation: 'ลาพักร้อน',
  maternity: 'ลาคลอด',
  ordained: 'ลาบวช',
  other: 'อื่นๆ',
};

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: 'รอพิจารณา',
  approved: 'อนุมัติ',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก',
};

export const VEHICLE_BRAND_MODELS: Record<string, string[]> = {
  Toyota: ['Vios', 'Yaris', 'Corolla Altis', 'Camry', 'Fortuner', 'Hilux Revo', 'Innova', 'C-HR', 'Avanza', 'Alphard'],
  Honda: ['Civic', 'City', 'Accord', 'HR-V', 'CR-V', 'BR-V', 'Jazz', 'Brio', 'HR-V e:HEV', 'Civic Type R'],
  Nissan: ['Almera', 'Sylphy', 'Navara', 'Terra', 'Kicks e-Power', 'Almera Turbo', 'GT-R'],
  Mazda: ['2', '3', 'CX-3', 'CX-30', 'CX-5', 'CX-8', 'CX-9', 'MX-5', 'BT-50'],
  Mitsubishi: ['Mirage', 'Attrage', 'Xpander', 'Pajero Sport', 'Triton', 'Outlander', 'Eclipse Cross'],
  Suzuki: ['Swift', 'Ciaz', 'XL7', 'Ertiga', 'Jimny', 'Vitara', 'S-Presso', 'Carry'],
  Ford: ['Ranger', 'Everest', 'Focus', 'Fiesta', 'EcoSport', 'Territory', 'Mustang', 'Raptor'],
  Chevrolet: ['Aveo', 'Sail', 'Trailblazer', 'Colorado', 'Spark', 'Cruze', 'Captiva'],
  Isuzu: ['D-Max', 'MU-X', 'M-Series', 'N-Series'],
  MG: ['MG3', 'MG ZS', 'MG HS', 'MG Extender', 'MG4 EV', 'MG5', 'MG6'],
  BYD: ['Dolphin', 'Atto 3', 'Seal', 'M6', 'EA1', 'Song Plus'],
  GWM: ['Haval H6', 'Haval Jolion', 'Ora Good Cat', 'Ora Black Cat', 'Poer'],
  BMW: ['3 Series', '5 Series', '7 Series', 'X1', 'X3', 'X5', 'X7', 'M3', 'M5'],
  Mercedes: ['A-Class', 'C-Class', 'E-Class', 'S-Class', 'GLA', 'GLC', 'GLE', 'GLS'],
  Audi: ['A3', 'A4', 'A6', 'Q3', 'Q5', 'Q7', 'Q8', 'e-tron'],
  Volvo: ['XC40', 'XC60', 'XC90', 'S60', 'S90', 'V60', 'V90', 'EX30', 'EX90'],
  Porsche: ['911', 'Cayenne', 'Macan', 'Taycan', 'Panamera', '718 Cayman'],
  Tesla: ['Model 3', 'Model S', 'Model X', 'Model Y', 'Cybertruck'],
  Hyundai: ['Elantra', 'Accent', 'Tucson', 'Santa Fe', 'IONIQ 5', 'IONIQ 6', 'Creta'],
  Kia: ['Cerato', 'Seltos', 'Sportage', 'Sorento', 'EV6', 'Picanto', 'Morning'],
  Subaru: ['Impreza', 'XV', 'Forester', 'Outback', 'Crosstrek', 'BRZ'],
  Lexus: ['IS', 'ES', 'RX', 'NX', 'LX', 'UX', 'LC', 'RC'],
  'อื่นๆ': ['อื่นๆ'],
};

export const VEHICLE_COLORS: { label: string; value: string }[] = [
  { label: 'สีขาว', value: 'ขาว' },
  { label: 'สีดำ', value: 'ดำ' },
  { label: 'สีเงิน', value: 'เงิน' },
  { label: 'สีเทา', value: 'เทา' },
  { label: 'สีแดง', value: 'แดง' },
  { label: 'สีน้ำเงิน', value: 'น้ำเงิน' },
  { label: 'สีน้ำตาล', value: 'น้ำตาล' },
  { label: 'สีเขียว', value: 'เขียว' },
  { label: 'สีเหลือง', value: 'เหลือง' },
  { label: 'สีส้ม', value: 'ส้ม' },
  { label: 'สีม่วง', value: 'ม่วง' },
  { label: 'สีชมพู', value: 'ชมพู' },
  { label: 'สีทอง', value: 'ทอง' },
  { label: 'สีนากี', value: 'นากี' },
  { label: 'สีฟ้า', value: 'ฟ้า' },
  { label: 'สีครีม', value: 'ครีม' },
  { label: 'สีเบจ', value: 'เบจ' },
  { label: 'สีไวน์แดง', value: 'ไวน์แดง' },
  { label: 'สีน้ำตาลเข้ม', value: 'น้ำตาลเข้ม' },
  { label: 'สีเทาเข้ม', value: 'เทาเข้ม' },
  { label: 'สีอื่นๆ', value: 'อื่นๆ' },
];

// ============== Performance Point System (PPS) ==============

export interface PointsLogEntry {
  at: string;             // ISO timestamp
  by: string;             // user id คนกระทำ
  by_name: string;        // ชื่อคนกระทำ
  delta: number;          // +10 / -20
  reason: string;         // เหตุผล
  balance_after: number;  // คะแนนคงเหลือหลังทำรายการ
  period: string;         // 'YYYY-MM'
}

export const POINTS_REWARDS: { label: string; delta: number }[] = [
  { label: 'ลงเวลาปฏิบัติหน้าที่ครบ 1 สัปดาห์', delta: 5 },
  { label: 'ปฏิบัติหน้าที่ครบ 1 ชั่วโมง (เซิฟเปิด-เซิฟปิด)', delta: 5 },
  { label: 'รับแจ้งเหตุและดำเนินการสำเร็จ', delta: 10 },
  { label: 'ช่วยเหลือรถเสีย', delta: 10 },
  { label: 'ลากรถสำเร็จ', delta: 10 },
  { label: 'จัดการจราจรในอุบัติเหตุ', delta: 10 },
  { label: 'ปฏิบัติงานร่วมกับ Police / Fire / EMS', delta: 15 },
  { label: 'ได้รับคำชมจากประชาชนหรือผู้บังคับบัญชา', delta: 15 },
  { label: 'เข้าร่วมการฝึกอบรม / ผ่านการทดสอบประจำเดือน', delta: 20 },
  { label: 'ปฏิบัติหน้าที่ในกิจกรรมพิเศษของเมือง', delta: 30 },
];

export const POINTS_PENALTIES: { label: string; delta: number }[] = [
  { label: 'ไม่เข้าเวรเกิน 1 สัปดาห์', delta: -5 },
  { label: 'ไม่แต่งเครื่องแบบถูกต้อง', delta: -5 },
  { label: 'ไม่รายงานตัวทางวิทยุ', delta: -10 },
  { label: 'ใช้วิทยุไม่ถูกระเบียบ', delta: -10 },
  { label: 'ละทิ้งหน้าที่', delta: -15 },
  { label: 'ใช้รถราชการผิดวัตถุประสงค์', delta: -20 },
  { label: 'ทำรถราชการเสียหายจากความประมาท', delta: -20 },
  { label: 'ฝ่าฝืน SOP', delta: -20 },
  { label: 'ไม่เชื่อฟังคำสั่งผู้บังคับบัญชา', delta: -25 },
  { label: 'ประพฤติตนไม่เหมาะสม', delta: -30 },
  { label: 'ใช้อำนาจโดยมิชอบ', delta: -50 },
  { label: 'ทุจริตหรือแอบอ้างหน้าที่', delta: -100 },
];

export const POINTS_LEVELS = [
  // คะแนนติดลบ = ยังติดหนี้คะแนนจากการถูกหัก ต้องได้คะแนนกลับมาเพื่อทำให้ครบ 0 ก่อน
  { min: -Infinity, max: -1,  label: 'ติดหนี้คะแนน',      color: 'red',     ringClass: 'ring-red-500/40',     bgClass: 'bg-red-500/20',     textClass: 'text-red-300' },
  { min: 0,    max: 99,        label: 'ต้องปรับปรุง',       color: 'red',     ringClass: 'ring-red-500/30',     bgClass: 'bg-red-500/10',     textClass: 'text-red-400' },
  { min: 100,  max: 249,       label: 'ผ่านเกณฑ์',          color: 'amber',   ringClass: 'ring-amber-500/30',   bgClass: 'bg-amber-500/10',   textClass: 'text-amber-400' },
  { min: 250,  max: 499,       label: 'ดี',                 color: 'emerald', ringClass: 'ring-emerald-500/30', bgClass: 'bg-emerald-500/10', textClass: 'text-emerald-400' },
  { min: 500,  max: 799,       label: 'ดีมาก',              color: 'blue',    ringClass: 'ring-blue-500/30',    bgClass: 'bg-blue-500/10',    textClass: 'text-blue-400' },
  { min: 800,  max: 999,       label: 'ดีเด่น',             color: 'purple',  ringClass: 'ring-purple-500/30',  bgClass: 'bg-purple-500/10',  textClass: 'text-purple-400' },
  { min: 1000, max: Infinity,  label: 'เจ้าหน้าที่ดีเด่น', color: 'amber',   ringClass: 'ring-amber-400/40',  bgClass: 'bg-amber-500/15',   textClass: 'text-amber-300' },
] as const;

export function getPointsLevel(points: number) {
  return POINTS_LEVELS.find((l) => points >= l.min && points <= l.max) ?? POINTS_LEVELS[0];
}

export function getNextPointsLevel(points: number) {
  return POINTS_LEVELS.find((l) => l.min > points) ?? null;
}

/**
 * ความคืบหน้าเป็นเปอร์เซ็นต์ไปยังระดับถัดไป
 *
 * ต้องแยกกรณีคะแนนติดลบออกมาต่างหาก เพราะระดับ "ติดหนี้คะแนน"
 * ใช้ -Infinity เป็นขอบล่าง ถ้านำไปคิดสูตรเดียวกับของเดิมจะได้ NaN
 *
 * ขณะติดหนี้ เป้าหมายคือ "ทำให้คะแนนเป็น 0" ไม่ใช่ระดับถัดไป
 */
export function getPointsProgress(points: number): {
  percent: number;
  /** ระดับเป้าหมายถัดไป (null = ถึงระดับสูงสุดแล้ว) */
  next: typeof POINTS_LEVELS[number] | null;
  /** ต้องกู้คืนอีกกี่คะแนนจึงหลุดหนี้ (0 = ไม่ติดหนี้) */
  debt: number;
} {
  const debt = points < 0 ? -points : 0;
  if (debt > 0) {
    // เดิมหนี้มาแล้วเท่าไร → คืนหายกี่คะแนนจนเป็น 0
    // ยิ่งหนี้เยอะ progress ยิ่งต่ำ (เพิ่งติดหนี้ = 0%, กู้เกือบหมด = ~100%)
    const cleared = Math.max(0, Math.min(1, 1 - debt / Math.max(1, debt + 100)));
    return {
      percent: Math.round(cleared * 100),
      next: POINTS_LEVELS[1],
      debt,
    };
  }

  const level = getPointsLevel(points);
  const next = getNextPointsLevel(points);
  const percent = next
    ? Math.min(100, Math.round(((points - level.min) / (next.min - level.min)) * 100))
    : 100;
  return { percent, next, debt: 0 };
}
