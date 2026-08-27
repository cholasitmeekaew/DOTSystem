import { useEffect, useState, ReactNode } from 'react';
import {
  Truck, LogIn, FileText, ChevronRight,
  Pin, AlertCircle, MessageSquare, Clock, User, Car,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Announcement, Officer, RANK_LABELS, DEPARTMENT_LABELS } from '../../lib/types';

import type { PublicPage } from '../../components/PublicLayout';

interface Props {
  onNavigate: (page: PublicPage) => void;
}

export function HomePage({ onNavigate }: Props) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [onDutyOfficers, setOnDutyOfficers] = useState<Officer[]>([]);
  const [dutyTimes, setDutyTimes] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchAnnouncements(), fetchOnDutyOfficers()]).finally(() => setLoading(false));
  }, []);

  async function fetchAnnouncements() {
    const { data } = await supabase
      .from('announcements')
      .select('*')
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(5);
    setAnnouncements(data ?? []);
  }

  async function fetchOnDutyOfficers() {
    const { data } = await supabase
      .from('officers')
      .select('*')
      .eq('is_on_duty', true)
      .eq('status', 'active')
      .order('name');
    const officers = data ?? [];
    setOnDutyOfficers(officers);

    const times: Record<string, string | null> = {};
    for (const o of officers) {
      const { data: log } = await supabase
        .from('duty_logs')
        .select('clock_in')
        .eq('officer_id', o.id)
        .is('clock_out', null)
        .is('deleted_at', null)
        .order('clock_in', { ascending: false })
        .limit(1)
        .maybeSingle();
      times[o.id] = log?.clock_in ?? null;
    }
    setDutyTimes(times);
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const formatClockIn = (iso: string | null) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div>
      {/* Hero */}
      <section className="relative bg-gradient-to-b from-navy-700 to-navy-900 overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute inset-0" style={{
            backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 60px, rgba(245,158,11,0.3) 60px, rgba(245,158,11,0.3) 61px), repeating-linear-gradient(90deg, transparent, transparent 60px, rgba(245,158,11,0.3) 60px, rgba(245,158,11,0.3) 61px)',
          }} />
        </div>
        {/* Gradient shift overlay */}
        <div className="absolute inset-0 opacity-20 gradient-shift" style={{
          background: 'linear-gradient(135deg, rgba(245,158,11,0.15) 0%, rgba(59,130,246,0.1) 50%, rgba(16,185,129,0.15) 100%)',
        }} />
        <div className="relative max-w-7xl mx-auto px-6 py-20 text-center">
          <div className="flex justify-center mb-6 anim-fadeInUp">
            <div className="w-24 h-24 bg-amber-500/10 border-2 border-amber-500/30 rounded-2xl flex items-center justify-center anim-float">
              <Truck size={46} className="text-amber-400" />
            </div>
          </div>
          <div className="anim-fadeInUp anim-delay-1 inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-full px-4 py-1 mb-4">
            <div className="w-1.5 h-1.5 bg-amber-400 rounded-full anim-pulse" />
            <span className="text-amber-400 text-xs font-semibold tracking-wider">BIT CITIES DEPARTMENT OF TRANSPORTATION</span>
          </div>
          <h1 className="anim-fadeInUp anim-delay-2 text-5xl md:text-6xl font-black text-white mb-4 tracking-tight">DOT</h1>
          <p className="anim-fadeInUp anim-delay-3 text-gray-400 text-lg mb-8 max-w-xl mx-auto">
            ระบบบริหารจัดการและให้บริการกรมขนส่ง Bit Cities
          </p>

          {/* Quick Action Buttons — 3 items ชิดกันตรงกลาง */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2 max-w-3xl mx-auto">
            <div className="anim-fadeInUp anim-delay-4 w-full sm:w-auto">
              <QuickBtn icon={<LogIn size={22} />} label="เข้าสู่ระบบเจ้าหน้าที่" sublabel="สำหรับเจ้าหน้าที่ DOT" color="amber" onClick={() => onNavigate('login')} />
            </div>
            <div className="anim-fadeInUp anim-delay-5 w-full sm:w-auto">
              <QuickBtn icon={<User size={22} />} label="ระบบประชาชน" sublabel="ค้นหาข้อมูล / ตรวจสอบรถ" color="blue" onClick={() => onNavigate('citizen')} />
            </div>
            <div className="anim-fadeInUp anim-delay-6 w-full sm:w-auto">
              <QuickBtn icon={<MessageSquare size={22} />} label="ร้องเรียน" sublabel="แจ้งเจ้าหน้าที่ / ทุจริต" color="red" onClick={() => onNavigate('complaint')} />
            </div>
          </div>
        </div>
      </section>

      {/* On-Duty Officer ID Cards Grid */}
      <section className="max-w-7xl mx-auto px-6 py-14">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-1 h-7 bg-emerald-500 rounded-full" />
          <h2 className="text-2xl font-bold text-white">เจ้าหน้าที่ปฏิบัติหน้าที่</h2>
          <span className="ml-1 text-sm text-emerald-400 font-medium">({onDutyOfficers.length} คน)</span>
        </div>
        <p className="text-gray-400 text-sm mb-8">บัตรประจำตัวดิจิทัลเจ้าหน้าที่ที่กำลังปฏิบัติหน้าที่อยู่ในขณะนี้</p>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="card p-4 animate-pulse">
                <div className="w-16 h-16 rounded-full bg-navy-600 mx-auto mb-3" />
                <div className="h-3 bg-navy-600 rounded w-3/4 mx-auto mb-2" />
                <div className="h-2 bg-navy-600 rounded w-1/2 mx-auto" />
              </div>
            ))}
          </div>
        ) : onDutyOfficers.length === 0 ? (
          <div className="card p-10 text-center">
            <User size={36} className="text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">ขณะนี้ยังไม่มีเจ้าหน้าที่ปฏิบัติหน้าที่</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {onDutyOfficers.map((o, i) => (
              <div
                key={o.id}
                className="anim-fadeInUp"
                style={{ animationDelay: `${i * 0.05}s` }}
              >
                <PublicIdCard
                  officer={o}
                  clockInTime={dutyTimes[o.id] ?? null}
                  formatClockIn={formatClockIn}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Announcements — full text, no line-clamp */}
      <section className="max-w-7xl mx-auto px-6 pb-14">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-1 h-7 bg-amber-500 rounded-full" />
          <h2 className="text-2xl font-bold text-white">ข่าวสารและประกาศ</h2>
        </div>

        {loading ? (
          <div className="grid gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="card p-5 animate-pulse">
                <div className="h-3 bg-navy-600 rounded w-1/4 mb-3" />
                <div className="h-5 bg-navy-600 rounded w-3/4 mb-2" />
                <div className="h-3 bg-navy-600 rounded w-full" />
              </div>
            ))}
          </div>
        ) : announcements.length === 0 ? (
          <div className="card p-10 text-center">
            <AlertCircle size={36} className="text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">ยังไม่มีประกาศ</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {announcements.map((ann) => (
              <div key={ann.id} className={`card-hover cursor-pointer group ${ann.is_pinned ? 'border-amber-500/30' : ''}`}>
                {ann.image_url && (
                  <div className="w-full bg-navy-900 rounded-t-xl overflow-hidden">
                    <img
                      src={ann.image_url}
                      alt={ann.title}
                      className="w-full h-auto object-contain group-hover:opacity-90 transition-opacity"
                    />
                  </div>
                )}
                <div className="p-5">
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      ann.is_pinned ? 'bg-amber-500/20' : 'bg-blue-900/50'
                    }`}>
                      {ann.is_pinned ? <Pin size={18} className="text-amber-400" /> : <FileText size={18} className="text-blue-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {ann.is_pinned && (
                          <span className="text-[10px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded">
                            ปักหมุด
                          </span>
                        )}
                        <span className="text-xs text-gray-500">{formatDate(ann.created_at)}</span>
                      </div>
                      <h3 className="text-white font-semibold mb-1 group-hover:text-amber-400 transition-colors">{ann.title}</h3>
                      <p className="text-gray-400 text-sm whitespace-pre-wrap break-words">{ann.content}</p>
                      <div className="mt-2 text-xs text-gray-500">โดย {ann.created_by_name}</div>
                    </div>
                    <ChevronRight size={16} className="text-gray-600 group-hover:text-amber-400 group-hover:translate-x-1 transition-all mt-1 flex-shrink-0" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Services Grid */}
      <section className="bg-navy-800/30 border-t border-blue-900/30 py-14">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-1 h-7 bg-amber-500 rounded-full" />
            <h2 className="text-2xl font-bold text-white">แผนก / ฝ่าย</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {[
              { label: 'โยธาซ่อมบำรุง', icon: '🔧', desc: 'ซ่อมแซมโครงสร้างพื้นฐาน' },
              { label: 'กู้ภัยรถยก', icon: '🚛', desc: 'บริการยกรถและกู้ภัย' },
              { label: 'การไฟฟ้า', icon: '⚡', desc: 'ดูแลระบบไฟฟ้าสาธารณะ' },
              { label: 'จัดการจราจร', icon: '🚦', desc: 'ควบคุมการจราจร' },
              { label: 'ช่วยเหลือฉุกเฉิน', icon: '🚨', desc: 'ฉุกเฉินบนท้องถนน' },
            ].map((dept) => (
              <div key={dept.label} className="card p-4 text-center hover:border-blue-700/50 transition-all">
                <div className="text-3xl mb-2">{dept.icon}</div>
                <div className="text-white font-semibold text-sm mb-1">{dept.label}</div>
                <div className="text-gray-500 text-xs">{dept.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function PublicIdCard({ officer, clockInTime, formatClockIn }: {
  officer: Officer;
  clockInTime: string | null;
  formatClockIn: (iso: string | null) => string;
}) {
  return (
    <div className="card p-4 text-center hover:border-emerald-500/30 transition-all group">
      {/* Photo — object-cover for square crop, no distortion */}
      <div className="relative mx-auto mb-3">
        <div className="w-20 h-20 rounded-2xl overflow-hidden border-2 border-amber-500/30 bg-navy-700 flex items-center justify-center group-hover:border-amber-500/60 transition-colors">
          {officer.photo_url ? (
            <img src={officer.photo_url} alt={officer.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-amber-500/50 text-2xl font-bold">{officer.name.charAt(0).toUpperCase()}</span>
          )}
        </div>
        <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full border-2 border-navy-800 flex items-center justify-center">
          <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
        </div>
      </div>

      <h3 className="text-white text-sm font-bold truncate mb-1">{officer.name}</h3>
      <div className="text-amber-400 text-xs font-medium mb-1">{RANK_LABELS[officer.rank] ?? officer.rank}</div>
      <div className="text-blue-400 text-xs mb-2">{DEPARTMENT_LABELS[officer.department] ?? officer.department}</div>

      <div className="flex items-center justify-center gap-1 pt-2 border-t border-blue-900/30">
        <Clock size={11} className="text-emerald-400" />
        <span className="text-emerald-400 text-xs font-medium">เข้าเวร {formatClockIn(clockInTime)}</span>
      </div>
    </div>
  );
}

function QuickBtn({ icon, label, sublabel, color, onClick }: { icon: ReactNode; label: string; sublabel?: string; color: string; onClick: () => void }) {
  const colors: Record<string, { bg: string; text: string; subtext: string; shadow: string; ring: string }> = {
    amber: {
      bg: 'bg-amber-500 hover:bg-amber-400',
      text: 'text-navy-900',
      subtext: 'text-navy-900/70',
      shadow: 'shadow-lg shadow-amber-500/20 hover:shadow-amber-500/40',
      ring: 'hover:ring-2 hover:ring-amber-300/50',
    },
    blue: {
      bg: 'bg-blue-600 hover:bg-blue-500',
      text: 'text-white',
      subtext: 'text-blue-100',
      shadow: 'shadow-lg shadow-blue-600/20 hover:shadow-blue-500/40',
      ring: 'hover:ring-2 hover:ring-blue-300/50',
    },
    red: {
      bg: 'bg-red-600 hover:bg-red-500',
      text: 'text-white',
      subtext: 'text-red-100',
      shadow: 'shadow-lg shadow-red-600/20 hover:shadow-red-500/40',
      ring: 'hover:ring-2 hover:ring-red-300/50',
    },
  };
  const c = colors[color] ?? colors.blue;
  return (
    <button
      onClick={onClick}
      className={`group flex items-center gap-3 px-5 py-4 rounded-xl font-semibold text-sm transition-all duration-200 btn-ripple hover-lift ${c.bg} ${c.text} ${c.shadow} ${c.ring}`}
    >
      <div className="w-10 h-10 rounded-lg bg-white/15 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <div className="text-left min-w-0">
        <div className="font-bold text-sm leading-tight">{label}</div>
        {sublabel && <div className={`text-[11px] font-normal ${c.subtext} leading-tight mt-0.5`}>{sublabel}</div>}
      </div>
    </button>
  );
}
