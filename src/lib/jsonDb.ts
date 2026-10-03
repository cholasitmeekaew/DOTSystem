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

// ---------- rpc mocks ----------

type RpcResult = { data: unknown; error: PostgrestErrorLike | null };

function rpcError(message: string, code = 'PGRST202'): RpcResult {
  return { data: null, error: { message, code } };
}

function asArray<T = Row>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function numOr0(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function claimScopeOf(record: Row): 'default' | 'vehicle_rescue' {
  const rateId = record.service_rate_id;
  const rate = rateId ? ensureTable('service_rates').find((r) => r.id === rateId) : undefined;
  const raw = String(record.service_category ?? '').trim() || String(rate?.category ?? '').trim();
  return raw === 'vehicle_rescue' ? 'vehicle_rescue' : 'default';
}

/**
 * รายการเคสที่เจ้าหน้าที่คนหนึ่งมีสิทธิ์รับส่วนแบ่งในงวด/scope ที่ระบุ
 * (พอร์ตตรรกะจาก preview_claim_share / claim_service_share ใน migration 0009 + 0020)
 */
function claimCandidates(officerId: unknown, period: string, scope: string) {
  const records = ensureTable('service_records');
  const sro = ensureTable('service_record_officers');
  const overrides = ensureTable('service_record_revenue_overrides');
  const claims = ensureTable('claim_records');
  const cfg =
    ensureTable('revenue_sharing_config').find((c) => c.scope === scope) ??
    ensureTable('revenue_sharing_config').find((c) => c.scope === 'default');
  const pct = numOr0(cfg?.officer_share_percent) || 10;

  const candidates: Array<{ record: Row; share: number; assignedCount: number }> = [];
  for (const record of records) {
    if (record.status !== 'paid') continue;
    if (String(record.service_date ?? '').slice(0, 7) !== period) continue;
    if (claimScopeOf(record) !== scope) continue;

    const assigned = sro.filter((row) => row.service_record_id === record.id);
    const isAssigned = assigned.some((row) => row.officer_id === officerId);
    const isLegacyOwner = record.officer_id === officerId;
    if (!isAssigned && !isLegacyOwner) continue;

    const alreadyClaimed = claims.some(
      (c) =>
        c.service_record_id === record.id &&
        c.officer_id === officerId &&
        ['pending', 'approved', 'paid'].includes(String(c.status)),
    );
    if (alreadyClaimed) continue;

    const assignedCount = assigned.length || numOr0(record.assigned_officer_count) || 1;
    const override = overrides.find((o) => o.service_record_id === record.id);
    const overrideShare = numOr0(override?.officer_share);
    const share = overrideShare > 0
      ? round2(overrideShare / assignedCount)
      : round2((numOr0(record.amount) * pct) / 100 / assignedCount);
    candidates.push({ record, share, assignedCount });
  }
  return { candidates, pct };
}

function mockRpc(fn: string, params: Row): RpcResult {
  const nowIso = new Date().toISOString();

  switch (fn) {
    /* ---------- revenue sharing ---------- */
    case 'assign_record_officers': {
      const officers = ensureTable('officers');
      if (!officers.some((o) => o.id === params.p_assigned_by && o.status === 'active')) {
        return rpcError('Assigned by officer is not active', '42501');
      }
      if (!ensureTable('service_records').some((r) => r.id === params.p_record_id)) {
        return rpcError('Service record not found', 'P0002');
      }
      const officerIds = asArray<string>(params.p_officer_ids).filter((id) =>
        officers.some((o) => o.id === id && o.status === 'active'),
      );
      const d = db();
      d.service_record_officers = ensureTable('service_record_officers').filter(
        (row) => row.service_record_id !== params.p_record_id,
      );
      for (const officerId of officerIds) {
        d.service_record_officers.push({
          service_record_id: params.p_record_id,
          officer_id: officerId,
          assigned_at: nowIso,
          assigned_by: params.p_assigned_by ?? null,
        });
      }
      persist(d);
      notifyTable('service_record_officers');
      return { data: null, error: null };
    }

    case 'list_service_record_officers': {
      const ids = new Set(asArray<string>(params.p_record_ids));
      const rows = ensureTable('service_record_officers')
        .filter((row) => ids.has(String(row.service_record_id)))
        .map((row) => ({ service_record_id: row.service_record_id, officer_id: row.officer_id }));
      return { data: rows, error: null };
    }

    case 'calculate_service_revenue': {
      const record = ensureTable('service_records').find((r) => r.id === params.p_service_record_id);
      if (!record) return rpcError('Service record not found', 'P0002');
      const amount = numOr0(record.amount);
      const total = round2((amount * numOr0(params.p_officer_share_percent)) / 100);
      const count = ensureTable('service_record_officers').filter(
        (row) => row.service_record_id === record.id,
      ).length;
      record.officer_share = total;
      record.central_share = round2(amount - total);
      record.assigned_officer_count = count;
      record.updated_at = nowIso;
      persist(db());
      notifyTable('service_records');
      return { data: null, error: null };
    }

    /* ---------- payments ---------- */
    case 'record_service_payment': {
      if (params.p_officer_rank !== 'commissioner') {
        return rpcError('permission denied: commissioner rank required', '42501');
      }
      const amount = numOr0(params.p_amount);
      if (amount <= 0) return rpcError('invalid amount: must be greater than 0', '22023');
      const record = ensureTable('service_records').find((r) => r.id === params.p_service_record_id);
      if (!record) return rpcError('Service record not found', 'P0002');

      const payment: Row = {
        id: uid(),
        service_record_id: record.id,
        amount,
        recorded_by: params.p_officer_id ?? null,
        recorded_by_name: params.p_officer_name ?? null,
        notes: params.p_notes ?? null,
        created_at: nowIso,
        updated_at: nowIso,
      };
      ensureTable('service_payments').push(payment);

      const paidTotal = ensureTable('service_payments')
        .filter((p) => p.service_record_id === record.id)
        .reduce((sum, p) => sum + numOr0(p.amount), 0);
      record.paid_amount = round2(paidTotal);
      record.status = paidTotal >= numOr0(record.amount) ? 'paid' : 'unpaid';
      record.updated_at = nowIso;
      persist(db());
      notifyTable('service_payments');
      notifyTable('service_records');
      return { data: payment.id, error: null };
    }

    /* ---------- claim share ---------- */
    case 'preview_claim_share': {
      const period = String(params.p_period ?? '');
      const scope = String(params.p_scope ?? 'default');
      const { candidates, pct } = claimCandidates(params.p_officer_id, period, scope);
      let gross = 0;
      let total = 0;
      for (const c of candidates) {
        gross += numOr0(c.record.amount);
        total += c.share;
      }
      return {
        data: {
          scope,
          period,
          officer_share_percent: pct,
          record_count: candidates.length,
          gross_amount: round2(gross),
          per_officer_total: round2(total),
          records: candidates.map((c) => ({
            id: c.record.id,
            service_name: c.record.service_name,
            amount: numOr0(c.record.amount),
            assigned_count: c.assignedCount,
            per_officer_share: c.share,
          })),
        },
        error: null,
      };
    }

    case 'claim_service_share': {
      const period = String(params.p_period ?? '');
      const scope = String(params.p_scope ?? 'default');
      const { candidates, pct } = claimCandidates(params.p_officer_id, period, scope);
      const claimIds: string[] = [];
      let total = 0;
      for (const c of candidates) {
        const claimId = uid();
        ensureTable('claim_records').push({
          id: claimId,
          officer_id: params.p_officer_id,
          service_record_id: c.record.id,
          amount: c.share,
          scope,
          officer_share_percent: pct,
          claim_period: period,
          record_count: 1,
          status: 'pending',
          claimed_by: params.p_actor_id,
          note: params.p_note ?? null,
          created_at: nowIso,
        });
        claimIds.push(claimId);
        total += c.share;
      }
      persist(db());
      notifyTable('claim_records');
      return {
        data: {
          success: true,
          claim_ids: claimIds,
          record_count: claimIds.length,
          total_amount: round2(total),
        },
        error: null,
      };
    }

    case 'approve_claim': {
      const claim = ensureTable('claim_records').find((c) => c.id === params.p_claim_id);
      if (!claim) return rpcError('Claim not found', 'P0002');
      if (claim.status !== 'pending') {
        return rpcError(`Claim is not pending (current: ${String(claim.status)})`, 'P0001');
      }
      claim.status = 'approved';
      claim.approved_by = params.p_approver_id ?? null;
      claim.approved_at = nowIso;
      const officer = ensureTable('officers').find((o) => o.id === claim.officer_id);
      if (officer) officer.accumulated_share = round2(numOr0(officer.accumulated_share) + numOr0(claim.amount));
      persist(db());
      notifyTable('claim_records');
      notifyTable('officers');
      return { data: null, error: null };
    }

    case 'reject_claim': {
      const claim = ensureTable('claim_records').find((c) => c.id === params.p_claim_id);
      if (!claim) return rpcError('Claim not found', 'P0002');
      if (claim.status !== 'pending') {
        return rpcError(`Claim is not pending (current: ${String(claim.status)})`, 'P0001');
      }
      claim.status = 'rejected';
      claim.rejected_by = params.p_rejecter_id ?? null;
      claim.rejected_at = nowIso;
      claim.reject_reason = params.p_reason ?? null;
      persist(db());
      notifyTable('claim_records');
      return { data: null, error: null };
    }

    case 'mark_claim_paid': {
      const claim = ensureTable('claim_records').find((c) => c.id === params.p_claim_id);
      if (!claim) return rpcError('Claim not found', 'P0002');
      if (claim.status !== 'approved') {
        return rpcError(`Claim must be approved first (current: ${String(claim.status)})`, 'P0001');
      }
      claim.status = 'paid';
      claim.paid_by = params.p_payer_id ?? null;
      claim.paid_at = nowIso;
      const officer = ensureTable('officers').find((o) => o.id === claim.officer_id);
      if (officer) {
        officer.accumulated_share = Math.max(
          0,
          round2(numOr0(officer.accumulated_share) - numOr0(claim.amount)),
        );
      }
      persist(db());
      notifyTable('claim_records');
      notifyTable('officers');
      return { data: null, error: null };
    }

    case 'list_claims_for_officer': {
      const rows = ensureTable('claim_records')
        .filter((c) => c.officer_id === params.p_officer_id)
        .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
      return { data: rows, error: null };
    }

    case 'list_claims_for_commissioner': {
      const viewer = ensureTable('officers').find((o) => o.id === params.p_viewer_id);
      if (!viewer || viewer.rank !== 'commissioner' || viewer.status !== 'active') {
        return rpcError('Only commissioners can view claim approvals', '42501');
      }
      const rows = ensureTable('claim_records')
        .filter((c) => c.status === params.p_status)
        .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
      return { data: rows, error: null };
    }

    /* ---------- work reports ---------- */
    case 'create_work_report_with_cases': {
      const summary = String(params.p_summary ?? '');
      const report: Row = {
        id: uid(),
        officer_id: params.p_officer_id,
        officer_name: params.p_officer_name,
        duty_log_id: params.p_duty_log_id ?? null,
        report_text: summary,
        summary,
        duty_category: params.p_duty_category ?? null,
        created_at: nowIso,
        updated_at: nowIso,
      };
      ensureTable('work_reports').push(report);

      for (const item of asArray<Row>(params.p_cases)) {
        const caseName = String(item.case_name ?? '').trim();
        const details = String(item.details ?? '').trim();
        if (!caseName && !details) continue;
        ensureTable('work_report_cases').push({
          id: uid(),
          work_report_id: report.id,
          case_name: caseName || null,
          case_type: item.case_type ?? null,
          case_status: item.case_status || 'completed',
          citizen_username: item.citizen_username || null,
          citizen_id: item.citizen_id || null,
          details,
          evidence_url: item.evidence_url || null,
          created_at: nowIso,
          updated_at: nowIso,
        });
      }
      persist(db());
      notifyTable('work_reports');
      notifyTable('work_report_cases');
      return { data: report.id, error: null };
    }

    case 'get_work_report_cases': {
      const rows = ensureTable('work_report_cases')
        .filter((c) => c.work_report_id === params.p_work_report_id)
        .sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
      return { data: rows, error: null };
    }

    default:
      return rpcError(`function public.${fn} does not exist`);
  }
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
          case 'in':
            return Array.isArray(f.val) && f.val.includes(v);
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
  | { kind: 'upsert'; payload: Row | Row[] }
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
  private conflictColumns: string | null = null;

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
  in(col: string, val: unknown[]): JsonQuery { this.filters.push({ kind: 'in', col, val }); return this; }
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

  upsert(payload: Row | Row[], options?: { onConflict?: string }): JsonQuery {
    this.mode = { kind: 'upsert', payload };
    this.conflictColumns = options?.onConflict ?? null;
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

    if (this.mode.kind === 'upsert') {
      const items = Array.isArray(this.mode.payload) ? this.mode.payload : [this.mode.payload];
      const nowIso = new Date().toISOString();
      const conflictCols = (this.conflictColumns ?? 'id').split(',').map((c) => c.trim()).filter(Boolean);
      const result: Row[] = [];
      for (const item of items) {
        const existing = tableRows.find((row) => conflictCols.every((col) => row[col] === item[col]));
        if (existing) {
          Object.assign(existing, item);
          if ('updated_at' in existing && !('updated_at' in item)) existing.updated_at = nowIso;
          result.push(existing);
        } else {
          const inserted: Row = { id: uid(), created_at: nowIso, updated_at: nowIso, ...item };
          tableRows.push(inserted);
          result.push(inserted);
        }
      }
      if (!persist(d)) {
        return { data: null, error: { message: 'Storage quota exceeded — could not save data.' } };
      }
      notifyTable(this.table);
      return { data: result, error: null };
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

    async rpc(fn: string, params: Row = {}): Promise<RpcResult> {
      return mockRpc(fn, params ?? {});
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
