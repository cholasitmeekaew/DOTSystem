import { useEffect, useState } from 'react';
import { DollarSign, Tag, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ServiceRate } from '../../lib/types';
import { FadeIn, Stagger, StaggerItem, Skeleton } from '../../components/animations';



const CATEGORY_LABELS: Record<string, string> = {
  civil_maintenance: 'โยธาซ่อมบำรุง',
  vehicle_rescue: 'กู้ภัยรถยก',
  electrical: 'การไฟฟ้า',
  traffic_management: 'จัดการจราจร',
  emergency_assistance: 'ช่วยเหลือฉุกเฉิน',
  general: 'ทั่วไป',
};

const CATEGORY_ICONS: Record<string, string> = {
  civil_maintenance: '🔧',
  vehicle_rescue: '🚛',
  electrical: '⚡',
  traffic_management: '🚦',
  emergency_assistance: '🚨',
  general: '📋',
};

export function ServiceRatesPublicPage() {
  const [rates, setRates] = useState<ServiceRate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('service_rates')
      .select('*')
      .eq('is_active', true)
      .order('category')
      .order('name')
      .then(({ data }: { data: Record<string, unknown>[] | null }) => {
        setRates((data as unknown as ServiceRate[]) ?? []);
        setLoading(false);
      });
  }, []);

  const grouped = rates.reduce<Record<string, ServiceRate[]>>((acc, r) => {
    if (!acc[r.category]) acc[r.category] = [];
    acc[r.category].push(r);
    return acc;
  }, {});

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      {/* Header */}
      <FadeIn className="text-center mb-10">
        <div className="inline-flex w-16 h-16 bg-teal-900/30 border border-teal-700/40 rounded-2xl items-center justify-center mb-4 anim-float">
          <DollarSign size={28} className="text-teal-400" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">อัตราค่าบริการ</h1>
        <p className="text-gray-400 text-sm">อัตราค่าบริการมาตรฐานของกรมขนส่ง Bit Cities (DOT)</p>
      </FadeIn>

      {loading ? (
        <FadeIn className="space-y-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-6 space-y-3">
              <Skeleton variant="text" width={120} height={16} />
              <Skeleton variant="card" height={48} />
              <Skeleton variant="card" height={48} />
            </div>
          ))}
        </FadeIn>
      ) : Object.keys(grouped).length === 0 ? (
        <FadeIn>
          <div className="card p-16 text-center">
            <AlertCircle size={36} className="text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">ยังไม่มีอัตราค่าบริการ</p>
          </div>
        </FadeIn>
      ) : (
        <Stagger className="space-y-6">
          {Object.entries(grouped).map(([cat, catRates]) => (
            <StaggerItem key={cat}>
              <div className="card overflow-hidden hover-lift">
                {/* Category Header */}
                <div className="px-6 py-4 bg-navy-700/60 border-b border-blue-900/40 flex items-center gap-3">
                  <span className="text-2xl">{CATEGORY_ICONS[cat] ?? '📋'}</span>
                  <div>
                    <h2 className="text-white font-semibold">{CATEGORY_LABELS[cat] ?? cat}</h2>
                    <p className="text-gray-500 text-xs">{catRates.length} รายการบริการ</p>
                  </div>
                </div>

                {/* Rates List */}
                <div className="divide-y divide-blue-900/30">
                  {catRates.map((rate) => (
                    <div key={rate.id} className="flex items-center justify-between px-6 py-4 hover:bg-navy-700/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-teal-500/10 border border-teal-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Tag size={14} className="text-teal-400" />
                        </div>
                        <div>
                          <div className="text-white font-medium text-sm">{rate.name}</div>
                          {rate.description && (
                            <div className="text-gray-500 text-xs mt-0.5">{rate.description}</div>
                          )}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-4">
                        <div className="text-amber-400 font-bold text-lg">
                          {rate.price.toLocaleString('th-TH')}
                        </div>
                        <div className="text-gray-500 text-xs">BC</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </StaggerItem>
          ))}

          {/* Disclaimer */}
          <StaggerItem>
            <div className="flex items-start gap-3 bg-navy-800/60 border border-blue-900/40 rounded-xl p-4 hover-lift">
              <AlertCircle size={15} className="text-gray-500 mt-0.5 flex-shrink-0" />
              <p className="text-gray-500 text-xs leading-relaxed">
                อัตราค่าบริการข้างต้นเป็นราคามาตรฐาน อาจมีการเปลี่ยนแปลงตามดุลยพินิจของหัวหน้ากรม
                กรุณาติดต่อเจ้าหน้าที่ DOT เพื่อสอบถามข้อมูลเพิ่มเติม
              </p>
            </div>
          </StaggerItem>
        </Stagger>
      )}
    </div>
  );
}
