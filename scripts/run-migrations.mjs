import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
if (!url || !serviceKey) {
  console.error('Need SUPABASE_URL and SUPABASE_SERVICE_KEY env vars');
  process.exit(1);
}

const sb = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const migDir = 'supabase/migrations';
const files = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
console.log(`Found ${files.length} migration files:`, files);

for (const f of files) {
  const sql = readFileSync(join(migDir, f), 'utf8');
  console.log(`\n=== Running ${f} (${sql.length} chars) ===`);
  // Run via PostgREST rpc — but Supabase doesn't expose raw SQL via REST.
  // We use the SQL Editor endpoint instead.
  const r = await fetch(`${url}/pg/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ query: sql }),
  }).catch((e) => ({ ok: false, status: 0, _err: e.message }));
  if (r.ok) {
    console.log(`  OK ${r.status}`);
  } else {
    console.log(`  FAIL status=${r.status} err=${r._err || await r.text().catch(() => '?')}`);
  }
}

console.log('\n=== Verifying schema ===');
const tables = ['officers', 'citizens', 'vehicles', 'system_settings', 'officer_ranks'];
for (const t of tables) {
  const { error } = await sb.from(t).select('*').limit(1);
  if (error) console.log(`  ${t}: MISSING (${error.message})`);
  else console.log(`  ${t}: OK`);
}

const { data: admin } = await sb.from('officers').select('username, name, rank, status').eq('username', 'admin');
console.log('\nadmin user:', JSON.stringify(admin, null, 2));
