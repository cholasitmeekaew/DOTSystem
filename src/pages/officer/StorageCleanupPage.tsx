/* =============================================================
 * StorageCleanupPage.tsx — สถิติพื้นที่จัดเก็บ (รายโมดูล)
 * -------------------------------------------------------------
 * แสดงเฉพาะตารางสถิติรายโมดูล จาก Mapping Table:
 *   storage_module_registry + storage_module_locations
 *   ผ่าน RPC get_module_storage_stats()
 * ============================================================= */

import { useEffect, useState, useMemo } from 'react';
import { HardDrive, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

/* ─── โมดูล (ใช้จัดกลุ่มตารางในฐานข้อมูล) ─── */
interface ModuleDef {
  key: string;
  label: string;
  tables: string[];
}

const MODULES: ModuleDef[] = [
  { key: 'officers',     label: 'เจ้าหน้าที่',       tables: ['officers','officer_generations','officer_leaves','officer_login_logs','service_record_officers'] },
  { key: 'duty',         label: 'เข้าเวร / ตารางเวร', tables: ['duty_logs','duty_schedules','schedule_overrides','leave_quotas'] },
  { key: 'services',     label: 'เคส / บริการ',       tables: ['citizens','service_records','service_payments','service_record_revenue_overrides','claim_records'] },
  { key: 'points',       label: 'คะแนน / งบประมาณ',    tables: ['points_award_marks','department_balances','manual_budget_injections'] },
  { key: 'work_reports', label: 'รายงานปฏิบัติงาน',    tables: ['work_reports','work_report_cases'] },
  { key: 'announcements',label: 'ประกาศ / ข่าวสาร',    tables: ['announcements'] },
  { key: 'complaints',   label: 'ร้องเรียน',           tables: ['complaints'] },
  { key: 'vehicles',     label: 'ยานพาหนะ / ใบอนุญาต', tables: ['vehicles','licenses'] },
  { key: 'emergency',    label: 'แจ้งเหตุฉุกเฉิน',      tables: ['emergency_reports'] },
  { key: 'manual',       label: 'คู่มือ',               tables: ['manual_chapters','manual_items','manual_sections','manual_blocks'] },
  { key: 'system',       label: 'ระบบ / ตั้งค่า',        tables: ['system_settings','audit_logs','officer_ranks','pps_penalty_config','server_status_daily','server_status_daily_log'] },
  { key: 'other',        label: 'อื่น ๆ',              tables: [] },
];

/* ─── สถิติจาก Mapping Table (storage_module_registry + locations) ─── */
interface ModuleStorageStats {
  module_key: string;
  module_label: string;
  file_count: number;
  file_bytes: number;
  db_ref_count: number;
}

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
  const [rows, setRows] = useState<StorageRow[]>([]);
  const [modStorageStats, setModStorageStats] = useState<ModuleStorageStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.rpc('get_storage_usage');
      if (error) { setErr(error.message); setLoading(false); return; }
      setRows((data ?? []) as StorageRow[]);
      // สถิติจาก Mapping Table (registry + locations)
      const ms = await supabase.rpc('get_module_storage_stats');
      if (!ms.error && ms.data) setModStorageStats(ms.data as ModuleStorageStats[]);
      setLoading(false);
    })();
  }, []);

  /* ─── จับกลุ่มตามโมดูล ─── */
  const moduleStats = useMemo(() => {
    const tableToModule = new Map<string, ModuleDef>();
    MODULES.forEach((m) => m.tables.forEach((t) => tableToModule.set(t, m)));

    const groups = new Map<string, { def: ModuleDef; bytes: number; rows: number }>();
    MODULES.forEach((m) => groups.set(m.key, { def: m, bytes: 0, rows: 0 }));

    for (const r of rows) {
      const mod = tableToModule.get(r.table_name) ?? MODULES[MODULES.length - 1];
      const g = groups.get(mod.key);
      if (g) { g.bytes += r.total_bytes; g.rows += r.row_count; }
    }
    return [...groups.values()].sort((a, b) => b.bytes - a.bytes);
  }, [rows]);

  /** module_key → สถิติจาก mapping table */
  const modStorageMap = useMemo(() => {
    const m = new Map<string, ModuleStorageStats>();
    for (const f of modStorageStats) m.set(f.module_key, f);
    return m;
  }, [modStorageStats]);

  const totalUsed = rows.reduce((s, r) => s + r.total_bytes, 0);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-amber-500" size={28} /></div>;
  if (err) return <div className="card p-4 text-red-400 text-sm">โหลดข้อมูลไม่สำเร็จ: {err}</div>;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* ═══ ตารางสถิติรายโมดูล ═══ */}
      <div className="card p-5">
        <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
          <HardDrive size={16} className="text-amber-400" />
          พื้นที่จัดเก็บข้อมูล (รายโมดูล)
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-2 py-2 text-gray-500 font-medium">โมดูล</th>
                <th className="text-right px-2 py-2 text-gray-500 font-medium">จำนวนแถว</th>
                <th className="text-center px-2 py-2 text-gray-500 font-medium">🖼 รูปที่แนบในเมนู</th>
                <th className="text-center px-2 py-2 text-gray-500 font-medium">📁 รูปใน Storage</th>
                <th className="text-right px-2 py-2 text-gray-500 font-medium">พื้นที่ DB</th>
                <th className="text-right px-2 py-2 text-gray-500 font-medium">ขนาดรูป</th>
                <th className="text-right px-2 py-2 text-gray-500 font-medium">สัดส่วน</th>
                <th className="text-left px-2 py-2 text-gray-500 font-medium">📊</th>
              </tr>
            </thead>
            <tbody>
              {moduleStats.map((g) => {
                const pct = totalUsed > 0 ? (g.bytes / totalUsed) * 100 : 0;
                // สถิติจาก mapping table ของโมดูลนี้โดยตรง
                const ms = modStorageMap.get(g.def.key);
                const fileCount = ms?.file_count ?? 0;
                const fileBytes = ms?.file_bytes ?? 0;
                const dbRefs = ms?.db_ref_count ?? 0;
                const hasStorage = !!ms;
                return (
                  <tr key={g.def.key} className="border-b border-gray-800/50 hover:bg-navy-900/30">
                    <td className="px-2 py-2 text-white font-medium">{g.def.label}</td>
                    <td className="px-2 py-2 text-right font-mono text-gray-400">{g.rows.toLocaleString()}</td>
                    <td className="px-2 py-2 text-center font-mono">
                      {!hasStorage ? <span className="text-gray-700">—</span>
                        : dbRefs > 0 ? <span className="text-emerald-400">{dbRefs} รูป</span>
                        : <span className="text-gray-600">0 รูป</span>}
                    </td>
                    <td className="px-2 py-2 text-center font-mono">
                      {!hasStorage ? <span className="text-gray-700">—</span>
                        : fileCount > 0 ? <span className="text-blue-300">{fileCount} รูป</span>
                        : <span className="text-gray-600">0 รูป</span>}
                    </td>
                    <td className="px-2 py-2 text-right font-mono text-gray-300">{fmtBytes(g.bytes)}</td>
                    <td className="px-2 py-2 text-right font-mono text-blue-300">
                      {!hasStorage || fileBytes <= 0 ? <span className="text-gray-700">—</span> : fmtBytes(fileBytes)}
                    </td>
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
            <tfoot>
              <tr className="border-t-2 border-gray-700 font-bold">
                <td className="px-2 py-2 text-white">รวมทั้งหมด</td>
                <td className="px-2 py-2 text-right font-mono text-gray-300">
                  {rows.reduce((s, r) => s + r.row_count, 0).toLocaleString()}
                </td>
                <td className="px-2 py-2 text-center font-mono text-emerald-400">
                  {modStorageStats.reduce((s, m) => s + m.db_ref_count, 0)} รูป
                </td>
                <td className="px-2 py-2 text-center font-mono text-blue-300">
                  {modStorageStats.reduce((s, m) => s + m.file_count, 0)} รูป
                </td>
                <td className="px-2 py-2 text-right font-mono text-white">{fmtBytes(totalUsed)}</td>
                <td className="px-2 py-2 text-right font-mono text-blue-300">
                  {fmtBytes(modStorageStats.reduce((s, m) => s + m.file_bytes, 0))}
                </td>
                <td className="px-2 py-2 text-right font-mono text-amber-400">
                  {moduleStats.reduce((s, g) => s + (totalUsed > 0 ? (g.bytes / totalUsed) * 100 : 0), 0).toFixed(1)}%
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="mt-3 text-[11px] text-gray-500 leading-relaxed">
          🖼 <span className="text-emerald-400">รูปที่แนบในเมนู</span> = URL รูปที่ผูกกับข้อมูลของเมนูนั้นในฐานข้อมูล ·
          📁 <span className="text-blue-300">รูปใน Storage</span> = ไฟล์จริงใน bucket/โฟลเดอร์ของเมนูนั้น
        </p>
      </div>
    </div>
  );
}
