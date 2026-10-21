import { supabase } from './supabase';

// Bucket ต้องตรงกับ supabase/migrations/0004_storage.sql (+ 0024_storage_announcements_fix.sql)
// เดิมใช้ 'dot-uploads' ซึ่งไม่มีอยู่จริง ทำให้ทุกอัปโหลดล้มเหลวแบบเงียบ ๆ
const BUCKET_BY_FOLDER = {
  announcements: 'announcements',
  officers: 'officer-photos',
  evidence: 'evidence',
  vehicles: 'vehicles',
  manual: 'manual',
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

/**
 * แยก URL รูป → { bucket, path }
 * รูปแบบ: .../storage/v1/object/public/<bucket>/<path>
 */
function parseImageUrl(url: string): { bucket: string; path: string } | null {
  const m = url.match(/\/object\/public\/([^/?]+)\/([^?]+)/);
  if (!m) return null;
  return { bucket: m[1], path: m[2] };
}

/**
 * ลบไฟล์รูป 1 ไฟล์ — await จริง + ตรวจ error
 * คืน true เมื่อลบสำเร็จ, false เมื่อล้มเหลว/URL ไม่ใช่ storage
 *
 * NOTE: เดิมเป็น fire-and-forget ไม่รอผล ทำให้ไฟล์ไม่ถูกลบจริง
 *       แล้วเกิดไฟล์กำพร้าใน bucket (กินพื้นที่ฟรี)
 */
export async function deleteImage(url: string): Promise<boolean> {
  const parsed = parseImageUrl(url);
  if (!parsed) return false;
  try {
    const { error } = await supabase.storage.from(parsed.bucket).remove([parsed.path]);
    if (error) {
      console.error('Delete image error:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('Delete image exception:', e);
    return false;
  }
}

/**
 * ลบหลายไฟล์พร้อมกัน — จัดกลุ่มตาม bucket แล้วลบทีละชุด
 * คืนจำนวนที่ลบสำเร็จ / ล้มเหลว
 */
export async function deleteImages(urls: string[]): Promise<{ deleted: number; failed: number }> {
  const byBucket = new Map<string, string[]>();
  for (const u of urls) {
    const parsed = parseImageUrl(u);
    if (!parsed) continue;
    const arr = byBucket.get(parsed.bucket) ?? [];
    arr.push(parsed.path);
    byBucket.set(parsed.bucket, arr);
  }

  let deleted = 0;
  let failed = 0;
  for (const [bucket, paths] of byBucket) {
    // แบ่งชุดละ 100 กัน request ใหญ่เกิน
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error } = await supabase.storage.from(bucket).remove(chunk);
      if (error) { failed += chunk.length; console.error('Delete images error:', error.message); }
      else deleted += chunk.length;
    }
  }
  return { deleted, failed };
}

/** ลบไฟล์กำพร้าตามรายการ (bucket_id + name) */
export async function deleteOrphanFiles(
  files: Array<{ bucket_id: string; name: string }>,
): Promise<{ deleted: number; failed: number }> {
  const byBucket = new Map<string, string[]>();
  for (const f of files) {
    const arr = byBucket.get(f.bucket_id) ?? [];
    arr.push(f.name);
    byBucket.set(f.bucket_id, arr);
  }

  let deleted = 0;
  let failed = 0;
  for (const [bucket, names] of byBucket) {
    for (let i = 0; i < names.length; i += 100) {
      const chunk = names.slice(i, i + 100);
      const { error } = await supabase.storage.from(bucket).remove(chunk);
      if (error) { failed += chunk.length; console.error('Delete orphans error:', error.message); }
      else deleted += chunk.length;
    }
  }
  return { deleted, failed };
}
