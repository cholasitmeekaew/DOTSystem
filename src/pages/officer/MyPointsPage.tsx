import { useEffect, useState } from 'react';
import { Award, TrendingUp, TrendingDown, Trophy, Target, History } from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';
import { Officer, PointsLogEntry, getPointsLevel, getNextPointsLevel } from '../../lib/types';
import { supabase } from '../../lib/supabase';
import { PageHeader } from '../../components/PageHeader';
import { FadeIn } from '../../components/animations';

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function MyPointsPage() {
  const { officer } = useAuth();
  const [officerData, setOfficerData] = useState<Officer | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!officer) return;
    const fetch = async () => {
      const { data } = await supabase
        .from('officers')
        .select('*')
        .eq('id', officer.id)
        .single();
      setOfficerData((data as unknown as Officer) ?? null);
      setLoading(false);
    };
    fetch();
  }, [officer]);

  if (!officer) return null;
  if (loading) {
    return <div className="text-center text-gray-400 py-12">กำลังโหลด...</div>;
  }

  const points = officerData?.points ?? 0;
  const log = (officerData?.points_log ?? []).slice().reverse();
  const period = officerData?.points_period ?? new Date().toISOString().slice(0, 7);
  const level = getPointsLevel(points);
  const next = getNextPointsLevel(points);

  const progress = next
    ? Math.min(100, Math.round(((points - level.min) / (next.min - level.min)) * 100))
    : 100;

  return (
    <div>
      <PageHeader
        icon={<Award size={26} />}
        title="คะแนนสะสม PPS"
        subtitle="ดูคะแนนสะสมและประวัติการทำรายการของคุณ"
      />

      {/* Hero card */}
      <FadeIn className="mb-6">
        <div className="card p-6 sm:p-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-40 h-40 bg-amber-500/5 rounded-full blur-3xl" />
          <div className="relative">
            <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
              <div>
                <p className="text-xs text-amber-500 font-semibold tracking-widest mb-1">PERIOD {period}</p>
                <h2 className="text-4xl sm:text-5xl font-black text-white">
                  {points.toLocaleString()}
                  <span className="text-base text-gray-500 font-normal ml-2">คะแนน</span>
                </h2>
                <div className={`inline-flex items-center gap-1.5 mt-3 px-3 py-1 rounded-full text-xs font-semibold ${level.bgClass} ${level.textClass} ring-1 ${level.ringClass}`}>
                  <Trophy size={12} />
                  ระดับ: {level.label}
                </div>
              </div>
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-500/5 flex items-center justify-center ring-1 ring-amber-500/30">
                <Award size={36} className="text-amber-400" />
              </div>
            </div>

            {next ? (
              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-gray-400 flex items-center gap-1.5">
                    <Target size={12} />
                    ไปยังระดับ "{next.label}"
                  </span>
                  <span className="text-amber-400 font-semibold">
                    อีก {next.min - points} คะแนน
                  </span>
                </div>
                <div className="h-2 bg-navy-900 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-amber-300 transition-all duration-700"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="text-sm text-amber-400 font-semibold flex items-center gap-1.5">
                <Trophy size={14} /> ถึงระดับสูงสุดแล้ว — เจ้าหน้าที่ดีเด่น
              </div>
            )}
          </div>
        </div>
      </FadeIn>

      {/* History */}
      <FadeIn delay={0.1}>
        <div className="card p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <History size={18} className="text-amber-400" />
            <h3 className="text-lg font-bold text-white">ประวัติการทำรายการ</h3>
            <span className="text-xs text-gray-500">({log.length} รายการ)</span>
          </div>

          {log.length === 0 ? (
            <div className="text-center text-gray-500 text-sm py-8">
              ยังไม่มีประวัติการทำรายการ
            </div>
          ) : (
            <ul className="space-y-2">
              {log.map((entry, i) => {
                const positive = entry.delta > 0;
                return (
                  <li
                    key={i}
                    className="flex items-start gap-3 p-3 rounded-lg bg-navy-900/40 border border-blue-900/30 hover:border-amber-500/20 transition-colors"
                  >
                    <div className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      positive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                    }`}>
                      {positive ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="text-sm text-white font-medium">{entry.reason}</div>
                        <div className={`font-bold text-base ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
                          {positive ? '+' : ''}{entry.delta}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                        <span>{formatDate(entry.at)}</span>
                        <span>·</span>
                        <span>โดย {entry.by_name}</span>
                        <span>·</span>
                        <span>คงเหลือ {entry.balance_after}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </FadeIn>
    </div>
  );
}
