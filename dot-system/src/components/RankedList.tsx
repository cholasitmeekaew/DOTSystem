import { ReactNode, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface RankItem {
  id: string;
  primary: string;
  secondary?: string;
  value: string;
  subValue?: string;
}

interface RankedListProps {
  title: string;
  icon?: ReactNode;
  items: RankItem[];
  pageSize?: number;
  onSelect?: (item: RankItem) => void;
  emptyText?: string;
}

const RANK_STYLES: Record<number, string> = {
  1: 'bg-amber-500/20 text-amber-300 border-amber-500/50',
  2: 'bg-slate-400/15 text-slate-300 border-slate-400/40',
  3: 'bg-orange-700/20 text-orange-300 border-orange-600/40',
};

function rankStyle(rank: number): string {
  return RANK_STYLES[rank] ?? 'bg-navy-700/60 text-gray-500 border-blue-900/40';
}

export function RankedList({ title, icon, items, pageSize = 5, onSelect, emptyText = 'ไม่มีข้อมูล' }: RankedListProps) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const start = (page - 1) * pageSize;
  const visible = items.slice(start, start + pageSize);

  return (
    <div className="card overflow-hidden flex flex-col">
      {/* formal frame header */}
      <div className="ph-panel-head flex items-center gap-2">
        <span className="ph-corner ph-corner-tl" aria-hidden />
        <span className="ph-corner ph-corner-br" aria-hidden />
        {icon && <span className="text-amber-400">{icon}</span>}
        <h3 className="text-xs font-bold text-white tracking-wide">{title}</h3>
      </div>

      {/* list */}
      <div className="flex-1 p-2 space-y-1.5 min-h-[180px]">
        {visible.length === 0 ? (
          <p className="text-gray-500 text-xs text-center py-8">{emptyText}</p>
        ) : (
          visible.map((item, idx) => {
            const rank = start + idx + 1;
            return (
              <button
                key={item.id}
                onClick={() => onSelect?.(item)}
                disabled={!onSelect}
                className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                  onSelect ? 'hover:bg-navy-700/70 cursor-pointer text-left' : ''
                }`}
              >
                <span className={`w-6 h-6 rounded-md border flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${rankStyle(rank)}`}>
                  {rank}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-white text-xs font-medium truncate">{item.primary}</div>
                  {item.secondary && <div className="text-gray-500 text-[10px] truncate">{item.secondary}</div>}
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-white text-xs font-semibold whitespace-nowrap">{item.value}</div>
                  {item.subValue && <div className="text-gray-500 text-[10px] whitespace-nowrap">{item.subValue}</div>}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1.5 py-2.5 border-t border-blue-900/30">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="p-1 rounded bg-navy-700/60 text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:text-gray-400 transition-colors"
          >
            <ChevronLeft size={13} />
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              onClick={() => setPage(n)}
              className={`min-w-[22px] h-[22px] rounded text-[10px] font-medium transition-colors ${
                n === page ? 'bg-amber-500 text-navy-900' : 'bg-navy-700/60 text-gray-400 hover:text-white'
              }`}
            >
              {n}
            </button>
          ))}
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="p-1 rounded bg-navy-700/60 text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:text-gray-400 transition-colors"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
