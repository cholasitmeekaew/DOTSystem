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
  username: string;
  password_hash: string;
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
}

export interface ClaimPreview {
  scope: 'default' | 'vehicle_rescue';
  period: string;
  officer_share_percent: number;
  record_count: number;
  gross_amount: number;
  per_officer_total: number;
  records: ClaimPreviewRecord[];
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
  created_at: string;
  updated_at: string;
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
  notes: string | null;
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
  inspector: 'ผู้คุมสอบกรมขนส่ง',
  officer: 'พนักงาน',
};

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
