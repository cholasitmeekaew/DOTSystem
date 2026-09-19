import { createJsonSupabaseClient } from './jsonDb';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export type DBMode = 'json' | 'supabase';

export const dbMode: DBMode = supabaseUrl && supabaseAnonKey
  ? 'supabase'
  : 'json';

export const isJsonMode = dbMode === 'json';

export const supabase = createJsonSupabaseClient();
