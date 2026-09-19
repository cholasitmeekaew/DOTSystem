import { supabase } from './supabase';

// Bucket ต้องตรงกับ supabase/migrations/0004_storage.sql (+ 0024_storage_announcements_fix.sql)
// เดิมใช้ 'dot-uploads' ซึ่งไม่มีอยู่จริง ทำให้ทุกอัปโหลดล้มเหลวแบบเงียบ ๆ
const BUCKET_BY_FOLDER = {
  announcements: 'announcements',
  officers: 'officer-photos',
  evidence: 'evidence',
  vehicles: 'vehicles',
} as const;

type Folder = keyof typeof BUCKET_BY_FOLDER;

function generateFileName(prefix: string, file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}/${timestamp}-${random}.${ext}`;
}

export async function uploadImage(
  file: File,
  folder: Folder,
): Promise<string | null> {
  const bucket = BUCKET_BY_FOLDER[folder];
  const filePath = generateFileName(folder, file);
  const { error } = await supabase.storage
    .from(bucket)
    .upload(filePath, file, { cacheControl: '3600', upsert: false });

  if (error) {
    console.error('Upload error:', error.message);
    return null;
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
  return data.publicUrl;
}

export function deleteImage(url: string): void {
  try {
    for (const bucket of Object.values(BUCKET_BY_FOLDER)) {
      const parts = url.split(`/object/public/${bucket}/`);
      if (parts.length === 2) {
        supabase.storage.from(bucket).remove([parts[1]]);
        return;
      }
    }
    // fallback เผื่อ URL เก่าจาก bucket เดิม dot-uploads
    const legacy = url.split('/object/public/dot-uploads/');
    if (legacy.length === 2) {
      supabase.storage.from('dot-uploads').remove([legacy[1]]);
    }
  } catch {
    // best-effort cleanup
  }
}
