import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const BIT_MARKER = '[BIT_DB_IMPORT]';

function loadEnv() {
  const env = {};
  try {
    const raw = readFileSync('.env', 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
  } catch {
    // fall through to process.env
  }
  return { ...env, ...process.env };
}

function stripBitBlock(notes) {
  const text = String(notes ?? '').trim();
  if (!text.includes(BIT_MARKER)) return text || null;
  const cleaned = text
    .split(/\r?\n\r?\n/)
    .filter((block) => !block.includes(BIT_MARKER))
    .join('\n\n')
    .trim();
  return cleaned || null;
}

async function fetchAll(supabase, table) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select('id,notes')
      .not('notes', 'is', null)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const tables = process.argv.includes('--all-tables') ? ['citizens', 'vehicles', 'licenses'] : ['citizens'];
  const env = loadEnv();
  const supabaseUrl = env.VITE_SUPABASE_URL;
  const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const summary = {};
  for (const table of tables) {
    const rows = await fetchAll(supabase, table);
    const changed = rows
      .map((row) => ({ id: row.id, notes: stripBitBlock(row.notes), oldNotes: row.notes }))
      .filter((row) => row.notes !== row.oldNotes);

    if (apply) {
      for (const row of changed) {
        const { error } = await supabase
          .from(table)
          .update({ notes: row.notes, updated_at: new Date().toISOString() })
          .eq('id', row.id);
        if (error) throw new Error(`${table} update ${row.id}: ${error.message}`);
      }
    }

    summary[table] = {
      scanned: rows.length,
      stripped: changed.length,
    };
  }

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', tables, summary }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
