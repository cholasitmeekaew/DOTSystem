interface BarDatum {
  label: string;
  value: number;
  subLabel?: string;
}

/** กราฟแท่งแนวตั้ง SVG — แท่งทองไล่เฉดบนพื้นเข้ม */
export function GoldBarChart({ data, height = 220 }: { data: BarDatum[]; height?: number }) {
  const W = 560;
  const H = height;
  const padL = 44;
  const padB = 30;
  const padT = 16;
  const max = Math.max(1, ...data.map((d) => d.value));
  // เส้นกริด + ป้ายแกน Y (0 / ครึ่ง / เต็ม)
  const ticks = [0, 0.5, 1].map((f) => ({ y: padT + (1 - f) * (H - padT - padB), label: formatTick(max * f) }));
  const n = Math.max(1, data.length);
  const slot = (W - padL - 8) / n;
  const barW = Math.min(44, slot * 0.55);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="กราฟแท่ง">
      <defs>
        <linearGradient id="dot-gold-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#b45309" />
        </linearGradient>
      </defs>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={W - 4} y1={t.y} y2={t.y} stroke="#2b2b33" strokeWidth={1} />
          <text x={padL - 8} y={t.y + 4} textAnchor="end" fontSize={11} fill="#94a3b8">
            {t.label}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const h = Math.max(d.value > 0 ? 4 : 0, (d.value / max) * (H - padT - padB));
        const x = padL + slot * i + (slot - barW) / 2;
        const y = H - padB - h;
        return (
          <g key={i}>
            <title>{`${d.label}: ${d.subLabel ?? d.value.toLocaleString('th-TH')}`}</title>
            <rect x={x} y={y} width={barW} height={h} rx={6} fill="url(#dot-gold-bar)" opacity={d.value > 0 ? 1 : 0.25} />
            <text x={x + barW / 2} y={H - 10} textAnchor="middle" fontSize={12} fill="#94a3b8">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

interface DonutDatum {
  label: string;
  value: number;
  color: string;
}

/** กราฟโดนัท SVG — สัดส่วนพร้อมคำอธิบาย */
export function DonutChart({ data, size = 190 }: { data: DonutDatum[]; size?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const R = 70;
  const C = 2 * Math.PI * R;
  let acc = 0;

  return (
    <div>
      <div className="flex justify-center">
        <svg width={size} height={size} viewBox="0 0 180 180" role="img" aria-label="กราฟโดนัท">
          <circle cx={90} cy={90} r={R} fill="none" stroke="#2b2b33" strokeWidth={26} />
          {total > 0 &&
            data
              .filter((d) => d.value > 0)
              .map((d, i) => {
                const frac = d.value / total;
                const dash = frac * C;
                const offset = -acc * C + C * 0.25;
                acc += frac;
                return (
                  <circle
                    key={i}
                    cx={90}
                    cy={90}
                    r={R}
                    fill="none"
                    stroke={d.color}
                    strokeWidth={26}
                    strokeDasharray={`${Math.max(dash - 2, 1)} ${C - Math.max(dash - 2, 1)}`}
                    strokeDashoffset={offset}
                    strokeLinecap="butt"
                  >
                    <title>{`${d.label}: ${d.value.toLocaleString('th-TH')}`}</title>
                  </circle>
                );
              })}
          <text x={90} y={86} textAnchor="middle" fontSize={24} fontWeight={800} fill="#f8fafc">
            {total.toLocaleString('th-TH')}
          </text>
          <text x={90} y={106} textAnchor="middle" fontSize={11} fill="#94a3b8">
            งานทั้งหมด
          </text>
        </svg>
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {data.map((d, i) => (
          <span key={i} className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: d.color }} />
            {d.label}
            <span className="text-white font-semibold">{d.value.toLocaleString('th-TH')}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function formatTick(v: number) {
  if (v >= 1000) return `${(v / 1000).toLocaleString('th-TH', { maximumFractionDigits: 1 })}k`;
  return Math.round(v).toLocaleString('th-TH');
}
