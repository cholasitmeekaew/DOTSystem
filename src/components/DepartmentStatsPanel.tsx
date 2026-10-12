/* =============================================================
 * DepartmentStatsPanel.tsx
 * -------------------------------------------------------------
 * "สถิติการปฏิบัติหน้าที่ — รวมทั้งกรม" (ย้ายจากหน้าปฏิบัติงานมาที่เมนู Admin)
 * ดึงข้อมูลเองทั้งหมด จึงวางที่ไหนก็ได้โดยไม่ต้องพึ่ง state ของหน้าอื่น
 * ============================================================= */

import { useEffect, useMemo, useState } from 'react';
import { BarChart3, TrendingUp, Clock, Zap } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { RankedList, type RankItem } from './RankedList';

interface DutyStat {
  officer_id: string | null;
  officer_name: string | null;
  duration_minutes: number | null;
}

export function DepartmentStatsPanel() {
  const [logs, setLogs] = useState<DutyStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortCount, setSortCount] = useState<'desc' | 'asc'>('desc');
  const [sortHours, setSortHours] = useState<'desc' | 'asc'>('desc');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('duty_logs')
        .select('officer_id, officer_name, duration_minutes')
        .is('deleted_at', null);
      if (!cancelled) {
        setLogs((data ?? []) as DutyStat[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const byCount = useMemo<RankItem[]>(() => {
    const map = new Map<string, { name: string; count: number }>();
    for (const log of logs) {
      if (!log.officer_id) continue;
      const cur = map.get(log.officer_id)
        ?? { name: log.officer_name || 'ไม่ทราบชื่อ', count: 0 };
      cur.count += 1;
      map.set(log.officer_id, cur);
    }
    return [...map.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([oid, v]) => ({ id: oid, primary: v.name, value: `${v.count} เวร` }));
  }, [logs]);

  const byHours = useMemo<RankItem[]>(() => {
    const map = new Map<string, { name: string; minutes: number }>();
    for (const log of logs) {
      if (!log.officer_id || log.duration_minutes == null) continue;
      const cur = map.get(log.officer_id)
        ?? { name: log.officer_name || 'ไม่ทราบชื่อ', minutes: 0 };
      cur.minutes += log.duration_minutes;
      map.set(log.officer_id, cur);
    }
    return [...map.entries()]
      .sort((a, b) => b[1].minutes - a[1].minutes)
      .map(([oid, v]) => {
        const h = Math.floor(v.minutes / 60);
        const m = v.minutes % 60;
        return { id: oid, primary: v.name, value: h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที` };
      });
  }, [logs]);

  return (

        <div className="card overflow-hidden mb-6">
          <div className="ph-panel-head flex items-center gap-2">
            <span className="ph-corner ph-corner-tl" aria-hidden />
            <span className="ph-corner ph-corner-br" aria-hidden />
            <BarChart3 size={15} className="text-amber-400" />
            <h2 className="text-xs font-bold text-white tracking-wide">สถิติการปฏิบัติหน้าที่ — รวมทั้งกรม</h2>
          </div>
          <div className="p-3 sm:p-4 grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            {/* Duty Count Card */}
            <div className="card overflow-hidden flex flex-col min-w-0">
              <div className="ph-panel-head flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="ph-corner ph-corner-tl" aria-hidden />
                  <span className="ph-corner ph-corner-br" aria-hidden />
                  <Clock size={13} className="text-amber-400" />
                  <h3 className="text-xs font-bold text-white tracking-wide">เข้าเวรบ่อยที่สุด</h3>
                </span>
                <div className="gold-toggle">
                  <button className={sortCount === 'desc' ? 'active' : ''} onClick={(e) => { e.stopPropagation(); setSortCount('desc'); }}>มาก→น้อย</button>
                  <button className={sortCount === 'asc' ? 'active' : ''} onClick={(e) => { e.stopPropagation(); setSortCount('asc'); }}>น้อย→มาก</button>
                </div>
              </div>
              <div className="flex-1 p-2 space-y-1.5 min-h-[180px]">
                {byCount.length === 0 ? (
                  <p className="text-gray-500 text-xs text-center py-8">ยังไม่มีประวัติการเข้าเวร</p>
                ) : (sortCount === 'desc' ? byCount : [...byCount].reverse()).map((item, idx) => (
                  <div key={item.id} className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors">
                    <span className={`w-6 h-6 rounded-md border flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${idx === 0 ? 'bg-amber-500/20 text-amber-300 border-amber-500/50' : idx === 1 ? 'bg-slate-400/15 text-slate-300 border-slate-400/40' : idx === 2 ? 'bg-orange-700/20 text-orange-300 border-orange-600/40' : 'bg-navy-700/60 text-gray-500 border-blue-900/40'}`}>{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-xs font-medium truncate">{item.primary}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-white text-xs font-semibold whitespace-nowrap">{item.value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Duty Hours Card */}
            <div className="card overflow-hidden flex flex-col">
              <div className="ph-panel-head flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="ph-corner ph-corner-tl" aria-hidden />
                  <span className="ph-corner ph-corner-br" aria-hidden />
                  <Zap size={13} className="text-amber-400" />
                  <h3 className="text-xs font-bold text-white tracking-wide">ชั่วโมงสะสมมากที่สุด</h3>
                </span>
                <div className="gold-toggle">
                  <button className={sortHours === 'desc' ? 'active' : ''} onClick={(e) => { e.stopPropagation(); setSortHours('desc'); }}>มาก→น้อย</button>
                  <button className={sortHours === 'asc' ? 'active' : ''} onClick={(e) => { e.stopPropagation(); setSortHours('asc'); }}>น้อย→มาก</button>
                </div>
              </div>
              <div className="flex-1 p-2 space-y-1.5 min-h-[180px]">
                {byHours.length === 0 ? (
                  <p className="text-gray-500 text-xs text-center py-8">ยังไม่มีประวัติการเข้าเวร</p>
                ) : (sortHours === 'desc' ? byHours : [...byHours].reverse()).map((item, idx) => (
                  <div key={item.id} className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors">
                    <span className={`w-6 h-6 rounded-md border flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${idx === 0 ? 'bg-amber-500/20 text-amber-300 border-amber-500/50' : idx === 1 ? 'bg-slate-400/15 text-slate-300 border-slate-400/40' : idx === 2 ? 'bg-orange-700/20 text-orange-300 border-orange-600/40' : 'bg-navy-700/60 text-gray-500 border-blue-900/40'}`}>{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-xs font-medium truncate">{item.primary}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-white text-xs font-semibold whitespace-nowrap">{item.value}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
  );
}
