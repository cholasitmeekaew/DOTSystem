import { useEffect, useMemo, useState } from 'react';
import {
  Award, Search, Plus, Minus, X, History, RotateCcw, Trophy, TrendingUp, TrendingDown,
} from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';
import {
  Officer, PointsLogEntry, RANK_LABELS, DEPARTMENT_LABELS,
  POINTS_REWARDS, POINTS_PENALTIES, getPointsLevel,
} from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { addOfficerPoints, resetMonthlyPeriod } from '../../lib/api/points';
import { PageHeader } from '../../components/PageHeader';
import { FadeIn } from '../../components/animations';

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function PointsManagementPage() {
  const { officer: actor, isCommissioner } = useAuth();
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Officer | null>(null);
  const [resetting, setResetting] = useState(false);

  async function fetchAll() {
    setLoading(true);
    // ลอง order by points ก่อน ถ้า column ยังไม่มี (migration ยังไม่ apply) fallback เป็น order by name
    let { data, error } = await supabase
      .from('officers')
      .select('*')
      .neq('status', 'deleted')
      .order('points', { ascending: false });
    if (error && /column.*\bpoint(s|_period|_log)?\b.*does not exist/i.test(error.message)) {
      const r2 = await supabase
        .from('officers')
        .select('*')
        .neq('status', 'deleted')
        .order('name', { ascending: true });
      data = r2.data;
      error = r2.error;
    }
    if (error) {
      alert(`โหลดข้อมูลไม่สำเร็จ: ${error.message}`);
    }
    const list = (data as unknown as Officer[]) ?? [];
    // เรียงตามคะแนนใน JS (กัน null + fallback)
    setOfficers(list.slice().sort((a, b) => (b.points ?? 0) - (a.points ?? 0)));
    setLoading(false);
  }

  useEffect(() => { fetchAll(); }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return officers;
    return officers.filter((o) =>
      o.name.toLowerCase().includes(q) ||
      o.username.toLowerCase().includes(q) ||
      (RANK_LABELS[o.rank] ?? o.rank).toLowerCase().includes(q) ||
      (DEPARTMENT_LABELS[o.department] ?? o.department).toLowerCase().includes(q)
    );
  }, [officers, search]);

  async function handleAddPoints(o: Officer, delta: number, reason: string) {
    if (!actor) return;
    try {
      await addOfficerPoints(o.id, delta, reason, actor.id, actor.name);
      await fetchAll();
      // refresh editing row
      const { data } = await supabase.from('officers').select('*').eq('id', o.id).single();
      if (data) setEditing(data as unknown as Officer);
    } catch (e) {
      alert(`เกิดข้อผิดพลาด: ${(e as Error).message}`);
    }
  }

  async function handleReset() {
    if (!actor) return;
    if (!confirm(`รีเซ็ตคะแนนทั้งหมดเป็น 0 สำหรับงวดใหม่ "${new Date().toISOString().slice(0, 7)}"?\n\nการกระทำนี้ไม่สามารถยกเลิกได้`)) return;
    setResetting(true);
    try {
      const { affected } = await resetMonthlyPeriod(actor.id, actor.name);
      alert(`รีเซ็ตสำเร็จ — อัปเดต ${affected} คน`);
      await fetchAll();
      setEditing(null);
    } catch (e) {
      alert(`เกิดข้อผิดพลาด: ${(e as Error).message}`);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div>
      <PageHeader
        icon={<Award size={26} />}
        title="จัดการคะแนนสะสม"
        subtitle="เพิ่ม/ลดคะแนน และรีเซ็ตประจำเดือน"
        actions={
          isCommissioner && (
            <button
              onClick={handleReset}
              disabled={resetting}
              className="btn-secondary flex items-center gap-2 disabled:opacity-50"
            >
              <RotateCcw size={16} className={resetting ? 'animate-spin' : ''} />
              รีเซ็ตประจำเดือน
            </button>
          )
        }
      />

      <FadeIn className="mb-4">
        <div className="card relative max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            className="input-field pl-9"
            placeholder="ค้นหาด้วยชื่อ / username / ตำแหน่ง / แผนก..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <div className="card p-2 sm:p-3">
          {loading ? (
            <div className="text-center text-gray-400 py-8 text-sm">กำลังโหลด...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-gray-500 py-8 text-sm">ไม่พบเจ้าหน้าที่</div>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((o) => {
                const level = getPointsLevel(o.points ?? 0);
                return (
                  <button
                    key={o.id}
                    onClick={() => setEditing(o)}
                    className="w-full flex items-center gap-3 p-3 rounded-lg bg-navy-900/40 hover:bg-navy-700/60 border border-blue-900/30 hover:border-amber-500/30 transition-all text-left"
                  >
                    <div className="w-10 h-10 rounded-full bg-navy-700 flex items-center justify-center flex-shrink-0 text-amber-400 font-bold">
                      {o.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-sm font-semibold truncate">{o.name}</div>
                      <div className="text-xs text-gray-500 truncate">
                        {RANK_LABELS[o.rank] ?? o.rank} · {DEPARTMENT_LABELS[o.department] ?? o.department}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`text-base font-bold ${level.textClass}`}>
                        {(o.points ?? 0).toLocaleString()}
                      </div>
                      <div className={`text-[10px] ${level.textClass} opacity-75`}>{level.label}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </FadeIn>

      {editing && (
        <EditPointsModal
          officer={editing}
          actorName={actor?.name ?? 'ระบบ'}
          onClose={() => setEditing(null)}
          onAdd={handleAddPoints}
        />
      )}
    </div>
  );
}

function EditPointsModal({
  officer, actorName, onClose, onAdd,
}: {
  officer: Officer;
  actorName: string;
  onClose: () => void;
  onAdd: (o: Officer, delta: number, reason: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<'reward' | 'penalty' | 'custom'>('reward');
  const [preset, setPreset] = useState(POINTS_REWARDS[0].label);
  const [customDelta, setCustomDelta] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const presets = tab === 'reward' ? POINTS_REWARDS : tab === 'penalty' ? POINTS_PENALTIES : [];
  const selectedDelta = tab === 'custom' ? parseInt(customDelta || '0', 10) : (presets.find((p) => p.label === preset)?.delta ?? 0);
  const finalReason = tab === 'custom' ? reason.trim() : preset + (reason.trim() ? ` (${reason.trim()})` : '');

  const level = getPointsLevel(officer.points);
  const log = (officer.points_log ?? []).slice().reverse();
  const currentPoints = officer.points ?? 0;
  const newPoints = Math.max(0, currentPoints + selectedDelta);
  const newLevel = getPointsLevel(newPoints);
  const levelUp = newLevel.min > level.min;

  async function handleSubmit() {
    if (selectedDelta === 0) {
      alert('กรุณาระบุจำนวนคะแนนที่ไม่เป็น 0');
      return;
    }
    if (!finalReason) {
      alert('กรุณาระบุเหตุผล');
      return;
    }
    setSubmitting(true);
    try {
      await onAdd(officer, selectedDelta, finalReason);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm anim-fadeIn" onClick={onClose}>
      <div
        className="bg-navy-800 border border-blue-900/50 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[92dvh] flex flex-col shadow-2xl anim-slideUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-blue-900/40 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-white">จัดการคะแนน — {officer.name}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              คะแนนปัจจุบัน: <span className={`font-semibold ${level.textClass}`}>{currentPoints.toLocaleString()}</span> · ระดับ {level.label}
            </p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-navy-700 hover:bg-navy-600 text-gray-400 hover:text-white flex items-center justify-center">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-blue-900/40 px-4 sm:px-5 flex-shrink-0">
          <TabBtn active={tab === 'reward'} onClick={() => setTab('reward')} icon={<Plus size={14} />} color="emerald">เพิ่มคะแนน</TabBtn>
          <TabBtn active={tab === 'penalty'} onClick={() => setTab('penalty')} icon={<Minus size={14} />} color="red">หักคะแนน</TabBtn>
          <TabBtn active={tab === 'custom'} onClick={() => setTab('custom')} icon={<Award size={14} />} color="blue">กำหนดเอง</TabBtn>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 scrollbar-thin">
          {tab !== 'custom' ? (
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">เลือกเหตุผล</label>
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1 scrollbar-thin">
                {presets.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => setPreset(p.label)}
                    className={`w-full flex items-center justify-between gap-2 p-2.5 rounded-lg border text-sm text-left transition-colors ${
                      preset === p.label
                        ? p.delta > 0
                          ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                          : 'bg-red-500/10 border-red-500/40 text-red-300'
                        : 'bg-navy-900/40 border-blue-900/30 text-gray-300 hover:border-amber-500/30'
                    }`}
                  >
                    <span className="flex-1">{p.label}</span>
                    <span className={`font-bold ${p.delta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {p.delta > 0 ? '+' : ''}{p.delta}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">คะแนน (ใส่เครื่องหมายลบได้)</label>
                <input
                  type="number"
                  value={customDelta}
                  onChange={(e) => setCustomDelta(e.target.value)}
                  placeholder="เช่น 25 หรือ -15"
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">เหตุผล <span className="text-red-400">*</span></label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="ระบุเหตุผล..."
                  className="input-field resize-none"
                />
              </div>
            </div>
          )}

          {tab !== 'custom' && (
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">เหตุผลเพิ่มเติม (ไม่บังคับ)</label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="เช่น กะเช้าวันที่ 15 ส.ค."
                className="input-field"
              />
            </div>
          )}

          {/* Preview */}
          <div className="p-3 rounded-lg bg-navy-900/60 border border-blue-900/40">
            <div className="flex items-center justify-between text-sm flex-wrap gap-2">
              <span className="text-gray-400">ใหม่:</span>
              <div className="flex items-center gap-2">
                <span className={`text-lg font-bold ${selectedDelta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {newPoints.toLocaleString()}
                </span>
                <span className="text-xs text-gray-500">
                  ({selectedDelta > 0 ? '+' : ''}{selectedDelta})
                </span>
              </div>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-xs flex-wrap gap-1">
              <span className="text-gray-500">ระดับ:</span>
              <div className="flex items-center gap-1.5">
                <span className={level.textClass}>{level.label}</span>
                {levelUp && <span className="text-emerald-400">→ <strong>{newLevel.label}</strong> 🎉</span>}
              </div>
            </div>
          </div>

          {/* History */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <History size={14} className="text-gray-400" />
              <h3 className="text-sm font-semibold text-white">ประวัติ</h3>
              <span className="text-xs text-gray-500">({log.length})</span>
            </div>
            {log.length === 0 ? (
              <div className="text-center text-gray-500 text-xs py-3">ยังไม่มีประวัติ</div>
            ) : (
              <ul className="space-y-1 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                {log.slice(0, 20).map((entry, i) => {
                  const positive = entry.delta > 0;
                  return (
                    <li key={i} className="flex items-start gap-2 p-2 rounded bg-navy-900/40 text-xs">
                      <div className={`mt-0.5 w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${
                        positive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                      }`}>
                        {positive ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-gray-200 truncate">{entry.reason}</span>
                          <span className={`font-bold flex-shrink-0 ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
                            {positive ? '+' : ''}{entry.delta}
                          </span>
                        </div>
                        <div className="text-gray-500 text-[10px] mt-0.5">
                          {formatDate(entry.at)} · โดย {entry.by_name}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 p-4 sm:p-5 border-t border-blue-900/40 bg-navy-900/40 flex-shrink-0">
          <button onClick={onClose} className="btn-secondary flex-1">ยกเลิก</button>
          <button
            onClick={handleSubmit}
            disabled={submitting || selectedDelta === 0}
            className={`flex-1 flex items-center justify-center gap-1.5 font-semibold py-2.5 rounded-lg text-sm transition-colors disabled:opacity-50 ${
              selectedDelta >= 0
                ? 'bg-emerald-500 hover:bg-emerald-400 text-navy-900'
                : 'bg-red-500 hover:bg-red-400 text-white'
            }`}
          >
            {selectedDelta >= 0 ? <Plus size={16} /> : <Minus size={16} />}
            {submitting ? 'กำลังบันทึก...' : `ยืนยัน ${selectedDelta > 0 ? '+' : ''}${selectedDelta} คะแนน`}
          </button>
        </div>
      </div>
    </div>
  );
}

function TabBtn({
  active, onClick, icon, color, children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  color: 'emerald' | 'red' | 'blue';
  children: React.ReactNode;
}) {
  const colorMap = {
    emerald: active ? 'border-emerald-500 text-emerald-300' : 'border-transparent text-gray-400 hover:text-gray-200',
    red: active ? 'border-red-500 text-red-300' : 'border-transparent text-gray-400 hover:text-gray-200',
    blue: active ? 'border-blue-500 text-blue-300' : 'border-transparent text-gray-400 hover:text-gray-200',
  };
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${colorMap[color]}`}
    >
      {icon}
      {children}
    </button>
  );
}
