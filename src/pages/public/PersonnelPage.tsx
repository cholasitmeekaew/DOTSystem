import { useEffect, useMemo, useState } from 'react';
import {
  Users, Search, Shield, Briefcase, Wrench, Zap, TrafficCone, AlertCircle, X,
  Clock, DollarSign, Calendar, LayoutList, LayoutGrid, ArrowUpDown, Layers, Users2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  Officer, OfficerRankRecord, OfficerGenerationRecord, Department,
  DEPARTMENT_LABELS, RANK_LABELS, DEPARTMENTS, DutyLog, ServiceRecord,
} from '../../lib/types';
import {
  buildPersonnelIndex, sortOfficers, groupOfficers, matchesOfficerSearch,
  filterByDepartment, filterByGeneration, countBy,
  PERSONNEL_SORT_OPTIONS, PERSONNEL_GROUP_OPTIONS,
  type PersonnelSortMode, type PersonnelGroupMode,
} from '../../lib/personnelOrder';
import { FadeIn, Stagger, StaggerItem, Skeleton } from '../../components/animations';
import { Modal } from '../../components/Modal';

/* ---------- สีประจำตำแหน่ง ---------- */
const RANK_COLORS: Record<string, { text: string; bg: string; border: string; glow: string }> = {
  commissioner: { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/40', glow: 'shadow-amber-500/20' },
  inspector: { text: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/40', glow: 'shadow-blue-500/20' },
  officer: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/40', glow: 'shadow-emerald-500/20' },
};

const DEPARTMENT_ICONS: Record<Department, React.ReactNode> = {
  civil_maintenance: <Wrench size={14} />,
  vehicle_rescue: <Wrench size={14} />,
  electrical: <Zap size={14} />,
  traffic_management: <TrafficCone size={14} />,
  emergency_assistance: <AlertCircle size={14} />,
};

/** สีประจำแผนก (ใช้ในหัวตารางรายการ) */
const DEPARTMENT_ACCENT: Record<string, string> = {
  civil_maintenance: 'text-amber-300',
  vehicle_rescue: 'text-sky-300',
  electrical: 'text-yellow-300',
  traffic_management: 'text-violet-300',
  emergency_assistance: 'text-rose-300',
};

/* ---------- หน้าหลัก ---------- */
export function PersonnelPage() {
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [ranks, setRanks] = useState<OfficerRankRecord[]>([]);
  const [generations, setGenerations] = useState<OfficerGenerationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<PersonnelSortMode>('manual');
  const [groupMode, setGroupMode] = useState<PersonnelGroupMode>('rank');
  const [deptFilter, setDeptFilter] = useState('');
  const [genFilter, setGenFilter] = useState('');
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [selectedOfficer, setSelectedOfficer] = useState<Officer | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [officerRes, rankRes, genRes] = await Promise.all([
        supabase.from('officers').select('*').eq('status', 'active'),
        supabase.from('officer_ranks').select('*').order('sort_order'),
        supabase.from('officer_generations').select('*').order('sort_order'),
      ]);
      if (cancelled) return;
      setOfficers(((officerRes.data ?? []) as unknown as Officer[]) ?? []);
      setRanks(((rankRes.data ?? []) as unknown as OfficerRankRecord[]) ?? []);
      setGenerations(((genRes.data ?? []) as unknown as OfficerGenerationRecord[]) ?? []);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const index = useMemo(() => buildPersonnelIndex(ranks, generations), [ranks, generations]);

  const filtered = useMemo(() => {
    return sortOfficers(
      filterByGeneration(
        filterByDepartment(officers, deptFilter),
        genFilter,
      ),
      sortMode,
      index,
    ).filter((o) => matchesOfficerSearch(o, search, index));
  }, [officers, deptFilter, genFilter, sortMode, search, index]);

  const groups = useMemo(
    () => groupOfficers(filtered, groupMode, sortMode, index),
    [filtered, groupMode, sortMode, index],
  );

  const deptCounts = useMemo(() => countBy(officers, (o) => o.department), [officers]);
  const genCounts = useMemo(
    () => countBy(officers, (o) => (o.generation ?? '').trim()),
    [officers],
  );
  const genLabelOf = (key: string) => index.genLabel(key || null);

  const onDutyCount = officers.filter((o) => o.is_on_duty).length;
  const traineeCount = officers.filter((o) => index.isTrainee(o.generation)).length;

  const resetFilters = () => {
    setSearch('');
    setDeptFilter('');
    setGenFilter('');
  };
  const hasFilter = !!search || !!deptFilter || !!genFilter;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
      {/* ---------- Header ---------- */}
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
          <div className="inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1 mt-4 text-xs text-gray-500">
            <span>ทั้งหมด <span className="text-amber-400 font-bold">{officers.length}</span> คน</span>
            <span className="text-blue-900">•</span>
            <span className="text-emerald-400">กำลังปฏิบัติหน้าที่ {onDutyCount} คน</span>
            {traineeCount > 0 && (
              <>
                <span className="text-blue-900">•</span>
                <span className="text-sky-300">ทดลองงาน {traineeCount} คน</span>
              </>
            )}
          </div>
        )}
      </FadeIn>

      {/* ---------- Toolbar ---------- */}
      <FadeIn delay={0.05} className="mb-6">
        <div className="card p-4 space-y-3">
          <span className="ph-corner ph-corner-tl" aria-hidden />
          <span className="ph-corner ph-corner-br" aria-hidden />

          {/* แถวที่ 1 — ค้นหา + สลับมุมมอง */}
          <div className="flex items-center gap-3">
            <Search size={18} className="text-gray-500 flex-shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาชื่อ, @username, ตำแหน่ง, แผนก, รุ่น..."
              className="flex-1 bg-transparent border-none outline-none text-white placeholder-gray-500 text-sm"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-xs text-gray-500 hover:text-white">
                ล้าง
              </button>
            )}
            <div className="gold-toggle flex-shrink-0">
              <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} title="มุมมองรายการ">
                <LayoutList size={12} className="inline mr-1" />รายการ
              </button>
              <button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} title="มุมมองการ์ด">
                <LayoutGrid size={12} className="inline mr-1" />การ์ด
              </button>
            </div>
          </div>

          {/* แถวที่ 2 — เรียง / จัดกลุ่ม / ตัวกรอง */}
          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-blue-900/40">
            <div className="flex items-center gap-1.5">
              <ArrowUpDown size={13} className="text-amber-500/80" />
              <label className="text-[11px] text-gray-400">เรียงตาม</label>
              <select
                className="select-field !w-auto !py-1 !px-2 !text-xs"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as PersonnelSortMode)}
              >
                {PERSONNEL_SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <Layers size={13} className="text-amber-500/80" />
              <label className="text-[11px] text-gray-400">จัดกลุ่ม</label>
              <select
                className="select-field !w-auto !py-1 !px-2 !text-xs"
                value={groupMode}
                onChange={(e) => setGroupMode(e.target.value as PersonnelGroupMode)}
              >
                {PERSONNEL_GROUP_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <Users2 size={13} className="text-amber-500/80" />
              <label className="text-[11px] text-gray-400">รุ่น</label>
              <select
                className="select-field !w-auto !py-1 !px-2 !text-xs"
                value={genFilter}
                onChange={(e) => setGenFilter(e.target.value)}
              >
                <option value="">ทุกรุ่น</option>
                {index.activeGenerations.map((g) => {
                  const key = (g.generation_key ?? g.label ?? '').trim();
                  if (!key) return null;
                  return (
                    <option key={g.id} value={key}>
                      {g.label} ({genCounts[key] ?? 0})
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="flex items-center gap-1.5">
              <Wrench size={13} className="text-amber-500/80" />
              <label className="text-[11px] text-gray-400">แผนก</label>
              <select
                className="select-field !w-auto !py-1 !px-2 !text-xs"
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
              >
                <option value="">ทุกแผนก</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {DEPARTMENT_LABELS[d]} ({deptCounts[d] ?? 0})
                  </option>
                ))}
              </select>
            </div>

            {hasFilter && (
              <button
                onClick={resetFilters}
                className="ml-auto text-[11px] text-gray-400 hover:text-amber-400 transition-colors"
              >
                ล้างตัวกรองทั้งหมด
              </button>
            )}
          </div>

          {/* แถวที่ 3 — ชิปตัวกรองด่วน */}
          {(index.activeGenerations.length > 0 || DEPARTMENTS.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 pt-3 border-t border-blue-900/40">
              <button
                onClick={() => setGenFilter('')}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                  genFilter === ''
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/50'
                    : 'bg-navy-800 text-gray-400 border-blue-900/60 hover:text-white hover:border-amber-500/40'
                }`}
              >
                ทุกรุ่น ({officers.length})
              </button>
              {index.activeGenerations.map((g) => {
                const key = (g.generation_key ?? g.label ?? '').trim();
                if (!key) return null;
                const active = genFilter === key;
                return (
                  <button
                    key={g.id}
                    onClick={() => setGenFilter(active ? '' : key)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all flex items-center gap-1 ${
                      active
                        ? 'bg-sky-500/15 text-sky-300 border-sky-500/50'
                        : 'bg-navy-800 text-gray-400 border-blue-900/60 hover:text-white hover:border-sky-500/40'
                    }`}
                  >
                    {g.is_trainee && <span className="w-1.5 h-1.5 rounded-full bg-sky-400 anim-pulse" />}
                    {g.label} ({genCounts[key] ?? 0})
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </FadeIn>

      {/* ---------- เนื้อหา ---------- */}
      {loading ? (
        <FadeIn>
          <div className="table-panel">
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton variant="circle" width={40} height={40} />
                  <div className="flex-1 space-y-2">
                    <Skeleton variant="text" width="35%" />
                    <Skeleton variant="text" width="20%" height={10} />
                  </div>
                  <Skeleton variant="text" width={110} />
                  <Skeleton variant="text" width={90} />
                </div>
              ))}
            </div>
          </div>
        </FadeIn>
      ) : filtered.length === 0 ? (
        <FadeIn>
          <div className="card p-12 text-center">
            <div className="inline-flex w-14 h-14 bg-navy-700 border border-blue-900/40 rounded-2xl items-center justify-center mx-auto mb-3">
              <Search size={26} className="text-gray-500" />
            </div>
            <p className="text-white font-semibold mb-1">
              {hasFilter ? 'ไม่พบบุคลากรที่ค้นหา' : 'ยังไม่มีข้อมูลบุคลากร'}
            </p>
            <p className="text-gray-400 text-sm">
              {hasFilter
                ? 'ลองเปลี่ยนคำค้นหา หรือล้างตัวกรอง'
                : 'หัวหน้ากรมสามารถเพิ่มเจ้าหน้าที่ได้ที่เมนู "จัดการเจ้าหน้าที่"'}
            </p>
            {hasFilter && (
              <button onClick={resetFilters} className="btn-secondary mt-4 inline-flex">
                ล้างตัวกรองทั้งหมด
              </button>
            )}
          </div>
        </FadeIn>
      ) : view === 'grid' ? (
        <div className="space-y-10">
          {groups.map((g) => (
            <DepartmentSection
              key={g.key}
              title={g.label}
              count={g.count}
              trainee={g.trainee}
              officers={g.officers}
              genLabelOf={genLabelOf}
              onSelect={setSelectedOfficer}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <PersonnelListGroup
              key={g.key}
              group={g}
              index={index}
              showHeader={groupMode !== 'none'}
              genLabelOf={genLabelOf}
              onSelect={setSelectedOfficer}
            />
          ))}
        </div>
      )}

      {!loading && officers.length > 0 && (
        <FadeIn delay={0.2} className="mt-10 text-center text-xs text-gray-500">
          <p>ข้อมูลอัปเดตจากระบบ — กรมขนส่ง Bit Cities</p>
        </FadeIn>
      )}

      {selectedOfficer && (
        <OfficerDetailModal
          officer={selectedOfficer}
          genLabel={genLabelOf(selectedOfficer.generation ?? '')}
          onClose={() => setSelectedOfficer(null)}
        />
      )}
    </div>
  );
}

/* =============================================================
 * หัวกลุ่ม (ใช้ตอนจัดกลุ่ม) — ธีม Dark & Gold
 * ============================================================= */
function GroupHeader({
  title,
  count,
  trainee,
  icon,
}: {
  title: string;
  count: number;
  trainee?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="section-bar" style={{ borderRadius: '0.75rem 0.75rem 0 0' }}>
      <span className="section-bar-icon">{icon ?? <Users size={14} />}</span>
      <span className="section-bar-title">{title}</span>
      <span className="text-[10px] font-mono text-gray-500">{count} คน</span>
      {trainee && (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/40">
          ทดลองงาน
        </span>
      )}
      <div className="flex-1 h-px bg-gradient-to-r from-amber-500/30 to-transparent ml-1" />
    </div>
  );
}

/* =============================================================
 * มุมมองรายการ (List View) — หลักของหน้านี้
 * ============================================================= */
function PersonnelListGroup({
  group,
  index,
  showHeader,
  genLabelOf,
  onSelect,
}: {
  group: { key: string; label: string; count: number; trainee: boolean; officers: Officer[] };
  index: ReturnType<typeof buildPersonnelIndex>;
  showHeader: boolean;
  genLabelOf: (key: string) => string;
  onSelect: (o: Officer) => void;
}) {
  const headerIcon =
    group.key === 'rank'
      ? <Shield size={14} />
      : group.key === 'department'
        ? <Wrench size={14} />
        : group.key === 'generation'
          ? <Layers size={14} />
          : undefined;

  return (
    <section>
      {showHeader && (
        <GroupHeader
          title={group.label}
          count={group.count}
          trainee={group.trainee}
          icon={headerIcon}
        />
      )}
      <div
        className="table-panel"
        style={showHeader ? { borderTopLeftRadius: 0, borderTopRightRadius: 0 } : undefined}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="table-header-gold">
              <tr>
                <th className="w-[38%]">เจ้าหน้าที่</th>
                <th>ตำแหน่ง</th>
                <th>แผนก / ฝ่าย</th>
                <th>รุ่น</th>
                <th className="!text-right">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {group.officers.map((o, i) => (
                <OfficerListRow
                  key={o.id}
                  officer={o}
                  index={index}
                  ordinal={i + 1}
                  genLabel={genLabelOf(o.generation ?? '')}
                  onSelect={onSelect}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function OfficerListRow({
  officer,
  index,
  ordinal,
  genLabel,
  onSelect,
}: {
  officer: Officer;
  index: ReturnType<typeof buildPersonnelIndex>;
  ordinal: number;
  genLabel: string;
  onSelect: (o: Officer) => void;
}) {
  const color = RANK_COLORS[officer.rank] ?? RANK_COLORS.officer;
  const isCommissioner = officer.rank === 'commissioner';
  const isTrainee = index.isTrainee(officer.generation);
  const hasGeneration = !!(officer.generation ?? '').trim();
  const deptAccent = DEPARTMENT_ACCENT[officer.department] ?? 'text-gray-300';

  return (
    <tr
      onClick={() => onSelect(officer)}
      className={`table-row cursor-pointer group ${
        isCommissioner ? 'bg-amber-500/[0.04]' : ''
      }`}
    >
      {/* เจ้าหน้าที่ */}
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-3">
          {/* ลำดับ */}
          <span className="text-[11px] font-mono text-gray-600 w-6 text-right flex-shrink-0 group-hover:text-amber-500/70 transition-colors">
            {String(ordinal).padStart(2, '0')}
          </span>

          {/* รูปโปรไฟล์เล็ก */}
          <div
            className={`relative w-10 h-10 rounded-lg overflow-hidden bg-navy-700 border flex items-center justify-center flex-shrink-0 transition-colors ${
              isCommissioner ? 'border-amber-500/40' : 'border-blue-900/60 group-hover:border-amber-500/40'
            }`}
          >
            {officer.photo_url ? (
              <img src={officer.photo_url} alt={officer.name} className="w-full h-full object-cover" loading="lazy" />
            ) : (
              <span className={`font-bold text-sm ${color.text}`}>
                {officer.name.charAt(0).toUpperCase()}
              </span>
            )}
            {/* จุดสถานะเวรบนมุมรูป */}
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-navy-900 ${
                officer.is_on_duty ? 'bg-emerald-400 anim-pulse' : 'bg-gray-600'
              }`}
              title={officer.is_on_duty ? 'กำลังปฏิบัติหน้าที่' : 'ว่าง'}
            />
          </div>

          <div className="min-w-0">
            <div className="text-white text-sm font-semibold truncate flex items-center gap-1.5">
              {isCommissioner && <Shield size={12} className="text-amber-400 flex-shrink-0" />}
              <span className="truncate">{officer.name}</span>
            </div>
            <div className="text-gray-500 text-[11px] font-mono truncate">@{officer.username}</div>
          </div>
        </div>
      </td>

      {/* ตำแหน่ง */}
      <td className="px-4 py-2.5">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${color.bg} ${color.text} ${color.border}`}
        >
          {officer.rank === 'commissioner' && <Shield size={10} />}
          {officer.rank === 'inspector' && <Briefcase size={10} />}
          {index.rankLabel(officer.rank)}
        </span>
      </td>

      {/* แผนก */}
      <td className="px-4 py-2.5">
        <div className={`flex items-center gap-1.5 text-[12px] font-medium ${deptAccent}`}>
          {DEPARTMENT_ICONS[officer.department]}
          <span className="truncate">{index.deptLabel(officer.department)}</span>
        </div>
      </td>

      {/* รุ่น */}
      <td className="px-4 py-2.5">
        {hasGeneration ? (
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
              isTrainee
                ? 'bg-sky-500/10 text-sky-300 border-sky-500/40'
                : 'bg-navy-700 text-gray-300 border-blue-900/60'
            }`}
          >
            {genLabel}
            {isTrainee && <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />}
          </span>
        ) : (
          <span className="text-[11px] text-gray-600">—</span>
        )}
      </td>

      {/* สถานะ */}
      <td className="px-4 py-2.5 text-right">
        <span
          className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${
            officer.is_on_duty ? 'text-emerald-400' : 'text-gray-500'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${officer.is_on_duty ? 'bg-emerald-400 anim-pulse' : 'bg-gray-600'}`} />
          {officer.is_on_duty ? 'ปฏิบัติหน้าที่' : 'ว่าง'}
        </span>
      </td>
    </tr>
  );
}

/* =============================================================
 * มุมมองการ์ด (Grid) — คงของเดิมไว้เป็นตัวเลือกรอง
 * ============================================================= */
function DepartmentSection({
  title,
  count,
  trainee,
  officers,
  genLabelOf,
  onSelect,
}: {
  title: string;
  count: number;
  trainee: boolean;
  officers: Officer[];
  genLabelOf: (key: string) => string;
  onSelect: (o: Officer) => void;
}) {
  const color = RANK_COLORS[officers[0]?.rank] ?? RANK_COLORS.officer;
  return (
    <section>
      <FadeIn className="flex items-center gap-3 mb-4">
        <div className={`w-10 h-10 rounded-xl ${color.bg} border ${color.border} flex items-center justify-center ${color.text}`}>
          <Users size={16} />
        </div>
        <div>
          <h2 className={`text-lg font-bold ${color.text}`}>{title}</h2>
          <p className="text-xs text-gray-500">{count} คน</p>
        </div>
        {trainee && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/40">
            ทดลองงาน
          </span>
        )}
        <div className="flex-1 h-px bg-gradient-to-r from-blue-900/50 to-transparent ml-2" />
      </FadeIn>
      <Stagger className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {officers.map((o) => (
          <StaggerItem key={o.id}>
            <PersonnelCard
              officer={o}
              genLabel={genLabelOf(o.generation ?? '')}
              onClick={() => onSelect(o)}
            />
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}

function PersonnelCard({ officer, genLabel, onClick }: { officer: Officer; genLabel: string; onClick: () => void }) {
  const color = RANK_COLORS[officer.rank] ?? RANK_COLORS.officer;
  const isCommissioner = officer.rank === 'commissioner';

  return (
    <button
      onClick={onClick}
      className={`relative w-full rounded-2xl overflow-hidden border-2 text-left group transition-all hover-lift ${
        isCommissioner ? `border-amber-500/40 shadow-lg ${color.glow}` : 'border-blue-900/40 hover:border-amber-500/30'
      }`}
      style={{ aspectRatio: '3 / 4.5' }}
    >
      <div className="absolute inset-0 bg-navy-800">
        {officer.photo_url ? (
          <img
            src={officer.photo_url}
            alt={officer.name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-navy-700 to-navy-900">
            <span className={`text-6xl font-black opacity-30 ${color.text}`}>
              {officer.name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
      </div>

      <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/40 to-transparent pointer-events-none" />

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy-900 via-navy-900/95 to-transparent pt-12 pb-3 px-3">
        <div className="flex items-center gap-1.5 mb-1">
          <div className={`w-1.5 h-1.5 rounded-full ${officer.is_on_duty ? 'bg-emerald-400 anim-pulse' : 'bg-gray-500'}`} />
          <span className={`text-[10px] font-semibold ${officer.is_on_duty ? 'text-emerald-400' : 'text-gray-500'}`}>
            {officer.is_on_duty ? 'กำลังปฏิบัติหน้าที่' : 'ว่าง'}
          </span>
        </div>
        <h3 className="text-white text-sm font-bold truncate mb-0.5 drop-shadow-lg">{officer.name}</h3>
        <div className={`inline-flex items-center gap-1 ${color.text} text-[10px] font-semibold`}>
          {RANK_LABELS[officer.rank] ?? officer.rank}
        </div>
        <p className="text-gray-300 text-[10px] truncate mt-0.5 drop-shadow">
          {DEPARTMENT_LABELS[officer.department] ?? officer.department}
        </p>
        {!!(officer.generation ?? '').trim() && (
          <p className="text-sky-300/90 text-[10px] truncate mt-0.5 drop-shadow">{genLabel}</p>
        )}
      </div>

      {isCommissioner && (
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-amber-500 to-transparent" />
      )}
    </button>
  );
}

/* =============================================================
 * Modal รายละเอียดเจ้าหน้าที่ (คงเดิม + เพิ่มข้อมูลรุ่น)
 * ============================================================= */
function OfficerDetailModal({
  officer,
  genLabel,
  onClose,
}: {
  officer: Officer;
  genLabel: string;
  onClose: () => void;
}) {
  const [dutyLogs, setDutyLogs] = useState<DutyLog[]>([]);
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [emergencyCount, setEmergencyCount] = useState(0);
  const [totalCasesCount, setTotalCasesCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const color = RANK_COLORS[officer.rank] ?? RANK_COLORS.officer;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [dutyRes, serviceRes, sroRes, allSroRes, emergencyRes] = await Promise.all([
        supabase
          .from('duty_logs')
          .select('*')
          .eq('officer_id', officer.id)
          .is('deleted_at', null)
          .order('clock_in', { ascending: false })
          .limit(5),
        supabase
          .from('service_records')
          .select('*')
          .order('created_at', { ascending: false }),
        supabase
          .from('service_record_officers')
          .select('service_record_id')
          .eq('officer_id', officer.id),
        supabase
          .from('service_record_officers')
          .select('service_record_id, officer_id'),
        supabase
          .from('emergency_reports')
          .select('id')
          .eq('responded_by', officer.id),
      ]);
      if (cancelled) return;
      setDutyLogs((dutyRes.data as unknown as DutyLog[]) ?? []);
      const allRecords = (serviceRes.data as unknown as ServiceRecord[]) ?? [];
      const mySroIds = new Set((sroRes.data ?? []).map((r: any) => r.service_record_id));

      const allSroMap = new Map<string, string[]>();
      for (const row of allSroRes.data ?? []) {
        const list = allSroMap.get(row.service_record_id) ?? [];
        list.push(row.officer_id);
        allSroMap.set(row.service_record_id, list);
      }

      // Record belongs to this officer if:
      // 1) Assigned in service_record_officers to this officer
      // 2) OR officer_id matches AND not assigned to other officers in service_record_officers
      const myServices = allRecords.filter((s) => {
        const assigned = allSroMap.get(s.id);
        if (assigned && assigned.length > 0) {
          return assigned.includes(officer.id);
        }
        return s.officer_id === officer.id;
      });

      setServices(myServices.slice(0, 5));
      const emCount = (emergencyRes.data ?? []).length;
      setEmergencyCount(emCount);
      setTotalCasesCount(myServices.length + emCount);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [officer.id]);

  const totalDutyMinutes = dutyLogs.reduce((sum, d) => sum + (d.duration_minutes ?? 0), 0);
  const totalDutyHours = (totalDutyMinutes / 60).toFixed(1);
  const totalServiceAmount = services.reduce((sum, s) => sum + (s.amount ?? 0), 0);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('th-TH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <Modal title="" onClose={onClose} size="lg">
      <div className="space-y-4">
        {/* Hero */}
        <div className="relative -mt-6 -mx-6 h-40 overflow-hidden">
          {officer.photo_url ? (
            <img src={officer.photo_url} alt={officer.name} className="w-full h-full object-cover" />
          ) : (
            <div className={`w-full h-full bg-gradient-to-br from-navy-700 to-navy-900 flex items-center justify-center`}>
              <span className={`text-8xl font-black opacity-20 ${color.text}`}>
                {officer.name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-navy-900 via-navy-900/60 to-transparent" />
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 bg-navy-900/70 hover:bg-navy-800 border border-blue-900/50 rounded-lg flex items-center justify-center text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-1">
          <div className="flex items-center gap-2 mb-1">
            <div className={`w-2 h-2 rounded-full ${officer.is_on_duty ? 'bg-emerald-400 anim-pulse' : 'bg-gray-500'}`} />
            <span className={`text-xs font-semibold ${officer.is_on_duty ? 'text-emerald-400' : 'text-gray-500'}`}>
              {officer.is_on_duty ? 'กำลังปฏิบัติหน้าที่' : 'ว่าง'}
            </span>
          </div>
          <h2 className="text-2xl font-bold text-white mb-1">{officer.name}</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center gap-1.5 ${color.bg} ${color.text} border ${color.border} px-2.5 py-1 rounded-full text-xs font-semibold`}>
              {officer.rank === 'commissioner' && <Shield size={12} />}
              {officer.rank === 'inspector' && <Briefcase size={12} />}
              {RANK_LABELS[officer.rank] ?? officer.rank}
            </span>
            {!!(officer.generation ?? '').trim() && (
              <span className="inline-flex items-center gap-1 bg-navy-700 text-gray-300 border border-blue-900/60 px-2.5 py-1 rounded-full text-xs font-semibold">
                <Layers size={12} className="text-sky-400" />
                {genLabel}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-gray-300 text-sm">
            <span className="flex items-center gap-1.5">
              {DEPARTMENT_ICONS[officer.department]}
              {DEPARTMENT_LABELS[officer.department] ?? officer.department}
            </span>
            <span className="text-gray-600 font-mono text-xs">@{officer.username}</span>
          </div>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-navy-700/50 border border-blue-900/40 rounded-lg p-3 text-center">
            <Clock size={16} className="text-amber-400 mx-auto mb-1" />
            <div className="text-lg font-bold text-white">{totalDutyHours}</div>
            <div className="text-[10px] text-gray-500">ชม. ปฏิบัติหน้าที่</div>
          </div>
          <div className="bg-navy-700/50 border border-blue-900/40 rounded-lg p-3 text-center">
            <Calendar size={16} className="text-blue-400 mx-auto mb-1" />
            <div className="text-lg font-bold text-white">{dutyLogs.length}</div>
            <div className="text-[10px] text-gray-500">เวรล่าสุด</div>
          </div>
          <div className="bg-navy-700/50 border border-blue-900/40 rounded-lg p-3 text-center">
            <Wrench size={16} className="text-purple-400 mx-auto mb-1" />
            <div className="text-lg font-bold text-white">{totalCasesCount}</div>
            <div className="text-[10px] text-gray-500">งาน/เคสที่ดูแล</div>
          </div>
          <div className="bg-navy-700/50 border border-blue-900/40 rounded-lg p-3 text-center">
            <DollarSign size={16} className="text-emerald-400 mx-auto mb-1" />
            <div className="text-lg font-bold text-white">{totalServiceAmount.toLocaleString()}</div>
            <div className="text-[10px] text-gray-500">ค่าบริการรวม (BC)</div>
          </div>
        </div>

        {/* Recent duty logs */}
        <div>
          <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5">
            <Clock size={14} className="text-amber-400" />
            เวรที่เข้าล่าสุด
          </h3>
          {loading ? (
            <div className="space-y-2">
              <Skeleton variant="text" className="w-full" height={32} />
              <Skeleton variant="text" className="w-full" height={32} />
            </div>
          ) : dutyLogs.length === 0 ? (
            <div className="text-xs text-gray-500 text-center py-4 bg-navy-700/30 rounded-lg">ยังไม่มีประวัติการเข้าเวร</div>
          ) : (
            <div className="space-y-1.5">
              {dutyLogs.map((d) => (
                <div key={d.id} className="bg-navy-700/50 border border-blue-900/40 rounded-lg px-3 py-2 flex items-center justify-between">
                  <div className="text-xs text-white">{formatDate(d.clock_in)}</div>
                  <div className="text-[10px] text-gray-400">
                    {d.clock_out
                      ? `${(d.duration_minutes ?? 0)} นาที`
                      : <span className="text-emerald-400 font-semibold">กำลังเข้าเวร</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent services */}
        <div>
          <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5">
            <DollarSign size={14} className="text-emerald-400" />
            บริการที่ทำล่าสุด
          </h3>
          {loading ? (
            <div className="space-y-2">
              <Skeleton variant="text" className="w-full" height={32} />
              <Skeleton variant="text" className="w-full" height={32} />
            </div>
          ) : services.length === 0 ? (
            <div className="text-xs text-gray-500 text-center py-4 bg-navy-700/30 rounded-lg">ยังไม่มีประวัติการให้บริการ</div>
          ) : (
            <div className="space-y-1.5">
              {services.map((s) => (
                <div key={s.id} className="bg-navy-700/50 border border-blue-900/40 rounded-lg px-3 py-2 flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-white truncate">{s.service_name}</div>
                    <div className="text-[10px] text-gray-500">{formatDate(s.created_at)}</div>
                  </div>
                  <div className="text-right ml-2 flex-shrink-0">
                    <div className="text-xs font-semibold text-amber-400">฿{s.amount.toLocaleString()}</div>
                    <div className={`text-[10px] ${s.status === 'paid' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {s.status === 'paid' ? 'ชำระแล้ว' : 'ค้างชำระ'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ปุ่มปิดหน้าต่าง — โมดัลนี้เดิมปิดได้ด้วย X ลอยบนซ้ายบนอย่างเดียว */}
        <div className="flex justify-end pt-1">
          <button type="button" onClick={onClose} className="btn-secondary px-5 py-2 text-sm">
            ปิด
          </button>
        </div>
      </div>
    </Modal>
  );
}