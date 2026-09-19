import { createClient } from '@supabase/supabase-js';

const url = 'https://lricjaiakrpswsvjgbgj.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyaWNqYWlha3Jwc3dzdmpnYmdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MzU5OTEsImV4cCI6MjEwMzQxMTk5MX0.q3GsWtv5TdxgA1c-E0Ebr0v9WvJwKOJdGiFt-wXwjB4';
const sb = createClient(url, key);

const { data, error } = await sb.from('officers').select('id, username, name, rank, status').eq('username', 'admin');
console.log('admin row:', JSON.stringify(data, null, 2));
if (error) console.error('error:', error.message);

const { data: all } = await sb.from('officers').select('username, name, rank');
console.log('all officers:', JSON.stringify(all, null, 2));
