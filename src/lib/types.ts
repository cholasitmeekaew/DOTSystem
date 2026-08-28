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
export type ServiceStatus = 'paid' | 'unpaid';
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
  created_at: string;
  updated_at: string;
}

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
  status: ServiceStatus;
  service_type: ServiceType;
  officer_id: string | null;
  officer_name: string;
  notes: string;
  evidence_url: string | null;
  service_date: string;
  citizen_id: string | null;
  created_at: string;
  updated_at: string;
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

export type CitizenStatus = 'normal' | 'watched' | 'suspended';

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
  probation: 'พนักงานทดลองงาน',
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
