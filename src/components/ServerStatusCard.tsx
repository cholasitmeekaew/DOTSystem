import { useEffect, useState } from 'react';
import { Activity, RefreshCw, Server } from 'lucide-react';

const API_BASE = 'https://bitnewsth.qd.je/api/public/server-status';

interface ServerInfo {
  status?: string;
  statusText?: string;
  playerCount?: number;
  maxPlayers?: number;
  queueCount?: number;
  staffCount?: number;
  capacityPercent?: number;
}

interface HistoryPoint {
  at: number;
  players: number;
  status: string;
}

type State = 'online' | 'offline' | 'maintenance' | 'unknown';

function normalizeStatus(raw: unknown): State {
  const s = String(raw ?? '').toLowerCase();
  if (['online', 'up', 'ok', 'operational'].includes(s)) return 'online';
  if (s.includes('maintenance') || s.includes('maint')) return 'maintenance';
  if (['offline', 'down', 'error', 'outage'].includes(s)) return 'offline';
  return 'unknown';
}

const STATUS_STYLE: Record<State, { dot: string; text: string; label: string; ring: string }> = {
  online: { dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'ออนไลน์', ring: 'border-emerald-500/30' },
  offline: { dot: 'bg-red-400', text: 'text-red-400', label: 'ออฟไลน์', ring: 'border-red-500/30' },
  maintenance: { dot: 'bg-amber-400', text: 'text-amber-400', label: 'ปิดปรับปรุง', ring: 'border-amber-500/30' },
  unknown: { dot: 'bg-gray-500', text: 'text-gray-400', label: 'ไม่ทราบ', ring: 'border-gray-600/30' },
};

function PlayersChart({ points, range }: { points: HistoryPoint[]; range: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 200;
  const padL = 32;
  const padB = 24;
  const padT = 12;
  const data = points.slice(-120);
  if (data.length === 0) return null;
  const max = Math.max(1, ...data.map((d) => d.players));
  const x = (i: number) => padL + (i / Math.max(1, data.length - 1)) * (W - padL - 8);
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d.players).toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${x(data.length - 1).toFixed(1)},${H - padB} L${x(0).toFixed(1)},${H - padB} Z`;
  const ticks = [0, 0.5, 1].map((f) => ({ y: padT + (1 - f) * (H - padT - padB), label: Math.round(max * f).toString() }));
  const xLabels = [0, Math.floor(data.length / 2), data.length - 1].map((i) => ({
    x: x(i),
    label: new Date(data[i].at).toLocaleString('th-TH', range === '7d' || range === '30d'
      ? { day: 'numeric', month: 'short' }
      : { hour: '2-digit', minute: '2-digit' }),
  }));

  function handleMove(clientX: number, el: SVGSVGElement) {
    const rect = el.getBoundingClientRect();
    const rel = (clientX - rect.left) / rect.width;
    const idx = Math.round(((rel * W - padL) / (W - padL - 8)) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, idx)));
  }

  const hoverPoint = hover !== null ? data[hover] : null;
  const rangeLabel = range === '6h' ? '6 ชม.' : range === '24h' ? '24 ชม.' : range === '7d' ? '7 วัน' : '30 วัน';

  return (
    <div>
      <div className="text-gray-400 text-xs mb-1">จำนวนผู้เล่น ({rangeLabel})</div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none cursor-crosshair"
        role="img"
        aria-label="กราฟจำนวนผู้เล่น"
        onMouseMove={(e) => handleMove(e.clientX, e.currentTarget)}
        onMouseLeave={() => setHover(null)}
        onTouchStart={(e) => handleMove(e.touches[0].clientX, e.currentTarget)}
        onTouchMove={(e) => handleMove(e.touches[0].clientX, e.currentTarget)}
      >
        <defs>
          <linearGradient id="dot-players-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - 4} y1={t.y} y2={t.y} stroke="#2b2b33" strokeWidth={1} />
            <text x={padL - 6} y={t.y + 4} textAnchor="end" fontSize={10} fill="#94a3b8">{t.label}</text>
          </g>
        ))}
        <path d={areaPath} fill="url(#dot-players-area)" />
        <path d={linePath} fill="none" stroke="#fbbf24" strokeWidth={2} strokeLinejoin="round" />
        {xLabels.map((t, i) => (
          <text key={i} x={t.x} y={H - 6} textAnchor="middle" fontSize={10} fill="#94a3b8">{t.label}</text>
        ))}
        {hoverPoint && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="#fbbf24" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
            <circle cx={x(hover)} cy={y(hoverPoint.players)} r={4} fill="#fbbf24" stroke="#0f172a" strokeWidth={2} />
            <g transform={`translate(${Math.min(Math.max(x(hover) + 8, padL), W - 150)}, ${Math.max(y(hoverPoint.players) - 34, padT)})`}>
              <rect width={142} height={30} rx={6} fill="#1e293b" stroke="#334155" />
              <text x={8} y={13} fontSize={10} fill="#e2e8f0">
                {new Date(hoverPoint.at).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </text>
              <text x={8} y={25} fontSize={10} fill="#fbbf24" fontWeight="bold">
                {hoverPoint.players} ผู้เล่น · {hoverPoint.status}
              </text>
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}

export function ServerStatusCard() {
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [points, setPoints] = useState<HistoryPoint[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [range, setRange] = useState<string>('6h');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, historyRes] = await Promise.allSettled([
        fetch(API_BASE).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
        fetch(`${API_BASE}/history?range=${range}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
      ]);
      if (statusRes.status === 'fulfilled') {
        setServer(statusRes.value?.server ?? null);
        setUpdatedAt(statusRes.value?.updatedAt ?? null);
      } else {
        setError(statusRes.reason?.message ?? 'โหลดไม่สำเร็จ');
      }
      if (historyRes.status === 'fulfilled' && Array.isArray(historyRes.value?.points)) {
        setPoints(historyRes.value.points);
      }
      setLastChecked(new Date());
    } catch (e: any) {
      setError(e?.message ?? 'โหลดไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const state = normalizeStatus(server?.status);
  const st = STATUS_STYLE[state];

  return (
    <section className="max-w-7xl mx-auto px-6 pt-10">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-1 h-7 bg-blue-500 rounded-full" />
        <h2 className="text-2xl font-bold text-white">สถานะเซิร์ฟเวอร์</h2>
      </div>
      <p className="text-gray-400 text-sm mb-6">รายงานสถานะการทำงานของเซิร์ฟเวอร์แบบเรียลไทม์ (ข้อมูลจาก API นักข่าว BIT NEWS)</p>

      <div className={`card p-6 border ${st.ring}`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-navy-700 flex items-center justify-center">
              <Server size={22} className="text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${st.dot} ${state === 'online' ? 'animate-pulse' : ''}`} />
                <span className={`text-lg font-bold ${st.text}`}>
                  {loading && !server ? 'กำลังตรวจสอบ...' : (server?.statusText ?? st.label)}
                </span>
              </div>
              <div className="text-gray-500 text-xs mt-0.5">
                {lastChecked ? `ตรวจสอบล่าสุด ${lastChecked.toLocaleTimeString('th-TH')}` : '—'}
              </div>
            </div>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            รีเฟรช
          </button>
        </div>

        {error && (
          <p className="mt-4 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้: {error}
          </p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5">
          <div className="bg-navy-800/60 rounded-xl p-4">
            <div className="text-gray-500 text-xs mb-1">ผู้เล่นในเซิร์ฟเวอร์</div>
            <div className="text-white text-xl font-bold">
              {server ? `${server.playerCount ?? 0}/${server.maxPlayers ?? '-'}` : '—'}
            </div>
          </div>
          <div className="bg-navy-800/60 rounded-xl p-4">
            <div className="text-gray-500 text-xs mb-1">คิวรอ</div>
            <div className="text-white text-xl font-bold">{server ? server.queueCount ?? 0 : '—'}</div>
          </div>
          <div className="bg-navy-800/60 rounded-xl p-4">
            <div className="text-gray-500 text-xs mb-1">เจ้าหน้าที่ออนไลน์</div>
            <div className="text-white text-xl font-bold">{server ? server.staffCount ?? 0 : '—'}</div>
          </div>
          <div className="bg-navy-800/60 rounded-xl p-4">
            <div className="text-gray-500 text-xs mb-1">อัปเดตล่าสุด</div>
            <div className="text-white text-sm font-medium">
              {updatedAt ? new Date(updatedAt).toLocaleTimeString('th-TH') : '—'}
            </div>
          </div>
        </div>

        {points.length > 0 && (
          <div className="mt-5">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 text-gray-400 text-xs">
                <Activity size={13} />
                ประวัติย้อนหลัง
              </div>
              <div className="flex gap-1">
                {['6h', '24h', '7d', '30d'].map((r) => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      range === r ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'text-gray-500 hover:text-gray-300 border border-transparent'
                    }`}
                  >
                    {r === '6h' ? '6 ชม.' : r === '24h' ? '24 ชม.' : r === '7d' ? '7 วัน' : '30 วัน'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-0.5 h-6 mb-4">
              {points.slice(-120).map((p, i) => {
                const s = normalizeStatus(p.status);
                const color = s === 'online' ? 'bg-emerald-500/70' : s === 'offline' ? 'bg-red-500/70' : s === 'maintenance' ? 'bg-amber-500/70' : 'bg-gray-600/70';
                return (
                  <span
                    key={i}
                    className={`flex-1 rounded-sm ${color}`}
                    title={`${new Date(p.at).toLocaleTimeString('th-TH')} — ${p.status} (${p.players} ผู้เล่น)`}
                  />
                );
              })}
            </div>
            <PlayersChart points={points} range={range} />
          </div>
        )}

        <div className="mt-4 text-[10px] text-gray-600">ข้อมูลจาก API นักข่าว BIT NEWS — bitnewsth.qd.je</div>
      </div>
    </section>
  );
}
