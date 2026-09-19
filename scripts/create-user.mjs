import { createClient } from '@supabase/supabase-js';

const url = 'https://lricjaiakrpswsvjgbgj.supabase.co';
const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyaWNqYWlha3Jwc3dzdmpnYmdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MzU5OTEsImV4cCI6MjEwMzQxMTk5MX0.q3GsWtv5TdxgA1c-E0Ebr0v9WvJwKOJdGiFt-wXwjB4';

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
