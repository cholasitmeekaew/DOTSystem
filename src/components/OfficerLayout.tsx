import { ReactNode, useState } from 'react';
import {
  Truck, LayoutDashboard, Shield, DollarSign, Megaphone,
  Users, LogOut, Menu, X, ChevronRight, Tag, MessageSquare, Siren, Car, UserCog, CalendarDays, BookOpen, Award, Wallet, Newspaper,
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { RANK_LABELS, DEPARTMENT_LABELS } from '../lib/types';

const LOGO_URL = '/logo.png';

export type OfficerPage =
  | 'dashboard'
  | 'operations'
  | 'service-fees'
  | 'complaints'
  | 'announcements'
  | 'service-rates'
  | 'officer-management'
  | 'citizen-management'
  | 'emergency'
  | 'vehicles'
  | 'leave'
  | 'manual'
  | 'my-points'
  | 'points-management'
  | 'department-balance';

interface Props {
  children: ReactNode;
  currentPage: OfficerPage;
  onNavigate: (page: OfficerPage) => void;
  onLogout: () => void;
}

interface NavItem {
  id: OfficerPage;
  label: string;
  icon: ReactNode;
  commissionerOnly: boolean;
  section: 'ops' | 'admin' | 'general';
}

const navSections: { id: 'ops' | 'admin' | 'general'; label: string; adminOnly: boolean }[] = [
  { id: 'ops', label: 'การปฏิบัติงาน', adminOnly: false },
  { id: 'admin', label: 'งานบริหาร', adminOnly: true },
  { id: 'general', label: 'ทั่วไป', adminOnly: false },
];

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} />, commissionerOnly: false, section: 'ops' },
  { id: 'operations', label: 'ปฏิบัติการ', icon: <Shield size={18} />, commissionerOnly: false, section: 'ops' },
  { id: 'service-fees', label: 'ค่าบริการ', icon: <DollarSign size={18} />, commissionerOnly: false, section: 'ops' },
  { id: 'emergency', label: 'แจ้งเหตุฉุกเฉิน', icon: <Siren size={18} />, commissionerOnly: false, section: 'ops' },
  { id: 'vehicles', label: 'ยานพาหนะ', icon: <Car size={18} />, commissionerOnly: false, section: 'ops' },
  { id: 'leave', label: 'จัดการการลา', icon: <CalendarDays size={18} />, commissionerOnly: false, section: 'ops' },
  { id: 'complaints', label: 'เรื่องร้องเรียน', icon: <MessageSquare size={18} />, commissionerOnly: true, section: 'admin' },
  { id: 'announcements', label: 'ประกาศ', icon: <Megaphone size={18} />, commissionerOnly: true, section: 'admin' },
  { id: 'service-rates', label: 'อัตราค่าบริการ', icon: <Tag size={18} />, commissionerOnly: true, section: 'admin' },
  { id: 'officer-management', label: 'จัดการเจ้าหน้าที่', icon: <Users size={18} />, commissionerOnly: true, section: 'admin' },
  { id: 'citizen-management', label: 'จัดการข้อมูลประชาชน', icon: <UserCog size={18} />, commissionerOnly: true, section: 'admin' },
  { id: 'points-management', label: 'จัดการคะแนน', icon: <Award size={18} />, commissionerOnly: true, section: 'admin' },
  { id: 'department-balance', label: 'การเงิน & สัดส่วน', icon: <Wallet size={18} />, commissionerOnly: true, section: 'admin' },
  { id: 'manual', label: 'คู่มือการใช้งาน', icon: <BookOpen size={18} />, commissionerOnly: false, section: 'general' },
  { id: 'my-points', label: 'คะแนน PPS ของฉัน', icon: <Award size={18} />, commissionerOnly: false, section: 'general' },
];

export function OfficerLayout({ children, currentPage, onNavigate, onLogout }: Props) {
  const { officer, isCommissioner } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const visibleItems = navItems.filter(
    (item) => !item.commissionerOnly || isCommissioner
  );

  return (
    <div className="min-h-[100dvh] bg-navy-900 flex">
      {/* Sidebar Overlay (mobile) */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar — fixed on mobile overlay, sticky scroll on desktop */}
      <aside
        className={`fixed top-0 left-0 h-[100dvh] w-64 bg-navy-800 border-r border-blue-900/40 z-50 flex flex-col transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:translate-x-0 lg:sticky lg:top-0 lg:self-start lg:flex-shrink-0`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-blue-900/40">
          <img src={LOGO_URL} alt="Bit Cities DOT" className="h-9 w-9 rounded-lg shadow-lg flex-shrink-0" />
          <div>
            <div className="text-[10px] text-amber-500 font-semibold tracking-widest">BIT CITIES</div>
            <div className="text-sm font-bold text-white leading-tight">DOT System</div>
          </div>
          <button className="ml-auto lg:hidden text-gray-400" onClick={() => setSidebarOpen(false)}>
            <X size={18} />
          </button>
        </div>

        {/* Officer Info */}
        <div className="px-4 py-4 border-b border-blue-900/40">
          <div className="bg-navy-700 rounded-lg p-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-blue-900 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-amber-400 font-bold text-sm">{officer?.name?.charAt(0)?.toUpperCase()}</span>
              </div>
              <div className="min-w-0">
                <div className="text-white font-semibold text-sm truncate">{officer?.name}</div>
                <div className="text-amber-500 text-xs truncate">{officer ? (RANK_LABELS[officer.rank] ?? officer.rank) : ''}</div>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
              <span className="text-xs text-gray-400 truncate">
                {officer ? (DEPARTMENT_LABELS[officer.department] ?? officer.department) : ''}
              </span>
            </div>
          </div>
        </div>

        {/* Navigation — scrolls inside sidebar only, grouped by section */}
        <nav className="flex-1 min-h-0 px-3 py-4 space-y-4 overflow-y-auto overscroll-contain scrollbar-thin">
          {navSections.map((section) => {
            const items = visibleItems.filter((item) => item.section === section.id);
            if (items.length === 0) return null;
            return (
              <div key={section.id}>
                <div className="flex items-center gap-2 px-3 mb-1.5">
                  <span className="text-[10px] font-bold tracking-[0.15em] text-gray-500 uppercase">{section.label}</span>
                  {section.adminOnly && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 whitespace-nowrap">
                      หัวหน้ากรม
                    </span>
                  )}
                </div>
                <div className="space-y-1">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => { onNavigate(item.id); setSidebarOpen(false); }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group ${
                        currentPage === item.id
                          ? 'bg-amber-500/10 text-amber-300 border border-amber-500/60 shadow-[0_0_16px_-6px_rgba(245,158,11,0.5)]'
                          : 'text-gray-400 hover:text-white hover:bg-navy-700'
                      }`}
                    >
                      <span className={currentPage === item.id ? 'text-amber-300' : 'text-gray-500 group-hover:text-gray-300'}>
                        {item.icon}
                      </span>
                      <span className="flex-1 text-left">{item.label}</span>
                      {currentPage === item.id && <ChevronRight size={14} className="text-amber-300" />}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Logout — อยู่ล่างเสมอ ไม่ scroll ตาม */}
        <div className="px-3 py-4 border-t border-blue-900/40 flex-shrink-0">
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
          >
            <LogOut size={18} />
            ออกจากระบบ
          </button>
        </div>
      </aside>

      {/* Main Content — ใช้ browser scroll ทั้งหน้า */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="bg-navy-800/80 backdrop-blur border-b border-blue-900/40 px-4 lg:px-6 py-3 flex items-center gap-4 sticky top-0 z-30 flex-shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-gray-400 hover:text-white">
            <Menu size={22} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-white truncate">
              {navItems.find((n) => n.id === currentPage)?.label ?? currentPage}
            </h1>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
              officer?.is_on_duty
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
            }`}>
              {officer?.is_on_duty ? 'กำลังปฏิบัติหน้าที่' : 'ไม่ได้ปฏิบัติหน้าที่'}
            </span>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 pb-8">
          <div className="w-full max-w-7xl mx-auto p-4 lg:p-6">
            {children}
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-blue-900/40 py-5 px-4 lg:px-6 mt-auto bg-navy-900/80 backdrop-blur-sm">
          <div className="w-full max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-400">
            <div className="text-center sm:text-left">
              <div className="font-semibold text-gray-300">DOT System</div>
              <div className="mt-0.5 text-[11px] text-gray-500">ระบบบริหารจัดการเจ้าหน้าที่และงานบริการประชาชน</div>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <Newspaper size={13} className="text-amber-400" />
              <span>พันธมิตร: สำนักข่าว Bit News</span>
            </div>
            <div className="text-center text-[11px] text-gray-500 sm:text-right">
              <div>© 2026 DOT System</div>
              <div className="mt-0.5">เวอร์ชัน 1.0.0 · คู่มือการใช้งาน · ติดต่อผู้ดูแลระบบ</div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
