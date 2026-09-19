import { ReactNode, useEffect, useState } from 'react';
import { Truck, Users, LogIn, Tag, MessageSquare, Siren, Menu, X, IdCard, BarChart3, ChevronRight, Trophy, ScrollText } from 'lucide-react';

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
  { id: 'terms', label: 'ข้อกำหนดการใช้งาน', icon: <ScrollText size={18} /> },
];

export function PublicLayout({ children, currentPage, onNavigate }: Props) {
  const [sheetOpen, setSheetOpen] = useState(false);

  // ล็อก scroll ของ body เมื่อ sheet เปิด + ปิดด้วย ESC
  useEffect(() => {
    if (sheetOpen) {
      const orig = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheetOpen(false); };
      window.addEventListener('keydown', onKey);
      return () => {
        document.body.style.overflow = orig;
        window.removeEventListener('keydown', onKey);
      };
    }
  }, [sheetOpen]);

  const go = (p: PublicPage) => { onNavigate(p); setSheetOpen(false); };

  return (
    <div className="min-h-[100dvh] bg-navy-900 flex flex-col">
      {/* Top Nav */}
      <header className="sticky top-0 z-40 bg-navy-800/95 backdrop-blur border-b border-blue-900/50 flex-shrink-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-4">
            {/* Logo */}
            <button onClick={() => go('home')} className="flex items-center gap-3 group flex-shrink-0">
              <img
                src={LOGO_URL}
                alt="Bit Cities DOT"
                className="h-10 w-auto rounded-lg shadow-lg group-hover:opacity-90 transition-opacity"
              />
              <div className="text-left hidden sm:block">
                <div className="text-xs text-amber-500 font-medium leading-none">BIT CITIES</div>
                <div className="text-base font-bold text-white leading-tight">DOT</div>
              </div>
            </button>

            {/* Center: Nav Links + Login ติดกัน (desktop only) */}
            <div className="hidden lg:flex items-center gap-1 flex-1 justify-center">
              {navLinks.map((link) => (
                <NavLink key={link.id} active={currentPage === link.id} onClick={() => onNavigate(link.id)} icon={link.icon}>
                  {link.label}
                </NavLink>
              ))}
              <div className="w-px h-6 bg-blue-900/60 mx-2" />
              <button
                onClick={() => onNavigate('login')}
                className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-navy-900 font-semibold px-3.5 py-2 rounded-lg text-sm transition-all flex-shrink-0 btn-ripple"
              >
                <LogIn size={14} />
                <span>เข้าสู่ระบบ</span>
              </button>
            </div>

            {/* Mobile: hamburger */}
            <div className="flex items-center gap-2 lg:hidden ml-auto">
              <button
                onClick={() => setSheetOpen(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-navy-700 hover:bg-navy-600 text-white text-sm font-medium transition-colors border border-blue-900/40"
                aria-label="เปิดเมนู"
              >
                <Menu size={18} />
                <span>เมนู</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 pb-8">
        <div className="w-full max-w-7xl mx-auto">
          {children}
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-navy-800/50 border-t border-blue-900/30 py-6 flex-shrink-0">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <img
              src={LOGO_URL}
              alt="Bit Cities DOT"
              className="h-6 w-auto"
            />
            <span className="text-amber-500 font-bold text-sm">Bit Cities Department of Transportation</span>
          </div>
          <p className="text-gray-500 text-xs">ระบบบริหารจัดการกรมขนส่ง — สงวนสิทธิ์สำหรับเจ้าหน้าที่ DOT เท่านั้น</p>
        </div>
      </footer>

      {/* Mobile Bottom Sheet — render always, animate via CSS transition */}
      <div
        className={`lg:hidden fixed inset-0 z-50 transition-opacity duration-300 ${
          sheetOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden={!sheetOpen}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          onClick={() => setSheetOpen(false)}
        />
        {/* Sheet */}
        <div
          className={`absolute inset-x-0 bottom-0 max-h-[85dvh] bg-navy-800 border-t border-blue-900/40 rounded-t-2xl shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
            sheetOpen ? 'translate-y-0' : 'translate-y-full'
          }`}
        >
          {/* Handle bar */}
          <div className="flex justify-center pt-3 pb-1 cursor-grab" onClick={() => setSheetOpen(false)}>
            <div className="w-10 h-1.5 rounded-full bg-gray-500/50" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-2 pb-3 border-b border-blue-900/40 flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <img src={LOGO_URL} alt="DOT" className="h-8 w-auto rounded-md" />
              <div>
                <div className="text-[10px] text-amber-500 font-semibold tracking-widest leading-none">DEPARTMENT OF</div>
                <div className="text-sm font-bold text-white leading-tight">TRANSPORTATION</div>
              </div>
            </div>
            <button
              onClick={() => setSheetOpen(false)}
              className="w-9 h-9 rounded-full bg-navy-700 hover:bg-navy-600 text-gray-400 hover:text-white flex items-center justify-center transition-colors"
              aria-label="ปิดเมนู"
            >
              <X size={18} />
            </button>
          </div>

          {/* Nav links (scrollable) */}
          <nav className="flex-1 overflow-y-auto px-3 py-3 scrollbar-thin">
            <ul className="space-y-1">
              {navLinks.map((link) => {
                const active = currentPage === link.id;
                return (
                  <li key={link.id}>
                    <button
                      onClick={() => go(link.id)}
                      className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-medium transition-colors ${
                        active
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                          : 'text-gray-300 hover:text-white hover:bg-navy-700 border border-transparent'
                      }`}
                    >
                      <span className={`flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0 ${
                        active ? 'bg-amber-500/20 text-amber-400' : 'bg-navy-700 text-gray-400'
                      }`}>
                        {link.icon}
                      </span>
                      <span className="flex-1 text-left">{link.label}</span>
                      {active && <span className="text-[10px] text-amber-400 font-semibold tracking-wider">กำลังดู</span>}
                      {!active && <ChevronRight size={16} className="text-gray-600" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Footer with login button */}
          <div className="px-4 py-4 border-t border-blue-900/40 bg-navy-900/40 flex-shrink-0">
            <button
              onClick={() => go('login')}
              className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-navy-900 font-bold py-3 rounded-xl text-sm transition-colors btn-ripple"
            >
              <LogIn size={18} />
              เข้าสู่ระบบเจ้าหน้าที่
            </button>
            <p className="text-center text-gray-500 text-xs mt-2.5">สงวนสิทธิ์สำหรับเจ้าหน้าที่ DOT</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function NavLink({ children, active, onClick, icon }: { children: ReactNode; active: boolean; onClick: () => void; icon?: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
        active ? 'bg-blue-900/60 text-amber-400' : 'text-gray-300 hover:text-white hover:bg-navy-700'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
