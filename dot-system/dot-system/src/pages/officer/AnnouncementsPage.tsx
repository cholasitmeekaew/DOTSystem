import { useEffect, useState } from 'react';
import { Plus, Pin, Edit2, Trash2, Megaphone, X, Image as ImageIcon } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { uploadImage, deleteImage } from '../../lib/storage';
import { Announcement } from '../../lib/types';
import { useAuth } from '../../lib/AuthContext';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';

export function AnnouncementsPage() {
  const { officer } = useAuth();
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<Announcement | null>(null);
  const [deleteItem, setDeleteItem] = useState<Announcement | null>(null);
  const [form, setForm] = useState({ title: '', content: '', is_pinned: false });
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    const { data } = await supabase
      .from('announcements')
      .select('*')
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });
    setItems(data ?? []);
    setLoading(false);
  }

  function openAdd() {
    setEditItem(null);
    setForm({ title: '', content: '', is_pinned: false });
    setImagePreview(null);
    setImageFile(null);
    setShowForm(true);
  }

  function openEdit(item: Announcement) {
    setEditItem(item);
    setForm({ title: item.title, content: item.content, is_pinned: item.is_pinned });
    setImagePreview(item.image_url ?? null);
    setImageFile(null);
    setShowForm(true);
  }

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!officer) return;
    setUploading(true);

    let imageUrl = editItem?.image_url ?? null;
    if (imageFile) {
      const uploaded = await uploadImage(imageFile, 'announcements');
      if (uploaded) {
        if (editItem?.image_url) deleteImage(editItem.image_url);
        imageUrl = uploaded;
      }
    } else if (!imagePreview && editItem?.image_url) {
      deleteImage(editItem.image_url);
      imageUrl = null;
    }

    const payload = {
      title: form.title,
      content: form.content,
      image_url: imageUrl,
      is_pinned: form.is_pinned,
      created_by: officer.id,
      created_by_name: officer.name,
      updated_at: new Date().toISOString(),
    };

    if (editItem) {
      await supabase.from('announcements').update(payload).eq('id', editItem.id);
    } else {
      await supabase.from('announcements').insert({ ...payload, created_at: new Date().toISOString() });
    }
    setUploading(false);
    setShowForm(false);
    setEditItem(null);
    setImagePreview(null);
    setImageFile(null);
    setForm({ title: '', content: '', is_pinned: false });
    await fetchAll();
  }

  async function handleDelete() {
    if (!deleteItem) return;
    if (deleteItem.image_url) deleteImage(deleteItem.image_url);
    await supabase.from('announcements').delete().eq('id', deleteItem.id);
    setDeleteItem(null);
    await fetchAll();
  }

  async function togglePin(item: Announcement) {
    await supabase.from('announcements').update({ is_pinned: !item.is_pinned, updated_at: new Date().toISOString() }).eq('id', item.id);
    await fetchAll();
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div>
      <PageHeader
        icon={<Megaphone size={26} />}
        title="ประกาศ"
        subtitle="จัดการประกาศและข่าวสาร พร้อมรูปภาพประกอบ"
        actions={
          <button onClick={openAdd} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> สร้างประกาศ
          </button>
        }
      />

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-5 animate-pulse">
              <div className="h-4 bg-navy-600 rounded w-1/3 mb-3" />
              <div className="h-3 bg-navy-600 rounded w-full mb-2" />
              <div className="h-3 bg-navy-600 rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card p-16 text-center">
          <Megaphone size={40} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">ยังไม่มีประกาศ</p>
        </div>
      ) : (
        <div className="section-panel">
          <div className="section-bar">
            <span className="section-bar-icon"><Megaphone size={14} /></span>
            <span className="section-bar-title">รายการประกาศ</span>
          </div>
          <div className="space-y-3 p-4">
          {items.map((item) => (
            <div key={item.id} className={`card overflow-hidden relative ${item.is_pinned ? 'border-amber-500/15' : ''}`}>
              <span className="ph-corner ph-corner-tl" aria-hidden />
              <span className="ph-corner ph-corner-br" aria-hidden />
              {item.image_url && (
                <div className="w-full bg-navy-900">
                  <img src={item.image_url} alt={item.title} className="w-full h-auto object-contain max-h-96" />
                </div>
              )}
              <div className="p-5">
                <div className="flex items-start gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    item.is_pinned ? 'bg-amber-500/20' : 'bg-blue-900/40'
                  }`}>
                    <Megaphone size={18} className={item.is_pinned ? 'text-amber-400' : 'text-blue-400'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {item.is_pinned && (
                        <span className="text-[10px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded">ปักหมุด</span>
                      )}
                      <span className="text-xs text-gray-500">{formatDate(item.created_at)}</span>
                      <span className="text-xs text-gray-600">• โดย {item.created_by_name}</span>
                    </div>
                    <h3 className="text-white font-semibold mb-1">{item.title}</h3>
                    <p className="text-gray-400 text-sm whitespace-pre-wrap">{item.content}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => togglePin(item)}
                      title={item.is_pinned ? 'ยกเลิกปักหมุด' : 'ปักหมุด'}
                      className={`p-2 rounded-lg transition-colors ${item.is_pinned ? 'text-amber-400 bg-amber-500/10' : 'text-gray-600 hover:text-amber-400 hover:bg-amber-500/10'}`}
                    >
                      <Pin size={15} />
                    </button>
                    <button onClick={() => openEdit(item)} className="p-2 rounded-lg text-gray-600 hover:text-blue-400 hover:bg-blue-500/10 transition-colors">
                      <Edit2 size={15} />
                    </button>
                    <button onClick={() => setDeleteItem(item)} className="p-2 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
          </div>
        </div>
      )}

      {showForm && (
        <Modal
          title={editItem ? 'แก้ไขประกาศ' : 'สร้างประกาศใหม่'}
          onClose={() => { setShowForm(false); setEditItem(null); setImagePreview(null); setImageFile(null); }}
          size="lg"
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">หัวข้อประกาศ *</label>
              <input required className="input-field" placeholder="หัวข้อ..." value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">เนื้อหา *</label>
              <textarea required className="input-field" rows={6} placeholder="เนื้อหาประกาศ (พิมพ์ขึ้นบรรทัดใหม่ได้)..." value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
            </div>

            {/* Image Upload */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">รูปภาพประกอบ</label>
              {imagePreview ? (
                <div className="relative group">
                  <img src={imagePreview} alt="preview" className="w-full max-h-56 object-contain rounded-lg border border-blue-900/50 bg-navy-900" />
                  <button
                    type="button"
                    onClick={() => { setImagePreview(null); setImageFile(null); }}
                    className="absolute top-2 right-2 w-7 h-7 bg-red-600 rounded-lg flex items-center justify-center opacity-90 hover:opacity-100"
                  >
                    <X size={16} className="text-white" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center gap-2 py-8 border-2 border-dashed border-blue-900/50 rounded-lg cursor-pointer hover:border-amber-500/40 hover:bg-navy-700/30 transition-all">
                  <ImageIcon size={28} className="text-gray-600" />
                  <span className="text-xs text-gray-500">คลิกเพื่อเลือกรูปภาพ</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
                </label>
              )}
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <div className={`w-10 h-5 rounded-full transition-colors relative ${form.is_pinned ? 'bg-amber-500' : 'bg-navy-600'}`}>
                <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.is_pinned ? 'translate-x-5' : ''}`} />
              </div>
              <span className="text-sm text-gray-300">ปักหมุดประกาศ (แสดงบนสุดเสมอ)</span>
              <input type="checkbox" className="hidden" checked={form.is_pinned} onChange={(e) => setForm({ ...form, is_pinned: e.target.checked })} />
            </label>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => { setShowForm(false); setEditItem(null); setImagePreview(null); setImageFile(null); }} className="btn-secondary flex-1">ยกเลิก</button>
              <button type="submit" disabled={uploading} className="btn-primary flex-1 disabled:opacity-50">
                {uploading ? 'กำลังอัปโหลด...' : editItem ? 'บันทึก' : 'สร้างประกาศ'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteItem && (
        <ConfirmDialog
          title="ลบประกาศ"
          message={`ต้องการลบประกาศ "${deleteItem.title}" ใช่หรือไม่?`}
          confirmLabel="ลบ"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteItem(null)}
        />
      )}
    </div>
  );
}
