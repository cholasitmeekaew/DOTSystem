import { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, List, ChevronUp, ExternalLink } from 'lucide-react';
import { manualChapters } from '../../data/manualContent';
import { citizenManualChapters } from '../../data/citizenManualContent';

interface Props {
  onBack?: () => void;
  showBackButton?: boolean;
  /** officer = ระเบียบภายใน / citizen = คู่มือการใช้บริการสำหรับประชาชน */
  variant?: 'officer' | 'citizen';
}

export function ManualPage({ onBack, showBackButton = true, variant = 'officer' }: Props) {
  const chapters = variant === 'citizen' ? citizenManualChapters : manualChapters;
  const [activeId, setActiveId] = useState<string>(chapters[0]?.sections[0]?.id ?? '');
  const [tocOpen, setTocOpen] = useState(false);

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
  }, []);

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
          {/* TOC Sidebar — desktop sticky */}
          <aside className="hidden lg:block">
            <div className="sticky top-20">
              <div className="flex items-center gap-2 mb-3 text-amber-400">
                <List size={16} />
                <h2 className="text-sm font-semibold tracking-wider uppercase">สารบัญ</h2>
              </div>
              <nav className="space-y-3 max-h-[calc(100dvh-8rem)] overflow-y-auto pr-2 scrollbar-thin">
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
            </div>
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
                <div>
                  <p className="text-xs text-amber-500 font-semibold tracking-widest mb-1">DEPARTMENT OF TRANSPORTATION</p>
                  <h1 className="text-2xl sm:text-3xl font-black text-white mb-1">คู่มือกรมขนส่ง</h1>
                  <p className="text-sm text-gray-400">{variant === 'citizen' ? 'คู่มือการใช้บริการสำหรับประชาชน · DOT System' : 'คู่มือระเบียบการปฏิบัติราชการ · DOT System'}</p>
                </div>
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
