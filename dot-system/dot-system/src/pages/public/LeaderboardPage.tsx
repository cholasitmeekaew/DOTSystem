import { useEffect, useState } from 'react';
import { Trophy, Medal, Award, Crown } from 'lucide-react';
import { Officer, RANK_LABELS, DEPARTMENT_LABELS, getPointsLevel } from '../../lib/types';
import { fetchLeaderboard } from '../../lib/api/points';
import { FadeIn, Stagger, StaggerItem } from '../../components/animations';

export function LeaderboardPage() {
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboard(20)
      .then(setOfficers)
      .finally(() => setLoading(false));
  }, []);

  const top3 = officers.slice(0, 3);
  const rest = officers.slice(3);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
      <FadeIn className="text-center mb-10">
        <div className="inline-flex w-16 h-16 bg-amber-500/10 border-2 border-amber-500/30 rounded-2xl items-center justify-center mb-4 anim-float">
          <Trophy size={30} className="text-amber-400" />
        </div>
        <h1 className="text-3xl md:text-4xl font-black text-white mb-2 tracking-tight">
          อันดับเจ้าหน้าที่ดีเด่น
        </h1>
        <p className="text-gray-400 text-sm">
          Performance Point System (PPS) — อัปเดตจากระบบกรมขนส่ง
        </p>
      </FadeIn>

      {loading ? (
        <div className="text-center text-gray-500 py-12">กำลังโหลด...</div>
      ) : officers.length === 0 ? (
        <div className="card p-12 text-center text-gray-500">ยังไม่มีข้อมูลคะแนน</div>
      ) : (
        <>
          {/* Top 3 Podium */}
          {top3.length >= 3 && (
            <FadeIn delay={0.1} className="mb-8">
              <div className="grid grid-cols-3 gap-3 sm:gap-4">
                {[top3[1], top3[0], top3[2]].map((o, i) => {
                  const order = [1, 0, 2][i]; // ให้อันดับ 1 อยู่กลาง
                  const ranks = [2, 1, 3];
                  const rank = ranks[i];
                  const level = getPointsLevel(o.points);
                  return (
                    <div
                      key={o.id}
                      className={`relative bg-gradient-to-b ${
                        rank === 1
                          ? 'from-amber-500/20 to-navy-800 border-amber-500/40 sm:scale-105 sm:z-10'
                          : 'from-navy-700/50 to-navy-800 border-blue-900/40'
                      } border rounded-2xl p-4 sm:p-5 text-center shadow-xl`}
                    >
                      {rank === 1 && (
                        <Crown size={22} className="text-amber-400 mx-auto -mt-7 mb-1" fill="currentColor" />
                      )}
                      <div className={`mx-auto w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center font-black text-xl sm:text-2xl mb-2 ${
                        rank === 1 ? 'bg-amber-500/20 text-amber-300 ring-2 ring-amber-500/40' :
                        rank === 2 ? 'bg-gray-300/15 text-gray-300 ring-2 ring-gray-300/30' :
                        'bg-orange-700/15 text-orange-400 ring-2 ring-orange-700/30'
                      }`}>
                        {o.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="font-bold text-white text-sm sm:text-base truncate">{o.name}</div>
                      <div className="text-xs text-gray-400 truncate">
                        {RANK_LABELS[o.rank] ?? o.rank}
                      </div>
                      <div className={`mt-2 text-2xl sm:text-3xl font-black ${level.textClass}`}>
                        {o.points.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-gray-500 mt-0.5">คะแนน</div>
                      <div className={`mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${level.bgClass} ${level.textClass} ring-1 ${level.ringClass}`}>
                        {level.label}
                      </div>
                      {rank === 1 && <Medal size={14} className="absolute top-2 right-2 text-amber-400" />}
                    </div>
                  );
                })}
              </div>
            </FadeIn>
          )}

          {/* Rest */}
          {rest.length > 0 && (
            <FadeIn delay={0.2}>
              <Stagger className="card p-3 sm:p-4 space-y-1.5">
                {rest.map((o, idx) => {
                  const level = getPointsLevel(o.points);
                  return (
                    <StaggerItem key={o.id}>
                      <div className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-navy-700/50 transition-colors">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-navy-700 flex items-center justify-center text-amber-400 font-bold flex-shrink-0 text-sm">
                          {idx + 4}
                        </div>
                        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-navy-700 flex items-center justify-center text-amber-400 font-bold flex-shrink-0">
                          {o.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-white text-sm font-semibold truncate">{o.name}</div>
                          <div className="text-xs text-gray-500 truncate">
                            {RANK_LABELS[o.rank] ?? o.rank} · {DEPARTMENT_LABELS[o.department] ?? o.department}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className={`text-base sm:text-lg font-bold ${level.textClass}`}>
                            {o.points.toLocaleString()}
                          </div>
                          <div className={`text-[10px] ${level.textClass} opacity-75`}>{level.label}</div>
                        </div>
                      </div>
                    </StaggerItem>
                  );
                })}
              </Stagger>
            </FadeIn>
          )}
        </>
      )}

      <FadeIn delay={0.3} className="text-center text-xs text-gray-500 mt-8">
        <p>ข้อมูลอัปเดตจากระบบ — กรมขนส่ง Bit Cities · ระบบคะแนนสะสม PPS</p>
      </FadeIn>
    </div>
  );
}
