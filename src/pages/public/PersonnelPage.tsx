import { useEffect, useMemo, useState } from 'react';
import { Users, Search, Shield, Briefcase, Car, Wrench, Zap, TrafficCone, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Officer, OfficerRank, Department, DEPARTMENT_LABELS, RANK_LABELS } from '../../lib/types';
import { FadeIn, Stagger, StaggerItem, Skeleton } from '../../components/animations';

type Filter = 'all' | Department;

const RANK_ORDER: Record<string, number> = {
  commissioner: 1,
  inspector: 2,
  officer: 3,
};

const RANK_COLORS: Record<string, { text: string; bg: string; border: string; glow: string }> = {
  commissioner: {
    text: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/40',
    glow: 'shadow-amber-500/20',
  },
  inspector: {
    text: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/40',
    glow: 'shadow-blue-500/20',
  },
  officer: {
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/40',
    glow: 'shadow-emerald-500/20',
  },
};

const DEPARTMENT_ICONS: Record<Department, React.ReactNode> = {
  civil_maintenance: <Wrench size={14} />,
  vehicle_rescue: <Car size={14} />,
  electrical: <Zap size={14} />,
  traffic_management: <TrafficCone size={14} />,
  emergency_assistance: <AlertCircle size={14} />,
};

const DEPARTMENT_FILTERS: { id: Filter; label: string; icon: React.ReactNode }[] = [
  { id: 'all', label: 'ทั้งหมด', icon: <Users size={14} /> },
  { id: 'civil_maintenance', label: 'โยธา', icon: <Wrench size={14} /> },
  { id: 'vehicle_rescue', label: 'กู้ภัย', icon: <Car size={14} /> },
  { id: 'electrical', label: 'ไฟฟ้า', icon: <Zap size={14} /> },
  { id: 'traffic_management', label: 'จราจร', icon: <TrafficCone size={14} /> },
  { id: 'emergency_assistance', label: 'ฉุกเฉิน', icon: <AlertCircle size={14} /> },
];

export function PersonnelPage() {
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    supabase
      .from('officers')
      .select('*')
      .eq('status', 'active')
      .order('name')
      .then(({ data }: { data: Record<string, unknown>[] | null }) => {
        setOfficers((data as unknown as Officer[]) ?? []);
        setLoading(false);
      });
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return officers
      .filter((o) => filter === 'all' || o.department === filter)
      .filter((o) => {
        if (!q) return true;
        return (
          o.name.toLowerCase().includes(q) ||
          (RANK_LABELS[o.rank] ?? o.rank).toLowerCase().includes(q) ||
          (DEPARTMENT_LABELS[o.department] ?? o.department).toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (RANK_ORDER[a.rank] ?? 99) - (RANK_ORDER[b.rank] ?? 99) || a.name.localeCompare(b.name, 'th'));
  }, [officers, search, filter]);

  const countByDept = useMemo(() => {
    const map: Record<string, number> = {};
    for (const o of officers) {
      map[o.department] = (map[o.department] ?? 0) + 1;
    }
    return map;
  }, [officers]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      {/* Header */}
      <FadeIn className="text-center mb-8">
        <div className="inline-flex w-16 h-16 bg-amber-500/10 border-2 border-amber-500/30 rounded-2xl items-center justify-center mb-4 anim-float">
          <Users size={30} className="text-amber-400" />
        </div>
        <h1 className="text-3xl md:text-4xl font-black text-white mb-2 tracking-tight">
          ทำเนียบบุคลากร
        </h1>
        <p className="text-gray-400 text-sm max-w-2xl mx-auto">
          รายชื่อเจ้าหน้าที่กรมขนส่ง Bit Cities — Department of Transportation
        </p>
        {!loading && (
          <div className="inline-flex items-center gap-3 mt-4 text-xs text-gray-500">
            <span>ทั้งหมด <span className="text-amber-400 font-bold">{officers.length}</span> คน</span>
            <span className="text-blue-900">•</span>
            <span className="text-emerald-400">กำลังปฏิบัติหน้าที่ {officers.filter((o) => o.is_on_duty).length} คน</span>
          </div>
        )}
      </FadeIn>

      {/* Search + Filter */}
      <FadeIn delay={0.05} className="mb-6 space-y-3">
        <div className="card p-4 flex items-center gap-3 hover-lift">
          <Search size={18} className="text-gray-500 flex-shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อ, ตำแหน่ง, แผนก..."
            className="flex-1 bg-transparent border-none outline-none text-white placeholder-gray-500 text-sm"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-xs text-gray-500 hover:text-white"
            >
              ล้าง
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {DEPARTMENT_FILTERS.map((d) => {
            const active = filter === d.id;
            const count = d.id === 'all' ? officers.length : (countByDept[d.id] ?? 0);
            return (
              <button
                key={d.id}
                onClick={() => setFilter(d.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all btn-ripple ${
                  active
                    ? 'bg-amber-500 text-navy-900 shadow-md shadow-amber-500/30'
                    : 'bg-navy-800 text-gray-400 hover:text-white border border-blue-900/40 hover:border-amber-500/40'
                }`}
              >
                {d.icon}
                {d.label}
                <span className={`text-[10px] font-bold px-1.5 rounded-full ${active ? 'bg-navy-900/20' : 'bg-navy-700'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </FadeIn>

      {/* Content */}
      {loading ? (
        <FadeIn>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="card p-4 space-y-3">
                <Skeleton variant="circle" width={64} height={64} className="mx-auto" />
                <Skeleton variant="text" className="mx-auto" width="70%" />
                <Skeleton variant="text" className="mx-auto" width="50%" height={10} />
              </div>
            ))}
          </div>
        </FadeIn>
      ) : filtered.length === 0 ? (
        <FadeIn>
          <div className="card p-12 text-center">
            <div className="inline-flex w-14 h-14 bg-navy-700 border border-blue-900/40 rounded-2xl items-center justify-center mx-auto mb-3">
              <Search size={26} className="text-gray-500" />
            </div>
            <p className="text-white font-semibold mb-1">
              {search || filter !== 'all' ? 'ไม่พบบุคลากรที่ค้นหา' : 'ยังไม่มีข้อมูลบุคลากร'}
            </p>
            <p className="text-gray-400 text-sm">
              {search || filter !== 'all' ? 'ลองเปลี่ยนคำค้นหรือเลือกแผนกอื่น' : 'หัวหน้ากรมสามารถเพิ่มเจ้าหน้าที่ได้ที่เมนู "จัดการเจ้าหน้าที่"'}
            </p>
          </div>
        </FadeIn>
      ) : (
        <Stagger className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filtered.map((o) => (
            <StaggerItem key={o.id}>
              <PersonnelCard officer={o} />
            </StaggerItem>
          ))}
        </Stagger>
      )}

      {!loading && officers.length > 0 && (
        <FadeIn delay={0.2} className="mt-10 text-center text-xs text-gray-500">
          <p>ข้อมูลอัปเดตจากระบบ — กรมขนส่ง Bit Cities</p>
        </FadeIn>
      )}
    </div>
  );
}

function PersonnelCard({ officer }: { officer: Officer }) {
  const color = RANK_COLORS[officer.rank] ?? RANK_COLORS.officer;
  const isCommissioner = officer.rank === 'commissioner';
  const isInspector = officer.rank === 'inspector';
  const RankIcon = isCommissioner ? Shield : isInspector ? Briefcase : Users;

  return (
    <div
      className={`card p-4 text-center relative overflow-hidden hover-lift transition-all ${
        isCommissioner ? `border-amber-500/40 shadow-lg ${color.glow}` : 'hover:border-amber-500/30'
      }`}
    >
      {isCommissioner && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-amber-500 to-transparent" />
      )}

      <div className="relative mx-auto mb-3">
        <div
          className={`w-20 h-20 rounded-2xl overflow-hidden border-2 ${
            isCommissioner ? 'border-amber-500/60' : 'border-blue-900/40'
          } bg-navy-700 flex items-center justify-center group-hover:scale-105 transition-transform`}
        >
          {officer.photo_url ? (
            <img src={officer.photo_url} alt={officer.name} className="w-full h-full object-cover" />
          ) : (
            <span className={`text-2xl font-bold ${color.text}`}>
              {officer.name.charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        {officer.is_on_duty && (
          <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full border-2 border-navy-800 flex items-center justify-center">
            <div className="w-1.5 h-1.5 bg-white rounded-full anim-pulse" />
          </div>
        )}
      </div>

      <h3 className="text-white text-sm font-bold truncate mb-0.5">{officer.name}</h3>

      <div className={`inline-flex items-center gap-1 ${color.bg} ${color.text} border ${color.border} px-2 py-0.5 rounded-full text-[10px] font-semibold mb-1.5`}>
        <RankIcon size={10} />
        {RANK_LABELS[officer.rank] ?? officer.rank}
      </div>

      <div className="flex items-center justify-center gap-1 text-gray-400 text-[11px]">
        {DEPARTMENT_ICONS[officer.department]}
        <span className="truncate">{DEPARTMENT_LABELS[officer.department] ?? officer.department}</span>
      </div>

      <div className="mt-2.5 pt-2 border-t border-blue-900/30 flex items-center justify-center gap-1 text-[10px]">
        {officer.is_on_duty ? (
          <>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 anim-pulse" />
            <span className="text-emerald-400 font-medium">กำลังปฏิบัติหน้าที่</span>
          </>
        ) : (
          <>
            <div className="w-1.5 h-1.5 rounded-full bg-gray-500" />
            <span className="text-gray-500 font-medium">ไม่ได้ปฏิบัติหน้าที่</span>
          </>
        )}
      </div>
    </div>
  );
}
