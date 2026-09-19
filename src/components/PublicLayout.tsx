import { ReactNode, useEffect, useState } from 'react';
import { Truck, Users, LogIn, Tag, MessageSquare, Siren, Menu, X, IdCard, BarChart3, ChevronRight, Trophy, ScrollText, Newspaper, BookOpen } from 'lucide-react';

export const LOGO_URL = '/logo.png';

export type PublicPage =
  | 'home'
  | 'citizen'
  | 'personnel'
  | 'stats'
  | 'rates'
  | 'complaint'
  | 'emergency'
  | 'leaderboard'
  | 'manual'
  | 'terms'
  | 'login';

interface Props {
  children: ReactNode;
  currentPage: PublicPage;
  onNavigate: (page: PublicPage) => void;
}

const navLinks: { id: PublicPage; label: string; icon: ReactNode }[] = [
  { id: 'home', label: 'หน้าแรก', icon: <Truck size={18} /> },
  { id: 'citizen', label: 'ระบบประชาชน', icon: <Users size={18} /> },
  { id: 'personnel', label: 'ทำเนียบบุคลากร', icon: <IdCard size={18} /> },
  { id: 'stats', label: 'สถิติหน่วยงาน', icon: <BarChart3 size={18} /> },
  { id: 'rates', label: 'อัตราค่าบริการ', icon: <Tag size={18} /> },
  { id: 'complaint', label: 'ร้องเรียน', icon: <MessageSquare size={18} /> },
  { id: 'emergency', label: 'แจ้งเหตุฉุกเฉิน', icon: <Siren size={18} /> },
  { id: 'leaderboard', label: 'อันดับคะแนน PPS', icon: <Trophy size={18} /> },
  { id: 'manual', label: 'คู่มือการใช้งาน', icon: <BookOpen size={18} /> },
  { id: 'terms', label: 'ข้อกำหนดการใช้งาน', icon: <ScrollText size={18} /> },
];

export function PublicLayout({ children, currentPage, onNavigate }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ล็อก scroll ของ body เมื่อ sidebar เปิด (mobile) + ปิดด้วย ESC
  useEffect(() => {
    if (!sidebarOpen) return;
    const orig = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSidebarOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = orig;
      window.removeEventListener('keydown', onKey);
    };
  }, [sidebarOpen]);

  const go = (p: PublicPage) => { onNavigate(p); setSidebarOpen(false); };

  const currentLabel = navLinks.find((l) => l.id === currentPage)?.label ?? '';

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
          <button className="ml-auto lg:hidden text-gray-400" onClick={() => setSidebarOpen(false)} aria-label="ปิดเมนู">
            <X size={18} />
          </button>
        </div>

        {/* Navigation — scrolls inside sidebar only */}
        <nav className="flex-1 min-h-0 px-3 py-4 space-y-1 overflow-y-auto overscroll-contain scrollbar-thin">
          {navLinks.map((link) => (
            <button
              key={link.id}
              onClick={() => go(link.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group ${
                currentPage === link.id
                  ? 'bg-amber-500/10 text-amber-300 border border-amber-500/60 shadow-[0_0_16px_-6px_rgba(245,158,11,0.5)]'
                  : 'text-gray-400 hover:text-white hover:bg-navy-700 border border-transparent'
              }`}
            >
              <span className={currentPage === link.id ? 'text-amber-300' : 'text-gray-500 group-hover:text-gray-300'}>
                {link.icon}
              </span>
              <span className="flex-1 text-left">{link.label}</span>
              {currentPage === link.id && <ChevronRight size={14} className="text-amber-300" />}
            </button>
          ))}
        </nav>

        {/* Footer — Login button + system info */}
        <div className="px-3 py-4 border-t border-blue-900/40 flex-shrink-0 space-y-3">
          <button
            onClick={() => onNavigate('login')}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-navy-900 font-semibold py-2.5 rounded-lg text-sm transition-colors btn-ripple"
          >
            <LogIn size={16} />
            เข้าสู่ระบบ
          </button>
          <div className="flex flex-col items-center justify-center gap-1">
            <div className="flex items-center gap-1.5">
              <img src={LOGO_URL} alt="DOT" className="h-4 w-auto" />
              <span className="text-amber-500/80 text-[10px] font-semibold tracking-wide">Bit Cities DOT</span>
            </div>
            <div className="text-[10px] text-amber-400/90 flex items-center justify-center gap-1">
              <Newspaper size={11} className="text-amber-400" />
              <span>พาร์ทเนอร์กับ สำนักข่าว Bit news</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="bg-navy-800/80 backdrop-blur border-b border-blue-900/40 px-4 lg:px-6 py-3 flex items-center gap-4 sticky top-0 z-30 flex-shrink-0">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-gray-400 hover:text-white" aria-label="เปิดเมนู">
            <Menu size={22} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold text-white truncate">{currentLabel}</h1>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => onNavigate('login')}
              className="lg:hidden flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-navy-900 font-semibold px-3 py-1.5 rounded-lg text-xs transition-colors btn-ripple"
            >
              <LogIn size={14} />
              เข้าสู่ระบบ
            </button>
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
