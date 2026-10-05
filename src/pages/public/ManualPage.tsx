import { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, List, ChevronUp, ExternalLink, Plus, Trash2 } from 'lucide-react';
import { manualChapters } from '../../data/manualContent';
import { citizenManualChapters } from '../../data/citizenManualContent';
import { supabase } from '../../lib/supabase';
import { uploadImage, deleteImage } from '../../lib/storage';
import { useAuth } from '../../lib/AuthContext';
import { Modal, ConfirmDialog } from '../../components/Modal';

interface ManualItem {
  id: string;
  variant: 'officer' | 'citizen';
  title: string;
  content: string;
  image_url: string | null;
  created_by_name: string | null;
  created_at: string;
}

interface Props {
  onBack?: () => void;
  showBackButton?: boolean;
  /** officer = ระเบียบภายใน / citizen = คู่มือการใช้บริการสำหรับประชาชน */
  variant?: 'officer' | 'citizen';
}

export function ManualPage({ onBack, showBackButton = true, variant = 'officer' }: Props) {
  const chapters = variant === 'citizen' ? citizenManualChapters : manualChapters;
  const { officer } = useAuth();
  const [items, setItems] = useState<ManualItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [deleteItem, setDeleteItem] = useState<ManualItem | null>(null);
  const [form, setForm] = useState({ title: '', content: '' });
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeId, setActiveId] = useState<string>(chapters[0]?.sections[0]?.id ?? '');
  const [tocOpen, setTocOpen] = useState(false);

  useEffect(() => {
    fetchItems();
  }, [variant]);

  async function fetchItems() {
    const { data } = await supabase
      .from('manual_items')
      .select('*')
      .eq('variant', variant)
      .order('created_at', { ascending: true });
    setItems((data ?? []) as unknown as ManualItem[]);
  }

  function openAdd() {
    setForm({ title: '', content: '' });
    setImagePreview(null);
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
    if (!officer || !form.title.trim()) return;
    setSaving(true);
    let imageUrl: string | null = null;
    if (imageFile) {
      imageUrl = await uploadImage(imageFile, 'manual');
      if (!imageUrl) alert('อัปโหลดรูปไม่สำเร็จ — รายการจะไม่แนบรูป');
    }
    await supabase.from('manual_items').insert({
      variant,
      title: form.title.trim(),
      content: form.content.trim(),
      image_url: imageUrl,
      created_by: officer.id,
      created_by_name: officer.name,
      created_at: new Date().toISOString(),
    });
    setSaving(false);
    setShowForm(false);
    setForm({ title: '', content: '' });
    setImagePreview(null);
    setImageFile(null);
    await fetchItems();
  }

  async function handleDelete() {
    if (!deleteItem) return;
    if (deleteItem.image_url) deleteImage(deleteItem.image_url);
    await supabase.from('manual_items').delete().eq('id', deleteItem.id);
    setDeleteItem(null);
    await fetchItems();
  }

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target?.id) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: [0, 0.1, 0.5] }
    );

    const sections = document.querySelectorAll('[data-manual-section]');
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [variant]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTocOpen(false);
    }
  };

  const scrollTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="bg-navy-900 min-h-[calc(100dvh-4rem)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
        <div className="grid lg:grid-cols-[260px_1fr] gap-6 lg:gap-8">
          {/* TOC Sidebar — desktop sticky (เกาะจอตอนเลื่อนลงมา) */}
          <aside className="hidden lg:block self-start sticky top-[4.5rem] max-h-[calc(100dvh-6rem)] overflow-y-auto pr-2 scrollbar-thin">
              <div className="flex items-center gap-2 mb-3 text-amber-400">
                <List size={16} />
                <h2 className="text-sm font-semibold tracking-wider uppercase">สารบัญ</h2>
              </div>
              <nav className="space-y-3">
                {chapters.map((chapter) => (
                  <div key={chapter.id}>
                    <div className="text-xs font-bold text-white mb-1.5">
                      {chapter.number && <span className="text-amber-500 mr-1">{chapter.number}</span>}
                      {chapter.title}
                    </div>
                    <ul className="space-y-1 border-l border-blue-900/40 pl-3">
                      {chapter.sections.map((section) => (
                        <li key={section.id}>
                          <button
                            onClick={() => scrollTo(section.id)}
                            className={`text-left text-xs leading-relaxed py-1 w-full transition-colors ${
                              activeId === section.id
                                ? 'text-amber-400 font-medium'
                                : 'text-gray-400 hover:text-gray-200'
                            }`}
                          >
                            {section.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </nav>
          </aside>

          {/* Main content */}
          <main className="min-w-0">
            {/* Mobile TOC toggle */}
            <div className="lg:hidden mb-4 flex items-center gap-2 relative">
              <button
                onClick={() => setTocOpen(!tocOpen)}
                className="flex items-center gap-2 px-3 py-2 bg-navy-800 border border-blue-900/40 rounded-lg text-sm text-amber-400 hover:bg-navy-700"
              >
                <List size={16} />
                สารบัญ
              </button>
              {tocOpen && (
                <div className="absolute z-30 left-0 right-0 top-12 bg-navy-800 border border-blue-900/40 rounded-lg p-4 max-h-96 overflow-y-auto shadow-xl">
                  {chapters.map((chapter) => (
                    <div key={chapter.id} className="mb-3 last:mb-0">
                      <div className="text-xs font-bold text-white mb-1">
                        {chapter.number && <span className="text-amber-500 mr-1">{chapter.number}</span>}
                        {chapter.title}
                      </div>
                      <ul className="space-y-1 border-l border-blue-900/40 pl-3">
                        {chapter.sections.map((section) => (
                          <li key={section.id}>
                            <button
                              onClick={() => scrollTo(section.id)}
                              className="text-left text-xs leading-relaxed py-1 w-full text-gray-400 hover:text-amber-400"
                            >
                              {section.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Manual Header */}
            <header className="manual-cover">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center flex-shrink-0">
                  <BookOpen size={28} className="text-amber-400" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-amber-500 font-semibold tracking-widest mb-1">DEPARTMENT OF TRANSPORTATION</p>
                  <h1 className="text-2xl sm:text-3xl font-black text-white mb-1">คู่มือกรมขนส่ง</h1>
                  <p className="text-sm text-gray-400">{variant === 'citizen' ? 'คู่มือการใช้บริการสำหรับประชาชน · DOT System' : 'คู่มือระเบียบการปฏิบัติราชการ · DOT System'}</p>
                </div>
                {officer && (
                  <button
                    onClick={openAdd}
                    className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-400 text-navy-900 font-semibold text-sm rounded-lg flex-shrink-0"
                  >
                    <Plus size={16} />
                    เพิ่มรายการ
                  </button>
                )}
              </div>
            </header>

            {/* Chapters */}
            <div className="mt-6 space-y-10">
              {chapters.map((chapter) => (
                <section key={chapter.id}>
                  {chapter.number && (
                    <div className="flex items-baseline gap-3 mb-4 pb-2 border-b border-blue-900/40">
                      <span className="text-amber-500 font-bold text-sm tracking-wider">{chapter.number}</span>
                      <h2 className="text-xl sm:text-2xl font-bold text-white">{chapter.title}</h2>
                    </div>
                  )}
                  {!chapter.number && chapter.title && (
                    <h2 className="text-xl sm:text-2xl font-bold text-white mb-4 pb-2 border-b border-blue-900/40">
                      {chapter.title}
                    </h2>
                  )}
                  <div className="space-y-5">
                    {chapter.sections.map((section) => (
                      <article
                        key={section.id}
                        id={section.id}
                        data-manual-section
                        className="manual-section"
                      >
                        {section.title && (
                          <h3 className="text-base sm:text-lg font-semibold text-amber-400 mb-2.5">
                            {section.title}
                          </h3>
                        )}
                        <div className="manual-prose">{section.body}</div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}

              {/* รายการที่เพิ่มเอง (Custom items) */}
              {(items.length > 0 || officer) && (
                <section>
                  <h2 className="text-xl sm:text-2xl font-bold text-white mb-4 pb-2 border-b border-blue-900/40">
                    รายการเพิ่มเติม
                  </h2>
                  {items.length === 0 ? (
                    <p className="text-gray-500 text-sm">ยังไม่มีรายการเพิ่มเติม — กด "เพิ่มรายการ" เพื่อเพิ่มหัวข้อและแนบรูป</p>
                  ) : (
                    <div className="space-y-5">
                      {items.map((item) => (
                        <article key={item.id} className="manual-section relative">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="text-base sm:text-lg font-semibold text-amber-400 mb-2.5">
                              {item.title}
                            </h3>
                            {officer && (
                              <button
                                onClick={() => setDeleteItem(item)}
                                className="text-red-400 hover:text-red-300 p-1 flex-shrink-0"
                                title="ลบรายการ"
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                          {item.content && (
                            <p className="text-sm text-gray-300 whitespace-pre-wrap mb-3">{item.content}</p>
                          )}
                          {item.image_url && (
                            <img
                              src={item.image_url}
                              alt={item.title}
                              className="max-h-72 w-auto max-w-full object-contain rounded-lg border border-blue-900/40"
                            />
                          )}
                          {item.created_by_name && (
                            <p className="text-xs text-gray-500 mt-2">โดย {item.created_by_name}</p>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* Back to top */}
              <div className="flex items-center justify-center gap-3 pt-6 border-t border-blue-900/40">
                <button
                  onClick={scrollTop}
                  className="flex items-center gap-1.5 text-sm text-amber-400 hover:text-amber-300 px-4 py-2 rounded-lg border border-amber-500/30 hover:bg-amber-500/5 transition-colors"
                >
                  <ChevronUp size={16} />
                  กลับขึ้นด้านบน
                </button>
              </div>
            </div>
          </main>
        </div>
      </div>

      {/* Floating back button for officer context (optional) */}
      {showBackButton && onBack && (
        <button
          onClick={onBack}
          className="fixed bottom-6 left-6 z-40 flex items-center gap-1.5 px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-navy-900 font-semibold text-sm rounded-lg shadow-lg btn-ripple"
        >
          <ArrowLeft size={16} />
          กลับ
        </button>
      )}

      {/* Add item modal */}
      {showForm && (
        <Modal title="เพิ่มรายการคู่มือ" onClose={() => setShowForm(false)} size="md">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">หัวข้อ</label>
              <input
                className="w-full bg-navy-900 border border-blue-900/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="ชื่อรายการ"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">รายละเอียด</label>
              <textarea
                className="w-full bg-navy-900 border border-blue-900/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500 min-h-[120px]"
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="เนื้อหา..."
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">แนบรูปภาพ (ไม่บังคับ)</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                className="text-sm text-gray-400 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-navy-700 file:text-amber-400"
              />
              {imagePreview && (
                <img src={imagePreview} alt="preview" className="mt-3 max-h-48 rounded-lg border border-blue-900/40" />
              )}
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-navy-900 font-semibold rounded-lg"
            >
              {saving ? 'กำลังบันทึก...' : 'เพิ่มรายการ'}
            </button>
          </form>
        </Modal>
      )}

      {deleteItem && (
        <ConfirmDialog
          title="ลบรายการ"
          message={`ต้องการลบรายการ "${deleteItem.title}" ใช่หรือไม่?`}
          confirmLabel="ลบ"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteItem(null)}
        />
      )}

      <a
        href="https://xn--dot-dklfkx7lvcbv1g7a3k2a3w.my.canva.site/dot69"
        target="_blank"
        rel="noopener noreferrer"
        className="hidden"
        aria-hidden
      >
        <ExternalLink size={0} />
      </a>
    </div>
  );
}
