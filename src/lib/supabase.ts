import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createJsonSupabaseClient } from './jsonDb';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export type DBMode = 'json' | 'supabase';

const hasSupabaseEnv = Boolean(supabaseUrl && supabaseAnonKey);
const useMock = import.meta.env.VITE_USE_MOCK === 'true';

export const dbMode: DBMode = hasSupabaseEnv && !useMock ? 'supabase' : 'json';

export const isJsonMode = dbMode === 'json';

export const supabase: SupabaseClient | ReturnType<typeof createJsonSupabaseClient> =
  dbMode === 'supabase'
    ? createClient(supabaseUrl!, supabaseAnonKey!, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    : createJsonSupabaseClient();
