import { supabase } from './supabase';

const BUCKET = 'dot-uploads';

function generateFileName(prefix: string, file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}/${timestamp}-${random}.${ext}`;
}

export async function uploadImage(
  file: File,
  folder: 'announcements' | 'officers' | 'evidence' | 'vehicles'
): Promise<string | null> {
  const filePath = generateFileName(folder, file);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, file, { cacheControl: '3600', upsert: false });

  if (error) {
    console.error('Upload error:', error.message);
    return null;
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
}

export function deleteImage(url: string): void {
  try {
    const parts = url.split(`/object/public/${BUCKET}/`);
    if (parts.length === 2) {
      supabase.storage.from(BUCKET).remove([parts[1]]);
    }
  } catch {
    // best-effort cleanup
  }
}
