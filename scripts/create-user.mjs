import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL || 'https://lricjaiakrpsswvjgbgj.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!key) { console.error('Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY env var'); process.exit(1); }

const supabase = createClient(url, key, {
  auth: { autoConfirmUser: true, persistSession: false },
});

const { data, error } = await supabase.auth.admin.createUser({
  email: 'admin@dot.local',
  password: 'admin1234',
  email_confirm: true,
  user_metadata: { username: 'admin', rank: 'commissioner' },
}).catch((e) => ({ data: null, error: e }));

if (error) {
  console.error('ADMIN API ERROR:', error.message);
  console.log('Falling back to signUp...');
  const r = await supabase.auth.signUp({
    email: 'admin@dot.local',
    password: 'admin1234',
    options: { data: { username: 'admin', rank: 'commissioner' } },
  });
  if (r.error) {
    console.error('SIGNUP ERROR:', r.error.message);
    process.exit(1);
  }
  console.log('OK via signUp:', r.data.user?.id, r.data.user?.email);
} else {
  console.log('OK via admin:', data.user?.id, data.user?.email);
}
