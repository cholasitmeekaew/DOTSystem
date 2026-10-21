/* =============================================================
 * StorageGuardPage.tsx — ระบบพื้นที่จัดเก็บ (สร้างใหม่ทั้งหมด)
 * -------------------------------------------------------------
 * 3 ฟีเจอร์ตามข้อกำหนด:
 *   A) Storage Chart & Breakdown
 *      - เปอร์เซ็นต์คำนวณจาก Quota จริงจาก DB (ไม่มี hardcode ฝั่งเว็บ)
 *      - ตารางแยกรายโมดูลอิสระ 100% + แถวสรุปใช้ SUM() ทุกช่อง
 *   B) Safe Cleanup & Quarantine
 *      - สแกนไฟล์กำพร้า แล้วย้ายไป '/quarantine-trash/' อัตโนมัติ
 *      - ปุ่มลบทำงานเฉพาะไฟล์ในโฟลเดอร์กักกันเท่านั้น (ห้ามแตะโฟลเดอร์โมดูล)
 *   C) Data Protection Guard
 *      - ยิง query แยกทีละโมดูล ไม่มี global loop / ไม่ดึงข้ามโมดูล
 *      - ตรวจ JSON response ก่อนเรนเดอร์; ว่าง/ผิดรูป → แสดง 0 หรือ -
 * ============================================================= */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  HardDrive, Loader2, RefreshCw, ShieldCheck, ShieldAlert,
  FolderInput, Trash2, AlertTriangle,
} from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { supabase } from '../../lib/supabase';
import { isJsonMode } from '../../lib/supabase';

/** โฟลเดอร์กักกัน — ปุ่มลบอนุญาตเฉพาะ path ที่ขึ้นต้นด้วยค่านี้ */
const QUARANTINE_PREFIX = 'quarantine-trash/';

interface ModuleStats {
  module_key: string;
  module_label: string;
  row_count: number;
  db_bytes: number;
  db_ref_count: number;
  file_count: number;
  file_bytes: number;
}

interface ModuleRow {
  key: string;
  label: string;
  statsLinked: boolean;
  dateColumn: string | null;
  stats: ModuleStats | null;
  valid: boolean;
  error?: string;
}

interface StorageFile {
  bucket_id: string;
  file_name: string;
  file_size: number;
  created_at: string;
}

function fmtBytes(b: number): string {
  if (b >= 1_073_741_824) return (b / 1_073_741_824).toFixed(2) + ' GB';
  if (b >= 1_048_576) return (b / 1_048_576).toFixed(2) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return b + ' B';
}

/** ค่าตัวเลขที่ใช้ได้เท่านั้น (ไม่ติดลบ) */
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

/** ตรวจความถูกต้องของ JSON response ก่อนเรนเดอร์ */
function validateStats(raw: unknown): ModuleStats | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.module_key !== 'string' || typeof o.module_label !== 'string') return null;
  return {
    module_key: o.module_key,
    module_label: o.module_label,
    row_count: num(o.row_count),
    db_bytes: num(o.db_bytes),
    db_ref_count: num(o.db_ref_count),
    file_count: num(o.file_count),
    file_bytes: num(o.file_bytes),
  };
}

function validateFiles(raw: unknown): StorageFile[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      bucket_id: String(r.bucket_id ?? ''),
      file_name: String(r.file_name ?? ''),
      file_size: num(r.file_size),
      created_at: String(r.created_at ?? ''),
    }))
    .filter((f) => f.bucket_id !== '' && f.file_name !== '');
}

export function StorageGuardPage() {
  const [quota, setQuota] = useState<{ quota_bytes: number; used_bytes: number } | null>(null);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [orphans, setOrphans] = useState<StorageFile[] | null>(null);
  const [quarantined, setQuarantined] = useState<StorageFile[]>([]);
  const [allFiles, setAllFiles] = useState<StorageFile[]>([]);
  const [busy, setBusy] = useState<'' | 'scan' | 'quarantine' | 'delete'>('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /* ── D) ระบบจัดการลบข้อมูล (Auto-Detect + Date Range) ── */
  const [cleanModule, setCleanModule] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [cleanMode, setCleanMode] = useState<'images' | 'purge'>('images');
  const [cleanPreview, setCleanPreview] = useState<{ files: StorageFile[]; rows: number } | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [cleanBusy, setCleanBusy] = useState<'' | 'detect' | 'run'>('');
  const [cleanMsg, setCleanMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /* ── A) โหลด Quota (จริง) ── */
  const loadQuota = useCallback(async () => {
    const { data, error } = await supabase.rpc('storage_quota');
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== 'object') throw new Error('รูปแบบข้อมูลโควตาไม่ถูกต้อง');
    const o = row as Record<string, unknown>;
    return { quota_bytes: num(o.quota_bytes), used_bytes: num(o.used_bytes) };
  }, []);

  /* ── C) ยิงสถิติ "ทีละโมดูล" (query อิสระ ไม่มี loop ข้ามโมดูล) ── */
  const loadOneModule = useCallback(async (
    key: string, label: string, statsLinked: boolean, dateColumn: string | null,
  ): Promise<ModuleRow> => {
    try {
      const { data, error } = await supabase.rpc('storage_module_stats', { p_module_key: key });
      if (error) return { key, label, statsLinked, dateColumn, stats: null, valid: false, error: error.message };
      const raw = Array.isArray(data) ? data[0] : data;
      const stats = validateStats(raw);
      if (!stats) return { key, label, statsLinked, dateColumn, stats: null, valid: false, error: 'response ว่างหรือผิดรูปแบบ' };
      return { key, label, statsLinked, dateColumn, stats, valid: true };
    } catch (e) {
      return { key, label, statsLinked, dateColumn, stats: null, valid: false, error: e instanceof Error ? e.message : String(e) };
    }
  }, []);

  const loadModules = useCallback(async () => {
    const { data, error } = await supabase.rpc('storage_modules');
    if (error) throw new Error(error.message);
    const list = Array.isArray(data) ? data : [];
    const parsed = list
      .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
      .map((m) => ({
        key: String(m.module_key ?? ''),
        label: String(m.module_label ?? ''),
        statsLinked: m.stats_linked === true,
        dateColumn: m.date_column == null ? null : String(m.date_column),
      }))
      .filter((m) => m.key !== '');
    // แต่ละโมดูล = 1 request แยกกัน
    const rows = await Promise.all(
      parsed.map((m) => loadOneModule(m.key, m.label, m.statsLinked, m.dateColumn)),
    );
    return rows;
  }, [loadOneModule]);

  const loadQuarantine = useCallback(async () => {
    const { data, error } = await supabase.rpc('storage_quarantine_files');
    if (error) return [] as StorageFile[];
    return validateFiles(data);
  }, []);

  const loadAllFiles = useCallback(async () => {
    const { data, error } = await supabase.rpc('storage_all_files');
    if (error) return [] as StorageFile[];
    return validateFiles(data);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [q, mods, qfiles, all] = await Promise.all([
        loadQuota(), loadModules(), loadQuarantine(), loadAllFiles(),
      ]);
      setQuota(q);
      setModules(mods);
      setQuarantined(qfiles);
      setAllFiles(all);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [loadQuota, loadModules, loadQuarantine, loadAllFiles]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  /* ── แถวสรุป: SUM() ทุกช่อง ── */
  const totals = useMemo(() => {
    return modules.reduce(
      (a, r) => ({
        row_count: a.row_count + (r.stats?.row_count ?? 0),
        db_bytes: a.db_bytes + (r.stats?.db_bytes ?? 0),
        db_ref_count: a.db_ref_count + (r.stats?.db_ref_count ?? 0),
        file_count: a.file_count + (r.stats?.file_count ?? 0),
        file_bytes: a.file_bytes + (r.stats?.file_bytes ?? 0),
      }),
      { row_count: 0, db_bytes: 0, db_ref_count: 0, file_count: 0, file_bytes: 0 },
    );
  }, [modules]);

  /* ── คำนวณ % จาก Quota จริง ── */
  const quotaBytes = quota?.quota_bytes ?? 0;
  const usedBytes = quota?.used_bytes ?? 0;
  const usedPct = quotaBytes > 0 ? Math.min(100, (usedBytes / quotaBytes) * 100) : 0;

  /* ── Donut: เส้นรอบวง (r=60) ── */
  const donutC = 2 * Math.PI * 60;

  /* ── สรุปภาพรวม Storage (สำหรับการ์ดสรุป 3 ช่อง) ── */
  const totalImagesBytes = useMemo(() => allFiles.reduce((s, f) => s + f.file_size, 0), [allFiles]);
  const activeBuckets = useMemo(() => new Set(allFiles.map((f) => f.bucket_id)).size, [allFiles]);

  /* ── สัดส่วนต่อโมดูล = พื้นที่ DB ของโมดูล ÷ พื้นที่ DB รวม ── */
  const totalDbBytes = totals.db_bytes;
  const modulePct = useCallback(
    (m: ModuleRow) => (totalDbBytes > 0 ? ((m.stats?.db_bytes ?? 0) / totalDbBytes) * 100 : 0),
    [totalDbBytes],
  );
  const totalPct = useMemo(
    () => modules.reduce((s, m) => s + (totalDbBytes > 0 ? ((m.stats?.db_bytes ?? 0) / totalDbBytes) * 100 : 0), 0),
    [modules, totalDbBytes],
  );

  /* ── B) สแกนไฟล์กำพร้า ── */
  async function scanOrphans() {
    setBusy('scan');
    setMsg(null);
    try {
      const allRes = await supabase.rpc('storage_all_files');
      if (allRes.error) throw new Error(allRes.error.message);
      const all = validateFiles(allRes.data);

      // อ้างอิงจาก DB — ยิงแยกทีละโมดูล
      const ref = new Set<string>();
      for (const m of modules) {
        const r = await supabase.rpc('storage_module_refs', { p_module_key: m.key });
        if (r.error) continue;
        if (Array.isArray(r.data)) {
          for (const x of r.data as Array<Record<string, unknown>>) {
            const b = String(x.bucket_id ?? '');
            const p = String(x.path ?? '');
            if (b && p) ref.add(`${b}/${p}`);
          }
        }
      }

      const found = all.filter((f) => !ref.has(`${f.bucket_id}/${f.file_name}`));
      setOrphans(found);
      setMsg(found.length
        ? { ok: true, text: `พบไฟล์กำพร้า ${found.length} ไฟล์ (${fmtBytes(found.reduce((s, f) => s + f.file_size, 0))})` }
        : { ok: true, text: 'ไม่พบไฟล์กำพร้า' });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy('');
    }
  }

  /* ── B) ย้ายไฟล์กำพร้าเข้า /quarantine-trash/ ── */
  async function quarantineOrphans() {
    if (!orphans || orphans.length === 0) return;
    setBusy('quarantine');
    setMsg(null);
    let moved = 0;
    let failed = 0;
    for (const f of orphans) {
      const dest = QUARANTINE_PREFIX + f.file_name;
      const from = f.file_name;
      const bucket = supabase.storage.from(f.bucket_id);
      let ok = false;

      // พยายามใช้ move (atomic) ก่อน
      const anyBucket = bucket as unknown as { move?: (a: string, b: string) => Promise<{ error: unknown }> };
      if (typeof anyBucket.move === 'function') {
        const res = await anyBucket.move(from, dest);
        ok = !res.error;
      }
      // fallback: download → upload → ลบต้นทาง
      if (!ok) {
        const dl = await bucket.download(from);
        if (!dl.error && dl.data) {
          const up = await bucket.upload(dest, dl.data, { upsert: true });
          if (!up.error) {
            await bucket.remove([from]);
            ok = true;
          }
        }
      }

      if (ok) {
        moved += 1;
        await supabase.rpc('storage_log_quarantine', {
          p_bucket_id: f.bucket_id,
          p_original_name: f.file_name,
          p_quarantine_name: dest,
          p_file_size: f.file_size,
        });
      } else {
        failed += 1;
      }
    }

    setOrphans(null);
    setQuarantined(await loadQuarantine());
    setMsg({
      ok: failed === 0,
      text: failed === 0
        ? `ย้ายเข้าโฟลเดอร์กักกันสำเร็จ ${moved} ไฟล์`
        : `ย้ายสำเร็จ ${moved} ไฟล์ · ล้มเหลว ${failed} ไฟล์`,
    });
    setBusy('');
  }

  /* ── B) ลบไฟล์ในโฟลเดอร์กักกันเท่านั้น ── */
  async function deleteQuarantined(files: StorageFile[]) {
    // 🔒 Guard: อนุญาตเฉพาะ path ที่อยู่ในโฟลเดอร์กักกัน
    const safe = files.filter((f) => f.file_name.startsWith(QUARANTINE_PREFIX));
    const blocked = files.length - safe.length;
    if (safe.length === 0) {
      setMsg({ ok: false, text: 'ปฏิเสธการลบ — ไฟล์ไม่ได้อยู่ในโฟลเดอร์กักกัน' });
      return;
    }

    setBusy('delete');
    setMsg(null);
    const byBucket = new Map<string, string[]>();
    for (const f of safe) {
      const arr = byBucket.get(f.bucket_id) ?? [];
      arr.push(f.file_name);
      byBucket.set(f.bucket_id, arr);
    }

    let deleted = 0;
    let failed = 0;
    for (const [bucket, names] of byBucket) {
      const { error } = await supabase.storage.from(bucket).remove(names);
      if (error) failed += names.length;
      else deleted += names.length;
    }

    setQuarantined(await loadQuarantine());
    setMsg({
      ok: failed === 0 && blocked === 0,
      text: `ลบไฟล์ในกักกัน ${deleted} ไฟล์${failed ? ` · ล้มเหลว ${failed}` : ''}${blocked ? ` · กันไว้ ${blocked} (อยู่นอกกักกัน)` : ''}`,
    });
    setBusy('');
  }

  /* ── D) ระบบจัดการลบข้อมูล ── */
  const selectedClean = modules.find((m) => m.key === cleanModule) ?? null;
  const cleanLocked = selectedClean?.statsLinked ?? false;

  useEffect(() => {
    if (!cleanModule && modules.length > 0) setCleanModule(modules[0].key);
  }, [cleanModule, modules]);

  useEffect(() => {
    if (cleanLocked && cleanMode !== 'images') setCleanMode('images');
  }, [cleanLocked, cleanMode]);

  /** Auto-Detect: หาไฟล์ใน Storage + แถวใน DB ตามโมดูลและช่วงวันที่ */
  async function detectCleanup() {
    if (!cleanModule) return;
    setCleanBusy('detect');
    setCleanMsg(null);
    setCleanPreview(null);
    try {
      const args = {
        p_module_key: cleanModule,
        p_from: fromDate || null,
        p_to: toDate || null,
      };
      const [fRes, rRes] = await Promise.all([
        supabase.rpc('storage_module_files', args),
        supabase.rpc('storage_module_row_count', args),
      ]);
      if (fRes.error) throw new Error(fRes.error.message);
      if (rRes.error) throw new Error(rRes.error.message);
      const files = validateFiles(fRes.data);
      const rows = Number(rRes.data ?? 0) || 0;
      setCleanPreview({ files, rows });
    } catch (e) {
      setCleanMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setCleanBusy('');
    }
  }

  /** ลบตามโหมดที่เลือก (images = เฉพาะไฟล์รูป / purge = ลบแถวด้วย) */
  async function runCleanup() {
    if (!cleanPreview || !cleanModule) return;
    if (confirmText.trim() !== 'ลบ') {
      setCleanMsg({ ok: false, text: 'พิมพ์คำว่า "ลบ" เพื่อยืนยันก่อนดำเนินการ' });
      return;
    }
    if (cleanMode === 'purge' && cleanLocked) {
      setCleanMsg({ ok: false, text: 'โมดูลนี้ถูกล็อก (เชื่อมสถิติ/คะแนน) — ลบได้เฉพาะรูปภาพ' });
      return;
    }
    if (cleanMode === 'purge' && !fromDate && !toDate) {
      setCleanMsg({ ok: false, text: 'โหมดลบทั้งหมดต้องระบุช่วงวันที่ (กันการลบทั้งตาราง)' });
      return;
    }

    setCleanBusy('run');
    setCleanMsg(null);
    try {
      // 1) ลบไฟล์ใน Storage (ทุกโหมด)
      const byBucket = new Map<string, string[]>();
      for (const f of cleanPreview.files) {
        const arr = byBucket.get(f.bucket_id) ?? [];
        arr.push(f.file_name);
        byBucket.set(f.bucket_id, arr);
      }
      let fileFail = 0;
      let fileOk = 0;
      for (const [bucket, names] of byBucket) {
        const { error } = await supabase.storage.from(bucket).remove(names);
        if (error) fileFail += names.length;
        else fileOk += names.length;
      }

      // 2) Purge แถวใน DB (เฉพาะโมดูลทั่วไป)
      let rowsDeleted = 0;
      if (cleanMode === 'purge') {
        const { data, error } = await supabase.rpc('storage_purge_module', {
          p_module_key: cleanModule,
          p_from: fromDate || null,
          p_to: toDate || null,
        });
        if (error) throw new Error(error.message);
        rowsDeleted = Number(data ?? 0) || 0;
      }

      setCleanMsg({
        ok: fileFail === 0,
        text: cleanMode === 'purge'
          ? `ลบไฟล์ ${fileOk} ไฟล์${fileFail ? ` (ล้มเหลว ${fileFail})` : ''} · ลบแถวใน DB ${rowsDeleted} แถว`
          : `ลบไฟล์รูปภาพ ${fileOk} ไฟล์${fileFail ? ` (ล้มเหลว ${fileFail})` : ''} · ไม่แตะ Database`,
      });
      setCleanPreview(null);
      setConfirmText('');
      await loadAll();
    } catch (e) {
      setCleanMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setCleanBusy('');
    }
  }

  const invalidModules = modules.filter((m) => !m.valid);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <PageHeader
        icon={<HardDrive size={26} />}
        title="พื้นที่จัดเก็บข้อมูล"
        subtitle="กราฟและสถานะพื้นที่ · เครื่องมือกักกันไฟล์กำพร้า · ป้องกันข้อมูลรวน"
        actions={
          <button
            onClick={() => void loadAll()}
            disabled={loading || isJsonMode}
            className="btn btn-outline text-xs inline-flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            รีเฟรช
          </button>
        }
      />

      {isJsonMode && (
        <div className="card p-4 text-xs text-amber-300 border border-amber-500/30">
          โหมดทดลอง (JSON) — ฟีเจอร์นี้ต้องเชื่อม Supabase
        </div>
      )}

      {err && (
        <div className="card p-4 text-xs text-red-300 border border-red-500/30">
          โหลดข้อมูลไม่สำเร็จ: {err}
          <div className="text-[10px] text-red-400/70 mt-1">
            ตรวจสอบว่ารัน migration 0055_storage_guard_system แล้วหรือยัง
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-amber-500" size={28} /></div>
      ) : !err && (
        <>
          {/* ═══ A) Dashboard + ตารางรายโมดูล ═══ */}
          <div className="card p-5">
            <h2 className="text-sm font-bold text-white mb-4">ภาพรวมพื้นที่จัดเก็บ</h2>

            <div className="grid gap-6 md:grid-cols-[200px_1fr] items-center">
              {/* Donut Chart */}
              <div className="flex flex-col items-center">
                <div className="relative w-[180px] h-[180px]">
                  <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
                    <circle cx="80" cy="80" r="60" fill="none" strokeWidth="18"
                      className="stroke-navy-800" />
                    <circle cx="80" cy="80" r="60" fill="none" strokeWidth="18" strokeLinecap="round"
                      className="stroke-amber-500 transition-all duration-500"
                      strokeDasharray={`${(usedPct / 100) * donutC} ${donutC}`} />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-2xl font-bold text-white">{usedPct.toFixed(1)}%</div>
                    <div className="text-[10px] text-gray-400">ใช้แล้ว</div>
                  </div>
                </div>

                <div className="mt-3 space-y-1 text-[11px] w-full">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-gray-400">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> ใช้ไป
                    </span>
                    <span className="font-mono text-white">{(usedBytes / 1_048_576).toFixed(2)} MB</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-gray-400">
                      <span className="w-2.5 h-2.5 rounded-full bg-gray-600 inline-block" /> ว่าง
                    </span>
                    <span className="font-mono text-white">{(Math.max(0, quotaBytes - usedBytes) / 1_048_576).toFixed(2)} MB</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-gray-400">
                      <span className="w-2.5 h-2.5 rounded-full border border-gray-500 inline-block" /> ทั้งหมด
                    </span>
                    <span className="font-mono text-white">{(quotaBytes / 1_048_576).toFixed(2)} MB</span>
                  </div>
                </div>
              </div>

              {/* Summary Cards */}
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-gray-800 bg-navy-800/40 p-4">
                  <div className="text-[11px] text-gray-400">🖼️ รูปภาพทั้งหมดใน Storage</div>
                  <div className="text-2xl font-bold text-white mt-1">{allFiles.length.toLocaleString()}</div>
                </div>
                <div className="rounded-xl border border-gray-800 bg-navy-800/40 p-4">
                  <div className="text-[11px] text-gray-400">🗄️ พื้นที่ไฟล์รูปที่ใช้</div>
                  <div className="text-2xl font-bold text-white mt-1">{(totalImagesBytes / 1_048_576).toFixed(2)} <span className="text-sm font-normal text-gray-400">MB</span></div>
                </div>
                <div className="rounded-xl border border-gray-800 bg-navy-800/40 p-4">
                  <div className="text-[11px] text-gray-400">🗂️ Bucket ที่มีไฟล์</div>
                  <div className="text-2xl font-bold text-white mt-1">{activeBuckets.toLocaleString()}</div>
                </div>
              </div>
            </div>

            {/* ตารางรายโมดูล */}
            <div className="overflow-x-auto mt-6">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-2 py-2 text-gray-500 font-medium">โมดูล</th>
                    <th className="text-right px-2 py-2 text-gray-500 font-medium">จำนวนแถว</th>
                    <th className="text-right px-2 py-2 text-gray-500 font-medium">พื้นที่ DB</th>
                    <th className="text-right px-2 py-2 text-gray-500 font-medium">🖼️ รูปภาพ</th>
                    <th className="text-right px-2 py-2 text-gray-500 font-medium">ขนาดรูป</th>
                    <th className="text-left px-2 py-2 text-gray-500 font-medium min-w-[140px]">สัดส่วน</th>
                  </tr>
                </thead>
                <tbody>
                  {modules.map((m) => {
                    const pct = modulePct(m);
                    return (
                      <tr key={m.key} className="border-b border-gray-800/50">
                        <td className="px-2 py-2 text-white">
                          {m.statsLinked && <span title="เชื่อมสถิติ/คะแนน (ล็อก)">🔒 </span>}
                          {m.label}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-gray-300">
                          {m.stats ? m.stats.row_count.toLocaleString() : '0'}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-gray-300">
                          {m.stats ? fmtBytes(m.stats.db_bytes) : '-'}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-emerald-400">
                          {m.stats ? `${m.stats.db_ref_count.toLocaleString()} รูป` : '-'}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-blue-300">
                          {m.stats && m.stats.file_bytes > 0 ? fmtBytes(m.stats.file_bytes) : '-'}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-amber-300 w-12 text-right">{pct.toFixed(1)}%</span>
                            <div className="flex-1 h-2 bg-navy-800 rounded-full overflow-hidden min-w-[60px]">
                              <div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${Math.min(100, pct)}%` }} />
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!modules.some((m) => !m.valid) ? null : (
                    <tr>
                      <td colSpan={6} className="px-2 py-2 text-[10px] text-red-400/80">
                        ⚠️ บางโมดูลดึงข้อมูลไม่สำเร็จ: {modules.filter((m) => !m.valid).map((m) => m.label).join(', ')}
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-700 font-bold">
                    <td className="px-2 py-2 text-white">รวมทั้งหมด</td>
                    <td className="px-2 py-2 text-right font-mono text-gray-200">{totals.row_count.toLocaleString()}</td>
                    <td className="px-2 py-2 text-right font-mono text-gray-200">{fmtBytes(totals.db_bytes)}</td>
                    <td className="px-2 py-2 text-right font-mono text-emerald-300">{totals.db_ref_count.toLocaleString()} รูป</td>
                    <td className="px-2 py-2 text-right font-mono text-blue-300">{totals.file_bytes > 0 ? fmtBytes(totals.file_bytes) : '-'}</td>
                    <td className="px-2 py-2">
                      <span className="font-mono text-amber-300">{totalPct.toFixed(1)}%</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* ═══ B) Safe Cleanup & Quarantine ═══ */}
          <div className="card p-5">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
              <h2 className="text-sm font-bold text-white">เครื่องมือกักกันไฟล์กำพร้า (Safe Cleanup)</h2>
              <button
                onClick={() => void scanOrphans()}
                disabled={busy !== ''}
                className="btn btn-outline text-xs inline-flex items-center gap-1.5"
              >
                {busy === 'scan' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                สแกนไฟล์กำพร้า
              </button>
            </div>

            {msg && (
              <div className={`p-3 rounded-lg text-xs mb-4 ${msg.ok
                ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                : 'bg-red-500/10 text-red-300 border border-red-500/30'}`}>
                {msg.text}
              </div>
            )}

            {orphans && (
              orphans.length === 0 ? (
                <p className="text-xs text-gray-500">ไม่พบไฟล์กำพร้า — ไม่มีอะไรต้องกักกัน</p>
              ) : (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-amber-300 inline-flex items-center gap-1">
                      <AlertTriangle size={13} /> พบไฟล์กำพร้า {orphans.length} ไฟล์
                    </span>
                    <button
                      onClick={() => void quarantineOrphans()}
                      disabled={busy !== ''}
                      className="btn text-xs inline-flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                    >
                      {busy === 'quarantine' ? <Loader2 size={13} className="animate-spin" /> : <FolderInput size={13} />}
                      ย้ายเข้า /{QUARANTINE_PREFIX}
                    </button>
                  </div>
                  <div className="max-h-52 overflow-y-auto border border-gray-800 rounded-lg">
                    <table className="w-full text-[11px]">
                      <tbody>
                        {orphans.map((f) => (
                          <tr key={`${f.bucket_id}/${f.file_name}`} className="border-b border-gray-800/50">
                            <td className="px-2 py-1.5 text-gray-400">{f.bucket_id}</td>
                            <td className="px-2 py-1.5 text-gray-300 font-mono break-all">{f.file_name}</td>
                            <td className="px-2 py-1.5 text-right text-gray-500 font-mono whitespace-nowrap">{fmtBytes(f.file_size)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            )}

            {/* ไฟล์ในโฟลเดอร์กักกัน */}
            <div className="mt-4 border-t border-gray-800 pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400">
                  ไฟล์ในโฟลเดอร์กักกัน: <span className="text-white font-semibold">{quarantined.length}</span> ไฟล์
                  ({fmtBytes(quarantined.reduce((s, f) => s + f.file_size, 0))})
                </span>
                <button
                  onClick={() => void deleteQuarantined(quarantined)}
                  disabled={busy !== '' || quarantined.length === 0}
                  className="btn text-xs inline-flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                >
                  {busy === 'delete' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  ลบไฟล์ในกักกันทั้งหมด
                </button>
              </div>

              {quarantined.length > 0 && (
                <div className="max-h-52 overflow-y-auto border border-gray-800 rounded-lg">
                  <table className="w-full text-[11px]">
                    <tbody>
                      {quarantined.map((f) => (
                        <tr key={`${f.bucket_id}/${f.file_name}`} className="border-b border-gray-800/50">
                          <td className="px-2 py-1.5 text-gray-400">{f.bucket_id}</td>
                          <td className="px-2 py-1.5 text-gray-300 font-mono break-all">{f.file_name}</td>
                          <td className="px-2 py-1.5 text-right text-gray-500 font-mono whitespace-nowrap">{fmtBytes(f.file_size)}</td>
                          <td className="px-2 py-1.5 text-right">
                            <button
                              onClick={() => void deleteQuarantined([f])}
                              disabled={busy !== ''}
                              className="text-red-400 hover:text-red-300 disabled:opacity-40"
                              title="ลบเฉพาะไฟล์นี้ (ในกักกัน)"
                            >
                              <Trash2 size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="text-[10px] text-gray-500 mt-2">
                🔒 ปุ่มลบทำงานเฉพาะไฟล์ที่ขึ้นต้นด้วย <span className="font-mono text-gray-400">{QUARANTINE_PREFIX}</span> เท่านั้น
                — โฟลเดอร์โมดูลใช้งานจริงจะไม่ถูกแตะต้อง
              </p>
            </div>
          </div>

          {/* ═══ C) Data Protection Guard ═══ */}
          <div className="card p-5">
            <h2 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              {invalidModules.length === 0
                ? <ShieldCheck size={16} className="text-emerald-400" />
                : <ShieldAlert size={16} className="text-amber-400" />}
              การป้องกันข้อมูลรวน (Data Protection Guard)
            </h2>
            <ul className="text-xs text-gray-400 space-y-1">
              <li>• แต่ละโมดูลถูกดึงด้วย query แยกกัน (ไม่มี global loop / ไม่ดึงข้ามโมดูล)</li>
              <li>• ตรวจสอบ JSON response ก่อนเรนเดอร์ — หากว่างหรือผิดรูปจะแสดงค่า 0 หรือ -</li>
              <li>
                • สถานะ: {invalidModules.length === 0
                  ? <span className="text-emerald-400">ทุกโมดูลปกติ ({modules.length}/{modules.length})</span>
                  : <span className="text-red-400">ผิดรูป {invalidModules.length} โมดูล: {invalidModules.map((m) => m.label).join(', ')}</span>}
              </li>
            </ul>
          </div>

          {/* ═══ D) ระบบจัดการลบข้อมูล ═══ */}
          <div className="card p-5">
            <h2 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
              <Trash2 size={16} className="text-red-400" /> ระบบจัดการลบข้อมูล (Auto-Detect + ช่วงวันที่)
            </h2>
            <p className="text-[11px] text-gray-500 mb-4">
              เลือกโมดูลและช่วงวันที่ → ระบบตรวจหาไฟล์ใน Storage และจำนวนแถวใน DB ให้ก่อนลบ
            </p>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-xs text-gray-400 flex flex-col gap-1">
                โมดูล (Auto-Detect)
                <select
                  value={cleanModule}
                  onChange={(e) => { setCleanModule(e.target.value); setCleanPreview(null); setCleanMsg(null); }}
                  className="bg-navy-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white w-full"
                >
                  {modules.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.statsLinked ? '🔒 ' : ''}{m.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-gray-400 flex flex-col gap-1">
                วันที่เริ่ม
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => { setFromDate(e.target.value); setCleanPreview(null); }}
                  className="bg-navy-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white w-full"
                />
              </label>
              <label className="text-xs text-gray-400 flex flex-col gap-1">
                วันที่สิ้นสุด
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => { setToDate(e.target.value); setCleanPreview(null); }}
                  className="bg-navy-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white w-full"
                />
              </label>
            </div>

            {cleanLocked ? (
              <div className="mt-3 flex items-start gap-2 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                <ShieldAlert size={13} className="mt-0.5 flex-shrink-0" />
                <span>โมดูลนี้เชื่อมกับ<b>สถิติ/คะแนน</b> — ล็อกให้ลบได้เฉพาะ <b>ไฟล์รูปภาพ</b> เท่านั้น (ห้ามลบ Row หรือข้อความใน Database)</span>
              </div>
            ) : (
              <div className="mt-3 flex items-start gap-2 text-[11px] text-gray-400 bg-gray-500/10 border border-gray-600/30 rounded-lg px-3 py-2">
                <ShieldCheck size={13} className="mt-0.5 flex-shrink-0" />
                <span>โมดูลทั่วไป — เลือกได้ระหว่างลบเฉพาะรูปภาพ หรือลบทั้งหมด (Purge ข้อความ+รูป)</span>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-4">
              <label className="text-xs text-white inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="cleanmode"
                  checked={cleanMode === 'images'}
                  onChange={() => setCleanMode('images')}
                />
                ลบเฉพาะรูปภาพ (Image Storage Only)
              </label>
              <label className={`text-xs inline-flex items-center gap-2 ${cleanLocked ? 'text-gray-600' : 'text-white'}`}>
                <input
                  type="radio"
                  name="cleanmode"
                  disabled={cleanLocked}
                  checked={cleanMode === 'purge'}
                  onChange={() => setCleanMode('purge')}
                />
                ลบทั้งหมด (Purge ข้อความ + รูป) {cleanLocked && '🔒'}
              </label>
            </div>

            <button
              onClick={() => void detectCleanup()}
              disabled={cleanBusy !== '' || !cleanModule}
              className="btn btn-outline text-xs inline-flex items-center gap-1.5 mt-4"
            >
              {cleanBusy === 'detect' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              ตรวจหา (Auto-Detect)
            </button>

            {cleanPreview && (
              <div className="mt-4 border border-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-300 mb-2">
                  พบไฟล์ใน Storage <span className="text-white font-semibold">{cleanPreview.files.length}</span> ไฟล์
                  ({fmtBytes(cleanPreview.files.reduce((s, f) => s + f.file_size, 0))}) ·
                  แถวใน DB <span className="text-white font-semibold">{cleanPreview.rows}</span> แถว
                </div>

                {cleanPreview.files.length > 0 ? (
                  <div className="max-h-44 overflow-y-auto border border-gray-800 rounded-lg mb-3">
                    <table className="w-full text-[11px]">
                      <tbody>
                        {cleanPreview.files.map((f) => (
                          <tr key={`${f.bucket_id}/${f.file_name}`} className="border-b border-gray-800/50">
                            <td className="px-2 py-1.5 text-gray-400">{f.bucket_id}</td>
                            <td className="px-2 py-1.5 text-gray-300 font-mono break-all">{f.file_name}</td>
                            <td className="px-2 py-1.5 text-right text-gray-500 font-mono whitespace-nowrap">{fmtBytes(f.file_size)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-500 mb-3">ไม่พบไฟล์ใน Storage ตามเงื่อนไข</p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder='พิมพ์ "ลบ" เพื่อยืนยัน'
                    className="bg-navy-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white flex-1 min-w-[180px]"
                  />
                  <button
                    onClick={() => void runCleanup()}
                    disabled={cleanBusy !== '' || confirmText.trim() !== 'ลบ'}
                    className="btn text-xs inline-flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg disabled:opacity-40"
                  >
                    {cleanBusy === 'run' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    {cleanMode === 'purge' ? 'ลบทั้งหมดที่เลือก' : 'ลบไฟล์รูปภาพที่เลือก'}
                  </button>
                </div>
                <p className="text-[10px] text-gray-500 mt-2">
                  🔒 โหมดรูปภาพ = ลบเฉพาะไฟล์ใน Storage (ไม่แตะ Database) · โหมดลบทั้งหมด = ลบไฟล์ + ลบแถวใน DB ตามช่วงวันที่ (เฉพาะโมดูลทั่วไป)
                </p>
              </div>
            )}

            {cleanMsg && (
              <div className={`p-3 rounded-lg text-xs mt-4 ${cleanMsg.ok
                ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                : 'bg-red-500/10 text-red-300 border border-red-500/30'}`}>
                {cleanMsg.text}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
