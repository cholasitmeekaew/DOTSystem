import { seedData, type JsonDb } from '../data/seed';

const DB_KEY = 'dot_system_db_v1';
const FILES_KEY = 'dot_system_files_v1';
const NOTIFY_KEY = 'dot_system_notify_v1';

type Row = Record<string, unknown>;
type PostgrestErrorLike = { message: string; code?: string };
type Result<T> = { data: T; error: PostgrestErrorLike | null; count?: number | null };

function uid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function loadDb(): JsonDb {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) return JSON.parse(raw) as JsonDb;
  } catch {
    // corrupted -> reseed
  }
  const fresh = JSON.parse(JSON.stringify(seedData)) as JsonDb;
  persist(fresh);
  return fresh;
}

function persist(db: JsonDb): boolean {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    return true;
  } catch {
    return false;
  }
}

let dbCache: JsonDb | null = null;

function db(): JsonDb {
  if (!dbCache) dbCache = loadDb();
  return dbCache;
}

function ensureTable(name: string): Row[] {
  const d = db();
  if (!d[name]) d[name] = [];
  return d[name];
}

// ---------- realtime bus ----------

type ChangeHandler = (payload: unknown) => void;
const tableSubs = new Map<string, Set<ChangeHandler>>();

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== NOTIFY_KEY || !e.newValue) return;
    try {
      const { table } = JSON.parse(e.newValue) as { table?: string };
      if (!table) return;
      dbCache = null;
      tableSubs.get(table)?.forEach((cb) => cb({ table }));
    } catch {
      // ignore
    }
  });
}

function notifyTable(table: string): void {
  try {
    localStorage.setItem(NOTIFY_KEY, JSON.stringify({ table, t: Date.now() }));
  } catch {
    // ignore
  }
  tableSubs.get(table)?.forEach((cb) => cb({ table }));
}

interface ChannelTarget {
  on(type: string, opts: { event?: string; schema?: string; table?: string; filter?: string }, cb: ChangeHandler): ChannelTarget;
  subscribe(statusCb?: (status: string) => void): MockChannel;
}

export interface MockChannel {
  topic: string;
  [key: string]: unknown;
}

class JsonChannel implements ChannelTarget {
  topic: string;
  private handlers: Array<{ table: string; cb: ChangeHandler }> = [];

  constructor(topic: string) {
    this.topic = topic;
  }

  on(_type: string, opts: { event?: string; schema?: string; table?: string; filter?: string }, cb: ChangeHandler): ChannelTarget {
    if (opts?.table) {
      const table = opts.table;
      if (!tableSubs.has(table)) tableSubs.set(table, new Set());
      const wrapped: ChangeHandler = (p) => cb(p);
      this.handlers.push({ table, cb: wrapped });
      tableSubs.get(table)!.add(wrapped);
    }
    return this;
  }

  subscribe(statusCb?: (status: string) => void): MockChannel {
    statusCb?.('SUBSCRIBED');
    const ch: MockChannel = { topic: this.topic, __handlers: this.handlers };
    return ch;
  }
}

// ---------- filters ----------

type OrderSpec = { column: string; ascending: boolean };

function ilikeMatch(value: unknown, pattern: string): boolean {
  if (value == null) return false;
  const escaped = String(pattern)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%/g, '.*')
    .replace(/_/g, '.');
  return new RegExp('^' + escaped + '$', 'i').test(String(value));
}

function applyFilters(rows: Row[], filters: Array<{ kind: string; col?: string; val?: unknown; expr?: string }>): Row[] {
  let out = rows;
  for (const f of filters) {
    if (f.kind === 'or') {
      const conds = (f.expr ?? '').split(',').map((c) => c.trim()).filter(Boolean).map((c) => {
        const i1 = c.indexOf('.');
        const i2 = c.indexOf('.', i1 + 1);
        return { col: c.slice(0, i1), op: c.slice(i1 + 1, i2), val: c.slice(i2 + 1) };
      });
      out = out.filter((row) =>
        conds.some(({ col, op, val }) => {
          const v = row[col];
          if (op === 'eq') return v === val;
          if (op === 'neq') return v !== val;
          if (op === 'ilike') return ilikeMatch(v, val);
          if (op === 'is') return val === 'null' ? v == null : v === val;
          return false;
        }),
      );
    } else {
      const col = f.col ?? '';
      out = out.filter((row) => {
        const v = row[col];
        switch (f.kind) {
          case 'eq':
            return v === f.val;
          case 'neq':
            return v !== f.val;
          case 'gte':
            return v != null && String(v) >= String(f.val);
          case 'gt':
            return v != null && String(v) > String(f.val);
          case 'lte':
            return v != null && String(v) <= String(f.val);
          case 'lt':
            return v != null && String(v) < String(f.val);
          case 'is':
            return f.val == null ? v == null : v === f.val;
          case 'ilike':
            return ilikeMatch(v, String(f.val));
          default:
            return true;
        }
      });
    }
  }
  return out;
}

function applyOrders(rows: Row[], orders: OrderSpec[]): Row[] {
  let out = [...rows];
  for (const o of [...orders].reverse()) {
    out = out.sort((a, b) => {
      const av = a[o.column];
      const bv = b[o.column];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else cmp = String(av).localeCompare(String(bv));
      return o.ascending ? cmp : -cmp;
    });
  }
  return out;
}

// ---------- query builder ----------

type Mode =
  | { kind: 'select' }
  | { kind: 'insert'; payload: Row | Row[] }
  | { kind: 'update'; payload: Row }
  | { kind: 'delete' };

class JsonQuery {
  private table: string;
  private mode: Mode = { kind: 'select' };
  private columns: string | null = null;
  private countOpt: 'exact' | 'planned' | 'estimated' | null = null;
  private headOpt = false;
  private filters: Array<{ kind: string; col?: string; val?: unknown; expr?: string }> = [];
  private orders: OrderSpec[] = [];
  private maxLimit: number | null = null;

  constructor(table: string) {
    this.table = table;
  }

  select(columns?: string, options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }): JsonQuery {
    this.columns = columns ?? '*';
    this.countOpt = options?.count ?? null;
    this.headOpt = options?.head ?? false;
    return this;
  }

  eq(col: string, val: unknown): JsonQuery { this.filters.push({ kind: 'eq', col, val }); return this; }
  neq(col: string, val: unknown): JsonQuery { this.filters.push({ kind: 'neq', col, val }); return this; }
  gt(col: string, val: unknown): JsonQuery { this.filters.push({ kind: 'gt', col, val }); return this; }
  gte(col: string, val: unknown): JsonQuery { this.filters.push({ kind: 'gte', col, val }); return this; }
  lt(col: string, val: unknown): JsonQuery { this.filters.push({ kind: 'lt', col, val }); return this; }
  lte(col: string, val: unknown): JsonQuery { this.filters.push({ kind: 'lte', col, val }); return this; }
  like(col: string, val: string): JsonQuery { this.filters.push({ kind: 'ilike', col, val }); return this; }
  ilike(col: string, val: string): JsonQuery { this.filters.push({ kind: 'ilike', col, val }); return this; }
  is(col: string, val: unknown): JsonQuery { this.filters.push({ kind: 'is', col, val }); return this; }
  or(expr: string): JsonQuery { this.filters.push({ kind: 'or', expr }); return this; }

  order(column: string, options?: { ascending?: boolean }): JsonQuery {
    this.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(n: number): JsonQuery {
    this.maxLimit = n;
    return this;
  }

  insert(payload: Row | Row[]): JsonQuery {
    this.mode = { kind: 'insert', payload };
    return this;
  }

  update(payload: Row): JsonQuery {
    this.mode = { kind: 'update', payload };
    return this;
  }

  delete(): JsonQuery {
    this.mode = { kind: 'delete' };
    return this;
  }

  maybeSingle(): PromiseLike<Result<Row | null>> {
    return {
      then: <R1, R2>(
        res?: ((r: Result<Row | null>) => R1 | PromiseLike<R1>) | undefined,
        rej?: ((e: unknown) => R2 | PromiseLike<R2>) | undefined,
      ) =>
        this.execute().then(
          (r) => (res ? res({ ...r, data: (Array.isArray(r.data) && r.data.length > 0 ? r.data[0] : null) as Row | null }) : (r as unknown as R1)),
          rej,
        ),
    };
  }

  single(): PromiseLike<Result<Row>> {
    return {
      then: <R1, R2>(
        res?: ((r: Result<Row>) => R1 | PromiseLike<R1>) | undefined,
        rej?: ((e: unknown) => R2 | PromiseLike<R2>) | undefined,
      ) =>
        this.execute().then(
          (r) => {
            if (Array.isArray(r.data) && r.data.length > 0) {
              return res ? res({ ...r, data: r.data[0] as Row }) : (r as unknown as R1);
            }
            const err: Result<Row> = { data: null as unknown as Row, error: { message: 'No rows found', code: 'PGRST116' } };
            return res ? res(err) : (err as unknown as R1);
          },
          rej,
        ),
    };
  }

  async execute(): Promise<Result<Row[] | null>> {
    const d = db();
    const tableRows = ensureTable(this.table);

    if (this.mode.kind === 'insert') {
      const items = Array.isArray(this.mode.payload) ? this.mode.payload : [this.mode.payload];
      const nowIso = new Date().toISOString();
      const inserted: Row[] = items.map((item) => ({
        id: uid(),
        created_at: nowIso,
        updated_at: nowIso,
        ...item,
      }));
      tableRows.push(...inserted);
      if (!persist(d)) {
        return { data: null, error: { message: 'Storage quota exceeded — could not save data.' } };
      }
      notifyTable(this.table);
      return { data: inserted, error: null };
    }

    const filtered = applyFilters(tableRows, this.filters);

    if (this.mode.kind === 'update') {
      const nowIso = new Date().toISOString();
      for (const row of filtered) {
        Object.assign(row, this.mode.payload);
        if ('updated_at' in row && !('updated_at' in this.mode.payload)) row.updated_at = nowIso;
      }
      if (!persist(d)) {
        return { data: null, error: { message: 'Storage quota exceeded — could not save data.' } };
      }
      notifyTable(this.table);
      return { data: null, error: null };
    }

    if (this.mode.kind === 'delete') {
      const ids = new Set(filtered.map((r) => r.id));
      d[this.table] = tableRows.filter((r) => !ids.has(r.id));
      if (!persist(d)) {
        return { data: null, error: { message: 'Storage quota exceeded — could not save data.' } };
      }
      notifyTable(this.table);
      return { data: null, error: null };
    }

    const countVal = this.countOpt === 'exact' ? filtered.length : null;
    let rows = applyOrders(filtered, this.orders);
    if (this.maxLimit != null) rows = rows.slice(0, this.maxLimit);

    if (this.headOpt) {
      return { data: null, error: null, count: countVal };
    }

    if (this.columns && this.columns !== '*' && !this.columns.includes(',')) {
      const col = this.columns.trim();
      rows = rows.map((r) => ({ [col]: r[col] }));
    }

    return { data: rows, error: null, count: countVal };
  }

  then<R1, R2>(
    res?: ((r: Result<Row[] | null>) => R1 | PromiseLike<R1>) | undefined,
    rej?: ((e: unknown) => R2 | PromiseLike<R2>) | undefined,
  ): PromiseLike<R1 | R2> {
    return this.execute().then(res, rej);
  }
}

// ---------- storage mock ----------

type FileMap = Record<string, string>;

function loadFiles(): FileMap {
  try {
    const raw = localStorage.getItem(FILES_KEY);
    if (raw) return JSON.parse(raw) as FileMap;
  } catch {
    // ignore
  }
  return {};
}

function saveFiles(files: FileMap): boolean {
  try {
    localStorage.setItem(FILES_KEY, JSON.stringify(files));
    return true;
  } catch {
    return false;
  }
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createJsonSupabaseClient(): any {
  return {
    __jsonDbMode: true,

    from(table: string): JsonQuery {
      return new JsonQuery(table);
    },

    channel(topic: string): JsonChannel {
      return new JsonChannel(topic);
    },

    removeChannel(ch: MockChannel): void {
      const handlers = ch?.__handlers as Array<{ table: string; cb: ChangeHandler }> | undefined;
      if (!handlers) return;
      for (const h of handlers) {
        tableSubs.get(h.table)?.delete(h.cb);
      }
    },

    removeAllChannels(): void {
      tableSubs.clear();
    },

    storage: {
      from(_bucket: string) {
        return {
          async upload(path: string, file: Blob): Promise<{ data: { path: string } | null; error: PostgrestErrorLike | null }> {
            try {
              const dataUrl = await fileToDataUrl(file);
              if (dataUrl.length > 2_000_000) {
                return { data: null, error: { message: 'ไฟล์ใหญ่เกิน 2MB สำหรับโหมดข้อมูลจำลอง' } };
              }
              const files = loadFiles();
              files[path] = dataUrl;
              if (!saveFiles(files)) {
                return { data: null, error: { message: 'พื้นที่จัดเก็บเต็ม — ไม่สามารถบันทึกไฟล์ได้' } };
              }
              return { data: { path }, error: null };
            } catch (e) {
              return { data: null, error: { message: e instanceof Error ? e.message : 'Upload failed' } };
            }
          },
          getPublicUrl(path: string): { data: { publicUrl: string } } {
            const files = loadFiles();
            return { data: { publicUrl: files[path] ?? '' } };
          },
          async remove(paths: string[]): Promise<{ data: unknown; error: PostgrestErrorLike | null }> {
            const files = loadFiles();
            for (const p of paths) delete files[p];
            saveFiles(files);
            return { data: paths, error: null };
          },
        };
      },
    },
  };
}

// ---------- backup / restore ----------

export function jsonDbExport(): void {
  const payload = { exportedAt: new Date().toISOString(), db: db(), files: loadFiles() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dot-system-db-backup.json';
  a.click();
  URL.revokeObjectURL(url);
}

export async function jsonDbImport(file: File): Promise<{ ok: boolean; message: string }> {
  try {
    const parsed = JSON.parse(await file.text()) as { db?: JsonDb; files?: FileMap };
    const next = parsed.db ?? (parsed as unknown as JsonDb);
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      return { ok: false, message: 'รูปแบบไฟล์ไม่ถูกต้อง' };
    }
    dbCache = next;
    if (!persist(next)) return { ok: false, message: 'พื้นที่จัดเก็บเต็ม' };
    if (parsed.files) saveFiles(parsed.files);
    return { ok: true, message: 'นำเข้าข้อมูลสำเร็จ' };
  } catch {
    return { ok: false, message: 'อ่านไฟล์ไม่สำเร็จ' };
  }
}

export function jsonDbReset(): void {
  dbCache = JSON.parse(JSON.stringify(seedData)) as JsonDb;
  persist(dbCache);
}
