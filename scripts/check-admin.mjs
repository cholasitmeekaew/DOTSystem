import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || 'https://lricjaiakrpsswvjgbgj.supabase.co';
const key = process.env.SUPABASE_ANON_KEY;
if (!key) { console.error('Set SUPABASE_ANON_KEY env var'); process.exit(1); }
const sb = createClient(url, key);

const { data, error } = await sb.from('officers').select('id, username, name, rank, status').eq('username', 'admin');
console.log('admin row:', JSON.stringify(data, null, 2));
if (error) console.error('error:', error.message);

const { data: all } = await sb.from('officers').select('username, name, rank');
console.log('all officers:', JSON.stringify(all, null, 2));
