/* =============================================================
 * AdminMenuPage.tsx — แดชบอร์ด "เมนู Admin"
 * -------------------------------------------------------------
 * รวบรวมฟังก์ชันที่มีสิทธิ์เฉพาะหัวหน้ากรมไว้ที่เดียว
 * เพื่อไม่ให้ปนกับเมนูใช้งานประจำวันใน sidebar
 * ============================================================= */

import {
  MessageSquare, Megaphone, Tag, Users, UserCog, Award, Wallet,
  Siren, Car, ShieldAlert, Settings, FileCheck2, CalendarCheck, CalendarRange,
  BookOpen, Clock, FileText,
} from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { DepartmentStatsPanel } from '../../components/DepartmentStatsPanel';
import type { OfficerPage } from '../../components/OfficerLayout';

interface Props {
  onNavigate: (page: OfficerPage) => void;
}

interface AdminCard {
  id: OfficerPage;
  label: string;
  desc: string;
  icon: typeof Award;
  tint: string;
  ring: string;
}

const GROUPS: Array<{ title: string; note: string; items: AdminCard[] }> = [
  {
    title: 'บุคคลและข้อมูลพื้นฐาน',
    note: 'จัดการโครงสร้างหน่วยงานและประชาชน',
    items: [
      { id: 'officer-management', label: 'จัดการเจ้าหน้าที่',
        desc: 'เพิ่ม แก้ไข ลบเจ้าหน้าที่ และกำหนดตำแหน่ง/แผนก',
        icon: Users, tint: 'bg-blue-500/15 text-blue-300', ring: 'hover:border-blue-500/50' },
      { id: 'citizen-management', label: 'จัดการข้อมูลประชาชน',
        desc: 'ทะเบียนประชาชน ตรวจสอบสถานะและประวัติการติดต่อ',
        icon: UserCog, tint: 'bg-cyan-500/15 text-cyan-300', ring: 'hover:border-cyan-500/50' },
    ],
  },
  {
    title: 'คะแนน การเงิน และผลตอบแทน',
    note: 'กติกาและตัวเลขที่กระทบทั้งหน่วยงาน',
    items: [
      { id: 'points-management', label: 'จัดการคะแนน',
        desc: 'ตั้งกติกา PPS ให้/หักคะแนน และรีเซ็ตงวดรายเดือน',
        icon: Award, tint: 'bg-amber-500/15 text-amber-300', ring: 'hover:border-amber-500/50' },
      { id: 'department-balance', label: 'การเงิน & สัดส่วน',
        desc: 'รายได้ ส่วนแบ่ง และยอดคงเหลือของแต่ละแผนก',
        icon: Wallet, tint: 'bg-emerald-500/15 text-emerald-300', ring: 'hover:border-emerald-500/50' },
      { id: 'service-rates', label: 'อัตราค่าบริการ',
        desc: 'กำหนดราคาค่าบริการและค่าปรับตามประเภทงาน',
        icon: Tag, tint: 'bg-purple-500/15 text-purple-300', ring: 'hover:border-purple-500/50' },
    ],
  },
  {
    title: 'รับเรื่องและประกาศ',
    note: 'งานที่ต้องตอบสนองต่อประชาชน',
    items: [
      { id: 'complaints', label: 'เรื่องร้องเรียน',
        desc: 'รับและติดตามเรื่องร้องเรียนจากประชาชน',
        icon: MessageSquare, tint: 'bg-rose-500/15 text-rose-300', ring: 'hover:border-rose-500/50' },
      { id: 'emergency', label: 'ระบบแจ้งเหตุฉุกเฉิน',
        desc: 'รับเรื่องและจัดการเหตุฉุกเฉินที่ประชาชนแจ้ง',
        icon: Siren, tint: 'bg-red-500/15 text-red-300', ring: 'hover:border-red-500/50' },
      { id: 'announcements', label: 'ประกาศ',
        desc: 'ประกาศและประกาศรับสมัครภายในหน่วยงาน',
        icon: Megaphone, tint: 'bg-indigo-500/15 text-indigo-300', ring: 'hover:border-indigo-500/50' },
    ],
  },
  {
    title: 'ควบคุมและตั้งค่าระบบ',
    note: 'สวิตช์ที่มีผลกับทั้งหน่วยงาน',
    items: [
      { id: 'admin-settings', label: 'ตั้งค่าระบบ',
        desc: 'สวิตช์ PPS Engine, ระบบเข้าเวร และสถานะระบบ',
        icon: Settings, tint: 'bg-gray-500/15 text-gray-300', ring: 'hover:border-gray-500/50' },
      { id: 'report-approvals', label: 'อนุมัติรายงานปฏิบัติงาน',
        desc: 'ตรวจ อนุมัติ หรือไม่อนุมัติรายงานของเจ้าหน้าที่',
        icon: FileCheck2, tint: 'bg-lime-500/15 text-lime-300', ring: 'hover:border-lime-500/50' },
      { id: 'work-reports-admin', label: 'ประวัติรายงานปฏิบัติงานทั้งหมด',
        desc: 'ค้นหา ตรวจสอบ และลบรายงานปฏิบัติงานของทุกคน',
        icon: FileText, tint: 'bg-purple-500/15 text-purple-300', ring: 'hover:border-purple-500/50' },
      { id: 'duty-logs-admin', label: 'ประวัติการเข้าเวรทั้งหมด',
        desc: 'ค้นหา ตรวจสอบ และลบประวัติการเข้า–ออกเวรของทุกคน',
        icon: Clock, tint: 'bg-teal-500/15 text-teal-300', ring: 'hover:border-teal-500/50' },
      { id: 'manual-edit', label: 'แก้ไขคู่มือกรมขนส่ง',
        desc: 'เพิ่มบท แก้ชื่อหมวด และจัดลำดับบล็อกเนื้อหา+รูปภาพ',
        icon: BookOpen, tint: 'bg-indigo-500/15 text-indigo-300', ring: 'hover:border-indigo-500/50' },
      { id: 'roster-admin', label: 'จัดการตารางเวร',
        desc: 'สุ่มเวรประจำสัปดาห์ แก้ไขผัง และสลับเวรรายวัน',
        icon: CalendarRange, tint: 'bg-amber-500/15 text-amber-300', ring: 'hover:border-amber-500/50' },
      { id: 'leave-approvals', label: 'พิจารณาคำขอลา',
        desc: 'อนุมัติ / ไม่อนุมัติ / แก้ไข / ลบ คำขอลาของทุกคน',
        icon: CalendarCheck, tint: 'bg-teal-500/15 text-teal-300', ring: 'hover:border-teal-500/50' },
    ],
  },
  {
    title: 'ทะเบียนยานพาหนะ',
    note: 'ข้อมูลรถของหน่วยงาน',
    items: [
      { id: 'vehicles', label: 'ระบบยานพาหนะ',
        desc: 'ลงทะเบียน ตรวจสอบ และจัดการการยึดรถ',
        icon: Car, tint: 'bg-slate-500/15 text-slate-300', ring: 'hover:border-slate-500/50' },
    ],
  },
];

export function AdminMenuPage({ onNavigate }: Props) {
  return (
    <div>
      <PageHeader
        icon={<ShieldAlert size={26} />}
        title="เมนู Admin"
        subtitle="ศูนย์รวมฟังก์ชันสำหรับหัวหน้ากรม — เจ้าหน้าที่ทั่วไปไม่สามารถเข้าถึงส่วนนี้ได้"
      />

      <div className="flex items-start gap-2.5 text-[12px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3.5 py-2.5 mb-5">
        <ShieldAlert size={15} className="mt-0.5 flex-shrink-0" />
        <span className="leading-relaxed">
          ทุกเมนูด้านล่างมีสิทธิ์เฉพาะหัวหน้ากรม
          เจ้าหน้าที่ทั่วไปจะไม่เห็นเมนูนี้ใน sidebar และถูกพากลับหน้าแรกถ้าพยายามเข้าผ่านลิงก์ตรง
        </span>
      </div>

      <div className="space-y-6">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <div className="flex items-baseline gap-2 mb-2.5">
              <h2 className="text-sm font-bold text-white">{g.title}</h2>
              <span className="text-[11px] text-gray-500">{g.note}</span>
            </div>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {g.items.map((it) => {
                const Icon = it.icon;
                return (
                  <button
                    key={it.id}
                    onClick={() => onNavigate(it.id)}
                    className={`card px-4 py-3.5 text-left flex items-start gap-3 transition-colors ${it.ring}`}
                  >
                    <span className={`p-2.5 rounded-xl flex-shrink-0 ${it.tint}`}>
                      <Icon size={19} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold text-white">{it.label}</span>
                      <span className="block text-[11px] text-gray-400 leading-relaxed mt-0.5">
                        {it.desc}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* สถิติการปฏิบัติหน้าที่ — ย้ายมาจากหน้าปฏิบัติงาน */}
      <section className="mt-8">
        <div className="flex items-baseline gap-2 mb-2.5">
          <h2 className="text-sm font-bold text-white">สถิติการปฏิบัติหน้าที่ — รวมทั้งกรม</h2>
          <span className="text-[11px] text-gray-500">ดูแล้วย้ายมาจากหน้าปฏิบัติงาน</span>
        </div>
        <DepartmentStatsPanel />
      </section>
    </div>
  );
}
