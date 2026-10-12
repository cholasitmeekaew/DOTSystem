import { useEffect, useState } from 'react';
import {
  ArrowLeft, BookOpen, List, ChevronUp, ExternalLink, Plus, Trash2,
  Pencil, EyeOff, Type as TypeIcon, AlertTriangle,
} from 'lucide-react';
import { manualChapters } from '../../data/manualContent';
import { citizenManualChapters } from '../../data/citizenManualContent';
import { supabase } from '../../lib/supabase';
import { uploadImage, deleteImage } from '../../lib/storage';
import { useAuth } from '../../lib/AuthContext';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { ManualBlockView, ManualBlockEditor } from '../../components/ManualContentEditor';
import {
  fetchManualSnapshot, saveChapter, saveSection, saveBlocks,
  hideChapter, showChapter, hideSection, showSection,
  type ResolvedChapter, type ResolvedSection, type ContentBlock,
} from '../../lib/manualContentApi';

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
  /**
   * true = เปิดปุ่มแก้ไขเนื้อหา (เข้าจากการ์ด "แก้ไขคู่มือ" ในเมนู Admin เท่านั้น)
   * หน้าคู่มือปกติเป็นโหมดอ่านสำหรับทุกคน รวมถึงหัวหน้ากรม
   */
  adminEdit?: boolean;
}

export function ManualPage({
  onBack, showBackButton = true, variant = 'officer', adminEdit = false,
}: Props) {
  const chapters = variant === 'citizen' ? citizenManualChapters : manualChapters;
  const { officer, isCommissioner } = useAuth();
  const [items, setItems] = useState<ManualItem[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [deleteItem, setDeleteItem] = useState<ManualItem | null>(null);
  const [form, setForm] = useState({ title: '', content: '' });
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeId, setActiveId] = useState<string>(chapters[0]?.sections[0]?.id ?? '');
  const [tocOpen, setTocOpen] = useState(false);
  // --- ระบบแก้ไขเนื้อหาคู่มือ ---
  const [chaptersDb, setChaptersDb] = useState<ResolvedChapter[]>([]);
  const [dbReady, setDbReady] = useState(false);
  const [dbUnavailable, setDbUnavailable] = useState(false);
  const [editing, setEditing] = useState<{ sectionId: string } | null>(null);
  const [draftBlocks, setDraftBlocks] = useState<ContentBlock[]>([]);
  const [savingBlocks, setSavingBlocks] = useState(false);
  const [nameEdit, setNameEdit] = useState<{ kind: 'chapter' | 'section'; id: string; chapterId: string; value: string } | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [confirmHide, setConfirmHide] = useState<{ kind: 'chapter' | 'section'; id: string; chapterId: string; label: string } | null>(null);

  useEffect(() => {
    fetchItems();
  }, [variant]);


  /* ---------- ระบบแก้ไขเนื้อหาคู่มือ ---------- */
  const canEdit = adminEdit && isCommissioner;

  /** โครงสร้างที่ใช้แสดงผล: ถ้าต่อ DB ได้ใช้ของ DB ครอบ ถ้าไม่ได้ใช้ของเดิมจากโค้ด */
  const view = dbReady && chaptersDb.length > 0
    ? chaptersDb.filter((c) => !c.isHidden)
    : chapters.map((c) => ({
        id: c.id,
        number: c.number ?? '',
        title: c.title,
        isHidden: false,
        isOverridden: false,
        sections: c.sections.map((s) => ({
          id: s.id,
          chapterId: c.id,
          title: s.title,
          legacyBody: s.body,
          blocks: [],
          usesBlocks: false,
          isHidden: false,
          isOverridden: false,
        })),
      }));

  async function loadChapters() {
    const snap = await fetchManualSnapshot(variant, chapters as never);
    setChaptersDb(snap.chapters);
    setDbUnavailable(snap.dbUnavailable);
    setDbReady(true);
  }

  useEffect(() => { void loadChapters(); }, [variant]);

  function openSectionEditor(section: ResolvedSection) {
    setDraftBlocks(section.blocks.length > 0 ? section.blocks.map((b) => ({ ...b })) : []);
    setEditing({ sectionId: section.id });
  }

  async function commitBlocks() {
    if (!editing || !officer) return;
    const sec = chaptersDb.flatMap((c) => c.sections).find((x) => x.id === editing.sectionId);
    if (!sec) return;
    setSavingBlocks(true);
    try {
      await saveBlocks(variant, sec.id, draftBlocks, { id: officer.id, name: officer.name });
      await loadChapters();
      setEditing(null);
    } catch (e) {
      alert(`บันทึกบล็อกไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setSavingBlocks(false);
    }
  }

  async function commitName() {
    if (!nameEdit || !officer) return;
    setSavingName(true);
    try {
      const by = { id: officer.id, name: officer.name };
      if (nameEdit.kind === 'chapter') {
        await saveChapter({ variant, id: nameEdit.id, title: nameEdit.value.trim(), by });
      } else {
        await saveSection({ variant, id: nameEdit.id, chapterId: nameEdit.chapterId, title: nameEdit.value.trim(), by });
      }
      await loadChapters();
      setNameEdit(null);
    } catch (e) {
      alert(`บันทึกชื่อไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setSavingName(false);
    }
  }

  async function toggleHide() {
    if (!confirmHide || !officer) return;
    const by = { id: officer.id, name: officer.name };
    try {
      if (confirmHide.kind === 'chapter') {
        const cur = chaptersDb.find((c) => c.id === confirmHide.id);
        if (cur?.isHidden) await showChapter(variant, confirmHide.id, by);
        else await hideChapter(variant, confirmHide.id, by);
      } else {
        const cur = chaptersDb.flatMap((c) => c.sections).find((x) => x.id === confirmHide.id);
        if (cur?.isHidden) await showSection(variant, confirmHide.id, confirmHide.chapterId, by);
        else await hideSection(variant, confirmHide.id, confirmHide.chapterId, by);
      }
      await loadChapters();
    } catch (e) {
      alert(`ดำเนินการไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setConfirmHide(null);
    }
  }

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
                {view.map((chapter) => (
                  <div key={chapter.id}>
                    <div className="text-xs font-bold text-white mb-1.5 flex items-start gap-1">
                      <span className="flex-1">
                        {chapter.number && <span className="text-amber-500 mr-1">{chapter.number}</span>}
                        {chapter.title}
                      </span>
                      {canEdit && (
                        <span className="flex items-center gap-0.5 flex-shrink-0">
                          <button
                            onClick={() => setNameEdit({
                              kind: 'chapter', id: chapter.id, chapterId: chapter.id, value: chapter.title,
                            })}
                            className="p-0.5 rounded text-gray-600 hover:text-blue-400 hover:bg-blue-500/10"
                            title="แก้ไขชื่อบท"
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            onClick={() => setConfirmHide({
                              kind: 'chapter', id: chapter.id, chapterId: chapter.id,
                              label: `บท "${chapter.title}"`,
                            })}
                            className="p-0.5 rounded text-gray-600 hover:text-amber-400 hover:bg-amber-500/10"
                            title="ซ่อนบทนี้"
                          >
                            <EyeOff size={11} />
                          </button>
                        </span>
                      )}
                    </div>
                    <ul className="space-y-1 border-l border-blue-900/40 pl-3">
                      {chapter.sections.filter((x) => !x.isHidden).map((section) => (
                        <li key={section.id} className="group flex items-start gap-1">
                          <button
                            onClick={() => scrollTo(section.id)}
                            className={`text-left text-xs leading-relaxed py-1 flex-1 transition-colors ${
                              activeId === section.id
                                ? 'text-amber-400 font-medium'
                                : 'text-gray-400 hover:text-gray-200'
                            }`}
                          >
                            {section.title}
                          </button>
                          {canEdit && (
                            <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                              <button
                                onClick={() => openSectionEditor(section)}
                                className="p-0.5 rounded text-gray-600 hover:text-blue-400 hover:bg-blue-500/10"
                                title="แก้ไขเนื้อหา"
                              >
                                <Pencil size={11} />
                              </button>
                              <button
                                onClick={() => setConfirmHide({
                                  kind: 'section', id: section.id, chapterId: chapter.id,
                                  label: `หมวดย่อย "${section.title}"`,
                                })}
                                className="p-0.5 rounded text-gray-600 hover:text-amber-400 hover:bg-amber-500/10"
                                title="ซ่อนหมวดย่อยนี้"
                              >
                                <EyeOff size={11} />
                              </button>
                            </span>
                          )}
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
                  {view.map((chapter) => (
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

            {dbUnavailable && canEdit && (
              <div className="flex items-start gap-2.5 text-[12px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3.5 py-2.5 mb-4">
                <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
                <div className="space-y-0.5">
                  <div className="font-semibold">ยังแก้ไขเนื้อหาไม่ได้</div>
                  <div className="text-[11px] text-amber-300/80">
                    ยังไม่ได้รัน migration 0032 — หน้านี้กำลังแสดงเนื้อหาจากโค้ดตามปกติ
                    กรุณารัน <code className="text-amber-200">0032_manual_content_blocks.sql</code>
                    แล้ว <code className="text-amber-200">SEED_manual_content.sql</code> ใน Supabase SQL Editor
                  </div>
                </div>
              </div>
            )}

            {/* Chapters */}
            <div className="mt-6 space-y-10">
              {view.map((chapter) => (
                <section key={chapter.id}>
                  <ChapterHeader
                    chapter={chapter}
                    canEdit={canEdit}
                    onRename={() => setNameEdit({
                      kind: 'chapter', id: chapter.id, chapterId: chapter.id, value: chapter.title,
                    })}
                    onToggleHide={() => setConfirmHide({
                      kind: 'chapter', id: chapter.id, chapterId: chapter.id,
                      label: `บท "${chapter.title}"`,
                    })}
                  />
                  <div className="space-y-5">
                    {chapter.sections.filter((x) => !x.isHidden).map((section) => (
                      <article
                        key={section.id}
                        id={section.id}
                        data-manual-section
                        className="manual-section"
                      >
                        <div className="flex items-start gap-2">
                          {section.title && (
                            <h3 className="text-base sm:text-lg font-semibold text-amber-400 mb-2.5 flex-1">
                              {section.title}
                            </h3>
                          )}
                          {canEdit && (
                            <div className="flex items-center gap-0.5 flex-shrink-0">
                              <button
                                onClick={() => openSectionEditor(section)}
                                className="p-1 rounded text-gray-500 hover:text-blue-400 hover:bg-blue-500/10"
                                title="แก้ไขเนื้อหาหมวดย่อยนี้"
                              >
                                <Pencil size={13} />
                              </button>
                              <button
                                onClick={() => setNameEdit({
                                  kind: 'section', id: section.id, chapterId: chapter.id,
                                  value: section.title,
                                })}
                                className="p-1 rounded text-gray-500 hover:text-blue-400 hover:bg-blue-500/10"
                                title="เปลี่ยนชื่อหมวดย่อย"
                              >
                                <TypeIcon size={13} />
                              </button>
                              <button
                                onClick={() => setConfirmHide({
                                  kind: 'section', id: section.id, chapterId: chapter.id,
                                  label: `หมวดย่อย "${section.title}"`,
                                })}
                                className="p-1 rounded text-gray-500 hover:text-amber-400 hover:bg-amber-500/10"
                                title="ซ่อนหมวดย่อยนี้"
                              >
                                <EyeOff size={13} />
                              </button>
                            </div>
                          )}
                        </div>

                        {editing?.sectionId === section.id ? (
                          <div className="mt-2">
                            <ManualBlockEditor
                              blocks={draftBlocks}
                              onChange={setDraftBlocks}
                              onSave={commitBlocks}
                              onCancel={() => setEditing(null)}
                              saving={savingBlocks}
                            />
                          </div>
                        ) : section.usesBlocks ? (
                          <div className="manual-prose">
                            {section.blocks.length === 0 ? (
                              <p className="text-gray-600 text-xs italic">ยังไม่มีเนื้อหาในหมวดย่อยนี้</p>
                            ) : section.blocks.map((b) => (
                              <ManualBlockView key={b.id} block={b} />
                            ))}
                          </div>
                        ) : (
                          <div className="manual-prose">{section.legacyBody}</div>
                        )}
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
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => { setShowForm(false); setForm({ title: '', content: '' }); setImageFile(null); setImagePreview(null); }}
                disabled={saving}
                className="btn-secondary flex-1 py-2.5 text-sm disabled:opacity-50"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-navy-900 font-semibold rounded-lg"
              >
                {saving ? 'กำลังบันทึก...' : 'เพิ่มรายการ'}
              </button>
            </div>
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


/* ---------- หัวบท พร้อมปุ่มแก้ไข/ซ่อน ---------- */
function ChapterHeader({
  chapter, canEdit, onRename, onToggleHide,
}: {
  chapter: ResolvedChapter;
  canEdit: boolean;
  onRename: () => void;
  onToggleHide: () => void;
}) {
  const actions = canEdit ? (
    <div className="flex items-center gap-0.5 flex-shrink-0">
      <button
        onClick={onRename}
        className="p-1 rounded text-gray-600 hover:text-blue-400 hover:bg-blue-500/10"
        title="แก้ไขชื่อบท"
      >
        <Pencil size={14} />
      </button>
      <button
        onClick={onToggleHide}
        className="p-1 rounded text-gray-600 hover:text-amber-400 hover:bg-amber-500/10"
        title="ซ่อนบทนี้"
      >
        <EyeOff size={14} />
      </button>
    </div>
  ) : null;

  const titleEl = (
    <>
      {chapter.number && <span className="text-amber-500 font-bold text-sm tracking-wider">{chapter.number}</span>}
      <h2 className="text-xl sm:text-2xl font-bold text-white">{chapter.title}</h2>
    </>
  );

  if (chapter.number) {
    return (
      <div className="flex items-center gap-2 mb-4 pb-2 border-b border-blue-900/40">
        <div className="flex items-baseline gap-3 flex-1 min-w-0">{titleEl}</div>
        {actions}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 mb-4 pb-2 border-b border-blue-900/40">
      <h2 className="text-xl sm:text-2xl font-bold text-white flex-1 min-w-0">{chapter.title}</h2>
      {actions}
    </div>
  );
}
