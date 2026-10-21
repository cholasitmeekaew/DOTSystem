/* =============================================================
 * StorageCleanupPage.tsx — กราฟพื้นที่จัดเก็บ + เครื่องมือลบข้อมูล
 * -------------------------------------------------------------
 * ส่วนกลางใน Admin Dashboard:
 *
 * 3.1 Storage Usage Chart
 *   - กราฟวงกลม Used/Free
 *   - ตารางรายละเอียดแยกตามโมดูล (MB/GB)
 *
 * 3.2 Cleanup Tool
 *   - เลือกโมดูล + ช่วงวันที่
 *   - 🔒 โมดูลสถิติ: ล็อก Image Storage Only (ห้ามลบ Row)
 *   - โมดูลทั่วไป: ลบรูปภาพ หรือ ลบทั้งหมด
 *   - Confirmation Modal: พิมพ์ CONFIRM ก่อนลบ
 *   - แสดง SQL ที่รันจริง
 * ============================================================= */

import { useEffect, useState, useMemo } from 'react';
import {
  HardDrive, Trash2, Lock, Loader2, Database, Image as ImageIcon,
  AlertTriangle, FileCode2, ChevronDown, ChevronRight,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';

/* ─── โมดูล ─── */
interface ModuleDef {
  key: string;
  label: string;
  tables: string[];
  /** ล็อก: ลบได้เฉพาะรูปภาพ ห้ามลบ Row (สถิติ/คะแนน) */
  imageOnly?: boolean;
  /** คอลัมน์ที่เก็บรูป URL (ใช้ลบเฉพาะไฟล์) */
  imageColumns?: string[];
}

const MODULES: ModuleDef[] = [
  { key: 'officers',     label: 'เจ้าหน้าที่',       tables: ['officers','officer_generations','officer_leaves','officer_login_logs','service_record_officers'], imageColumns: ['photo_url'] },
  { key: 'duty',         label: 'เข้าเวร / ตารางเวร', tables: ['duty_logs','duty_schedules','schedule_overrides','leave_quotas'], imageOnly: false },
  { key: 'services',     label: 'เคส / บริการ',       tables: ['citizens','service_records','service_payments','service_record_revenue_overrides','claim_records'], imageOnly: false },
  { key: 'points',       label: 'คะแนน / งบประมาณ',    tables: ['points_award_marks','department_balances','manual_budget_injections'], imageOnly: true },
  { key: 'work_reports', label: 'รายงานปฏิบัติงาน',    tables: ['work_reports','work_report_cases'], imageOnly: true },
  { key: 'announcements',label: 'ประกาศ / ข่าวสาร',    tables: ['announcements'], imageColumns: ['image_url'] },
  { key: 'complaints',   label: 'ร้องเรียน',           tables: ['complaints'], imageOnly: false },
  { key: 'vehicles',     label: 'ยานพาหนะ / ใบอนุญาต', tables: ['vehicles','licenses'], imageColumns: ['image_url','photo_url'] },
  { key: 'emergency',    label: 'แจ้งเหตุฉุกเฉิน',      tables: ['emergency_reports'], imageOnly: false },
  { key: 'manual',       label: 'คู่มือ',               tables: ['manual_chapters','manual_items','manual_sections','manual_blocks'], imageOnly: true },
  { key: 'system',       label: 'ระบบ / ตั้งค่า',        tables: ['system_settings','audit_logs','officer_ranks','pps_penalty_config','server_status_daily','server_status_daily_log'], imageOnly: true },
  { key: 'other',        label: 'อื่น ๆ',              tables: [] }, // fallback
];

/* ─── ข้อมูลพื้นที่จาก RPC ─── */
interface StorageRow {
  table_name: string;
  row_count: number;
  table_bytes: number;
  total_bytes: number;
}

function fmtBytes(b: number): string {
  if (b >= 1_073_741_824) return (b / 1_073_741_824).toFixed(2) + ' GB';
  if (b >= 1_048_576) return (b / 1_048_576).toFixed(2) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
}

export function StorageCleanupPage() {
  const { officer } = useAuth();
  const [rows, setRows] = useState<StorageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  /* cleanup state */
  const [selectedModule, setSelectedModule] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [deleteMode, setDeleteMode] = useState<'image' | 'purge'>('image');
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [sqlOutput, setSqlOutput] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.rpc('get_storage_usage');
      if (error) { setErr(error.message); setLoading(false); return; }
      setRows((data ?? []) as StorageRow[]);
      setLoading(false);
    })();
  }, []);

  /* ─── จับกลุ่มตามโมดูล ─── */
  const moduleStats = useMemo(() => {
    const tableToModule = new Map<string, ModuleDef>();
    MODULES.forEach((m) => m.tables.forEach((t) => tableToModule.set(t, m)));

    const groups = new Map<string, { def: ModuleDef; bytes: number; rows: number; tables: StorageRow[] }>();
    MODULES.forEach((m) => groups.set(m.key, { def: m, bytes: 0, rows: 0, tables: [] }));

    for (const r of rows) {
      const mod = tableToModule.get(r.table_name) ?? MODULES[MODULES.length - 1];
      const g = groups.get(mod.key);
      if (g) { g.bytes += r.total_bytes; g.rows += r.row_count; g.tables.push(r); }
    }
    return [...groups.values()].sort((a, b) => b.bytes - a.bytes);
  }, [rows]);

  const totalUsed = rows.reduce((s, r) => s + r.total_bytes, 0);
  /** Postgres default จำกัด 100 MB ต่อ database (Free tier) — ใช้เป็น scale */
  /**
   * โควตา Database Storage ของ Supabase Free Tier = 500 MB
   *
   * เดิม hardcode 100 MB ทำให้กราฟแสดงสัดส่วนผิด
   * (ใช้ 200 MB → แสดง 200% ทั้งที่จริงแค่ 40%)
   *
   * ถ้าใช้แพ็กเกจ Pro (8 GB) เปลี่ยนค่านี้ที่เดียว
   */
  const totalCapacity = 500 * 1_048_576;
  const totalFree = Math.max(0, totalCapacity - totalUsed);
  const usedPct = Math.min(100, (totalUsed / totalCapacity) * 100);

  /* ─── สร้าง SQL สำหรับ cleanup ─── */
  function buildSql(): string {
    const mod = MODULES.find((m) => m.key === selectedModule);
    if (!mod) return '';
    const lines: string[] = [
      '-- =============================================================',
      `-- Cleanup: ${mod.label}`,
      `-- ช่วงวันที่: ${dateFrom || '*'} → ${dateTo || '*'}`,
      `-- โหมด: ${deleteMode === 'image' ? 'ลบเฉพาะรูปภาพ' : 'ลบทั้งหมด (Purge)'}`,
      '-- =============================================================',
    ];

    if (deleteMode === 'image') {
      for (const col of mod.imageColumns ?? []) {
        for (const t of mod.tables) {
          lines.push(`-- ลบรูปภาพจาก ${t}.${col}`);
          lines.push(`update public.${t} set ${col} = null where ${col} is not null`);
        }
      }
      if (!mod.imageColumns?.length) {
        lines.push('-- โมดูลนี้ไม่มีคอลัมน์รูปภาพโดยตรง');
      }
    } else {
      for (const t of mod.tables) {
        const where: string[] = [];
        if (dateFrom) where.push(`created_at >= '${dateFrom}'`);
        if (dateTo) where.push(`created_at < '${dateTo}'::date + interval '1 day'`);
        const cond = where.length ? ` where ${where.join(' and ')}` : '';
        lines.push(`delete from public.${t}${cond};`);
      }
    }
    return lines.join('\n');
  }

  async function runCleanup() {
    if (!officer || !selectedModule || confirmText !== 'CONFIRM') return;
    setRunning(true);
    setResult(null);
    setSqlOutput(buildSql());

    const mod = MODULES.find((m) => m.key === selectedModule);
    if (!mod) { setRunning(false); return; }

    const errors: string[] = [];

    if (deleteMode === 'image') {
      for (const col of mod.imageColumns ?? []) {
        for (const t of mod.tables) {
          const { error } = await supabase.from(t).update({ [col]: null }).neq(col, '');
          if (error) errors.push(`${t}: ${error.message}`);
        }
      }
    } else {
      for (const t of mod.tables) {
        let q = supabase.from(t).delete();
        if (dateFrom) q = q.gte('created_at', dateFrom);
        if (dateTo) q = q.lt('created_at', `${dateTo}T23:59:59`);
        const { error } = await q;
        if (error) errors.push(`${t}: ${error.message}`);
      }
    }

    if (errors.length) {
      setResult({ ok: false, msg: errors.join('; ') });
    } else {
      setResult({ ok: true, msg: `ลบ${deleteMode === 'image' ? 'รูปภาพ' : 'ข้อมูล'}จาก "${mod.label}" สำเร็จ` });
      const { data } = await supabase.rpc('get_storage_usage');
      setRows((data ?? []) as StorageRow[]);
    }
    setRunning(false);
    setShowConfirm(false);
    setConfirmText('');
  }

  const selectedMod = MODULES.find((m) => m.key === selectedModule);

  /* ─── Doughnut chart (CSS conic-gradient) ─── */
  const donutStyle = {
    background: `conic-gradient(#3b82f6 0% ${usedPct}%, #1e293b ${usedPct}% 100%)`,
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-amber-500" size={28} /></div>;
  if (err) return <div className="card p-4 text-red-400 text-sm">โหลดข้อมูลไม่สำเร็จ: {err}</div>;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">

      {/* ═══ 3.1 Storage Usage Chart ═══ */}
      <div className="card p-5">
        <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
          <HardDrive size={16} className="text-amber-400" />
          พื้นที่จัดเก็บข้อมูล
        </h2>

        <div className="flex flex-col sm:flex-row items-center gap-6 mb-6">
          {/* Doughnut */}
          <div className="relative w-36 h-36 flex-shrink-0">
            <div className="w-full h-full rounded-full" style={donutStyle} />
            <div className="absolute inset-3 rounded-full bg-navy-950 flex flex-col items-center justify-center">
              <span className="text-lg font-bold text-white">{usedPct.toFixed(1)}%</span>
              <span className="text-[9px] text-gray-500">ใช้แล้ว</span>
            </div>
          </div>

          {/* Legend */}
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm bg-blue-500" />
              <span className="text-gray-400">ใช้ไป:</span>
              <span className="font-mono font-bold text-white">{fmtBytes(totalUsed)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm bg-slate-700" />
              <span className="text-gray-400">ว่าง:</span>
              <span className="font-mono font-bold text-gray-300">{fmtBytes(totalFree)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm bg-gray-600" />
              <span className="text-gray-400">ทั้งหมด:</span>
              <span className="font-mono font-bold text-gray-400">{fmtBytes(totalCapacity)}</span>
            </div>
            <div className="text-[10px] text-gray-600">* ประมาณการจากขนาดตาราง Postgres</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-3 bg-navy-800 rounded-full overflow-hidden mb-6">
          <div
            className="h-full bg-gradient-to-r from-blue-600 to-blue-400 transition-all duration-500"
            style={{ width: `${usedPct}%` }}
          />
        </div>

        {/* Module breakdown table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-2 py-2 text-gray-500 font-medium">โมดูล</th>
                <th className="text-right px-2 py-2 text-gray-500 font-medium">จำนวนแถว</th>
                <th className="text-right px-2 py-2 text-gray-500 font-medium">พื้นที่</th>
                <th className="text-right px-2 py-2 text-gray-500 font-medium">สัดส่วน</th>
                <th className="text-left px-2 py-2 text-gray-500 font-medium">📊</th>
              </tr>
            </thead>
            <tbody>
              {moduleStats.map((g) => {
                const pct = totalUsed > 0 ? (g.bytes / totalUsed) * 100 : 0;
                return (
                  <tr key={g.def.key} className="border-b border-gray-800/50 hover:bg-navy-900/30">
                    <td className="px-2 py-2 text-white font-medium">{g.def.label}</td>
                    <td className="px-2 py-2 text-right font-mono text-gray-400">{g.rows.toLocaleString()}</td>
                    <td className="px-2 py-2 text-right font-mono text-gray-300">{fmtBytes(g.bytes)}</td>
                    <td className="px-2 py-2 text-right font-mono text-amber-400">{pct.toFixed(1)}%</td>
                    <td className="px-2 py-2 w-40">
                      <div className="h-2 bg-navy-800 rounded-full overflow-hidden">
                        <div className="h-full bg-amber-500/70 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ═══ 3.2 Cleanup Tool ═══ */}
      <div className="card p-5">
        <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
          <Trash2 size={16} className="text-red-400" />
          เครื่องมือลบข้อมูล (Cleanup)
        </h2>

        <div className="grid sm:grid-cols-3 gap-4 mb-4">
          {/* เลือกโมดูล */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">โมดูล</label>
            <select
              className="input-field w-full text-sm"
              value={selectedModule}
              onChange={(e) => { setSelectedModule(e.target.value); setDeleteMode('image'); setResult(null); }}
            >
              <option value="">— เลือกโมดูล —</option>
              {MODULES.filter((m) => m.tables.length > 0).map((m) => (
                <option key={m.key} value={m.key}>
                  {m.imageOnly ? '🔒 ' : ''}{m.label}
                </option>
              ))}
            </select>
          </div>

          {/* ช่วงวันที่ */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">จากวันที่</label>
            <input type="date" className="input-field w-full text-sm" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">ถึงวันที่</label>
            <input type="date" className="input-field w-full text-sm" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>

        {/* โหมดลบ */}
        {selectedModule && (
          <div className="mb-4">
            <label className="block text-xs text-gray-400 mb-2">รูปแบบการลบ</label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setDeleteMode('image')}
                className={`px-3 py-2 rounded-lg text-xs font-semibold border-2 transition-colors ${
                  deleteMode === 'image'
                    ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                    : 'border-gray-700 bg-navy-900/50 text-gray-500'
                }`}
              >
                <ImageIcon size={12} className="inline mr-1" />
                ลบเฉพาะรูปภาพ
              </button>

              {!selectedMod?.imageOnly && (
                <button
                  onClick={() => setDeleteMode('purge')}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold border-2 transition-colors ${
                    deleteMode === 'purge'
                      ? 'border-red-500 bg-red-500/15 text-red-300'
                      : 'border-gray-700 bg-navy-900/50 text-gray-500'
                  }`}
                >
                  <Trash2 size={12} className="inline mr-1" />
                  ลบทั้งหมด (Purge)
                </button>
              )}
            </div>

            {/* 🔒 Data Protection Guard */}
            {selectedMod?.imageOnly && (
              <div className="mt-2 flex items-center gap-2 p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                <Lock size={14} className="text-yellow-400 flex-shrink-0" />
                <span className="text-[11px] text-yellow-300">
                  โมดูลนี้ล็อกเฉพาะ <b>Image Storage Only</b> — ห้ามลบ Row/ข้อมูลในฐานข้อมูล
                  เพื่อป้องกันสถิติและคะแนนไม่ให้หายหรือเพี้ยน
                </span>
              </div>
            )}

            {/* ปุ่มลบ */}
            <button
              onClick={() => { setSqlOutput(buildSql()); setShowConfirm(true); }}
              disabled={!selectedModule}
              className="mt-3 btn btn-primary text-xs inline-flex items-center gap-1.5"
            >
              <Trash2 size={13} />
              ลบข้อมูล...
            </button>
          </div>
        )}

        {/* ผลลัพธ์ */}
        {result && (
          <div className={`p-3 rounded-lg text-xs ${
            result.ok ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                      : 'bg-red-500/10 text-red-300 border border-red-500/30'
          }`}>
            {result.msg}
          </div>
        )}

        {/* SQL output */}
        {sqlOutput && (
          <div className="mt-4">
            <div className="text-[10px] text-gray-500 mb-1 flex items-center gap-1">
              <FileCode2 size={11} /> SQL ที่รัน
            </div>
            <pre className="bg-navy-950 border border-gray-800 rounded-lg p-3 text-[11px] font-mono text-gray-400 overflow-x-auto max-h-60 whitespace-pre-wrap">
{sqlOutput}
            </pre>
          </div>
        )}
      </div>

      {/* ═══ Confirmation Modal ═══ */}
      {showConfirm && selectedMod && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4">
          <div className="card max-w-md w-full p-5 border-2 border-red-500/40">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={20} className="text-red-400" />
              <h3 className="text-sm font-bold text-white">ยืนยันการลบข้อมูล</h3>
            </div>

            <div className="space-y-2 text-xs text-gray-400 mb-4">
              <div className="flex justify-between">
                <span>โมดูล:</span>
                <span className="text-white font-semibold">{selectedMod.label}</span>
              </div>
              <div className="flex justify-between">
                <span>รูปแบบ:</span>
                <span className={deleteMode === 'purge' ? 'text-red-400 font-semibold' : 'text-blue-300 font-semibold'}>
                  {deleteMode === 'image' ? 'ลบเฉพาะรูปภาพ' : 'ลบทั้งหมด (Purge)'}
                </span>
              </div>
              {dateFrom && (
                <div className="flex justify-between">
                  <span>จาก:</span><span className="text-white">{dateFrom}</span>
                </div>
              )}
              {dateTo && (
                <div className="flex justify-between">
                  <span>ถึง:</span><span className="text-white">{dateTo}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>ตารางที่ได้รับผลกระทบ:</span>
                <span className="text-white font-mono">{selectedMod.tables.join(', ')}</span>
              </div>
            </div>

            {deleteMode === 'purge' && (
              <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-[11px] text-red-300 mb-3">
                ⚠️ การลบทั้งหมดจะลบ Row ออกจากฐานข้อมูลถาวร ไม่สามารถกู้คืนได้
              </div>
            )}

            <label className="block text-xs text-gray-400 mb-1">
              พิมพ์ <b className="text-red-400">CONFIRM</b> เพื่อยืนยัน:
            </label>
            <input
              className="input-field w-full text-sm font-mono mb-3"
              placeholder="CONFIRM"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoFocus
            />

            <div className="flex gap-2">
              <button
                onClick={runCleanup}
                disabled={confirmText !== 'CONFIRM' || running}
                className="btn flex-1 text-xs font-bold bg-red-600 hover:bg-red-700 text-white inline-flex items-center justify-center gap-1"
              >
                {running ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                ยืนยันลบ
              </button>
              <button
                onClick={() => { setShowConfirm(false); setConfirmText(''); }}
                className="btn btn-outline flex-1 text-xs"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
