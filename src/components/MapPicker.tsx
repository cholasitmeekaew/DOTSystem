import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Plus, Minus, RotateCcw, X } from 'lucide-react';

export interface MapPickerValue {
  lat: number;
  lng: number;
  zoom: number;
}

/** แผนที่จาก erlc-tools.com map-api (summer) */
const MAP_STYLE = {
  bounds: [[0, 0], [29700, 29700]] as L.LatLngBoundsLiteral,
  center: [14850, 14850] as L.LatLngTuple,
  minZoom: 1,
  maxZoom: 5,
  maxLevel: 5,
  tileSize: 990,
  url: 'https://erlc-tools.com/map-tiles/summer/z{z}/{x}_{y}.webp',
} as const;

function makeCrs(maxLevel: number) {
  return L.Util.extend({}, L.CRS.Simple, {
    scale: (zoom: number) => Math.pow(2, zoom - maxLevel),
    // y ไม่กลับด้าน — ให้พิกัด lat เพิ่มลงล่างตามแถวของ tile (row-major)
    transformation: (L as any).transformation(1, 0, 1, 0),
  }) as L.CRS;
}

interface MapPickerProps {
  value: MapPickerValue | null;
  onChange: (v: MapPickerValue | null) => void;
  height?: number;
  interactive?: boolean;
  showControls?: boolean;
}

function createPinIcon() {
  return L.divIcon({
    className: 'erlc-pin',
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    html: `
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 4px 6px rgba(0,0,0,0.5));">
        <path d="M12 22s-7-7.5-7-13a7 7 0 1 1 14 0c0 5.5-7 13-7 13z" fill="#ef4444" fill-opacity="0.3" stroke="#ef4444" stroke-width="2.5" stroke-linejoin="round"/>
        <circle cx="12" cy="9" r="2.5" fill="#ef4444"/>
      </svg>
    `,
  });
}

function createSmallPinIcon() {
  return L.divIcon({
    className: 'erlc-pin-sm',
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    html: `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));">
        <path d="M12 22s-7-7.5-7-13a7 7 0 1 1 14 0c0 5.5-7 13-7 13z" fill="#ef4444" fill-opacity="0.3" stroke="#ef4444" stroke-width="2.5" stroke-linejoin="round"/>
        <circle cx="12" cy="9" r="2.5" fill="#ef4444"/>
      </svg>
    `,
  });
}

export function MapPicker({
  value,
  onChange,
  height = 400,
  interactive = true,
  showControls = true,
}: MapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [coordLabel, setCoordLabel] = useState<string>(
    value ? `📍 ${value.lat.toFixed(0)}, ${value.lng.toFixed(0)}` : 'ยังไม่ได้ปักหมุด',
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const style = MAP_STYLE;

    const initialZoom = value?.zoom ?? (style.maxLevel - 1);
    const map = L.map(el, {
      crs: makeCrs(style.maxLevel),
      zoomControl: false,
      attributionControl: false,
      minZoom: style.minZoom,
      maxZoom: style.maxZoom,
      zoomSnap: 0.25,
      wheelPxPerZoomLevel: 90,
      dragging: interactive,
      doubleClickZoom: interactive,
      scrollWheelZoom: true,
      touchZoom: true,
      boxZoom: false,
      keyboard: interactive,
    });
    mapRef.current = map;

    L.tileLayer(style.url, {
      tileSize: style.tileSize,
      minZoom: style.minZoom,
      maxZoom: style.maxZoom,
      maxNativeZoom: style.maxLevel,
      bounds: style.bounds,
      noWrap: true,
      errorTileUrl: '',
    }).addTo(map);

    // พื้นหลังเข้มรองรับกระเบื้องที่ไม่มี (ขอบแผนที่)
    map.getContainer().style.background = '#0a1628';

    if (value) {
      const z = Math.min(Math.max(value.zoom, style.minZoom), style.maxZoom);
      map.setView([value.lat, value.lng], z);
      markerRef.current = L.marker([value.lat, value.lng], { icon: createPinIcon() }).addTo(map);
    } else {
      map.setView(style.center, style.maxLevel - 1);
    }

    if (interactive) {
      map.on('click', (e: L.LeafletMouseEvent) => {
        const { lat, lng } = e.latlng;
        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lng]);
        } else {
          markerRef.current = L.marker([lat, lng], { icon: createPinIcon() }).addTo(map);
        }
        onChangeRef.current({ lat, lng, zoom: map.getZoom() });
      });

      map.on('zoomend', () => {
        const m = markerRef.current;
        if (!m) return;
        const ll = m.getLatLng();
        onChangeRef.current({ lat: ll.lat, lng: ll.lng, zoom: map.getZoom() });
      });
    }

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    requestAnimationFrame(() => map.invalidateSize());

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (value) {
      if (!markerRef.current) {
        markerRef.current = L.marker([value.lat, value.lng], { icon: createPinIcon() }).addTo(map);
      } else {
        markerRef.current.setLatLng([value.lat, value.lng]);
      }
      setCoordLabel(`📍 ${value.lat.toFixed(0)}, ${value.lng.toFixed(0)}`);
    } else if (markerRef.current) {
      map.removeLayer(markerRef.current);
      markerRef.current = null;
      setCoordLabel('ยังไม่ได้ปักหมุด');
    }
  }, [value?.lat, value?.lng]);

  function handleReset() {
    const map = mapRef.current;
    if (!map) return;
    map.setView(MAP_STYLE.center, MAP_STYLE.maxLevel - 1);
    if (value) {
      onChangeRef.current({ ...value, zoom: MAP_STYLE.maxLevel - 1 });
    }
  }

  function handleZoomIn() {
    mapRef.current?.zoomIn();
  }

  function handleZoomOut() {
    mapRef.current?.zoomOut();
  }

  function handleClearPin() {
    const map = mapRef.current;
    if (!map) return;
    if (markerRef.current) {
      map.removeLayer(markerRef.current);
      markerRef.current = null;
    }
    onChangeRef.current(null);
  }

  return (
    <div className="space-y-2">
      <div
        className="relative w-full rounded-xl border-2 border-blue-900/40 bg-navy-900 overflow-hidden isolate"
        style={{ height }}
      >
        <div
          ref={containerRef}
          className="absolute inset-0"
          style={{ cursor: interactive ? 'crosshair' : 'default' }}
        />
        {interactive && showControls && (
          <>
            <div className="absolute top-2 right-2 flex flex-col gap-1.5 z-[400]">
              <button type="button" onClick={handleZoomIn} className="w-8 h-8 bg-navy-800/90 border border-blue-900/50 rounded-lg flex items-center justify-center text-white hover:bg-navy-700 transition-colors" title="ซูมเข้า">
                <Plus size={16} />
              </button>
              <button type="button" onClick={handleZoomOut} className="w-8 h-8 bg-navy-800/90 border border-blue-900/50 rounded-lg flex items-center justify-center text-white hover:bg-navy-700 transition-colors" title="ซูมออก">
                <Minus size={16} />
              </button>
              <button type="button" onClick={handleReset} className="w-8 h-8 bg-navy-800/90 border border-blue-900/50 rounded-lg flex items-center justify-center text-white hover:bg-navy-700 transition-colors" title="รีเซ็ตมุมมอง">
                <RotateCcw size={14} />
              </button>
              {value && (
                <button type="button" onClick={handleClearPin} className="w-8 h-8 bg-red-600/90 border border-red-500/50 rounded-lg flex items-center justify-center text-white hover:bg-red-500 transition-colors" title="ลบหมุด">
                  <X size={16} />
                </button>
              )}
            </div>
            <div className="absolute bottom-2 left-2 px-2 py-1 bg-navy-800/90 border border-blue-900/50 rounded-md text-[10px] text-gray-400 z-[400] pointer-events-none">
              {coordLabel}
            </div>
          </>
        )}
      </div>
      {interactive && showControls && (
        <p className="text-[10px] text-gray-500 text-center">
          คลิกเพื่อปักหมุด · ลากเพื่อเลื่อน · เลื่อนเมาส์วงล้อหรือ +/- เพื่อซูม
        </p>
      )}
    </div>
  );
}

/** Read-only mini map (ใช้ในหน้า officer) */
export function MapPreview({ value, height = 160 }: { value: MapPickerValue; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let map: L.Map | null = null;
    let ro: ResizeObserver | null = null;

    function init() {
      if (!el || map) return;
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      const style = MAP_STYLE;
      map = L.map(el, {
        crs: makeCrs(style.maxLevel),
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        doubleClickZoom: false,
        scrollWheelZoom: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false,
        minZoom: style.minZoom,
        maxZoom: style.maxZoom,
        maxBounds: style.bounds,
        maxBoundsViscosity: 1.0,
      });
      mapRef.current = map;
      L.tileLayer(style.url, {
        tileSize: style.tileSize,
        minZoom: style.minZoom,
        maxZoom: style.maxZoom,
        maxNativeZoom: style.maxLevel,
        bounds: style.bounds,
        noWrap: true,
      }).addTo(map);
      map.fitBounds(style.bounds, { padding: [0, 0] });
      const z = Math.min(Math.max(value.zoom, style.minZoom), style.maxZoom);
      map.setView([value.lat, value.lng], z);
      L.marker([value.lat, value.lng], { icon: createSmallPinIcon(), interactive: false }).addTo(map);
    }

    init();
    ro = new ResizeObserver(() => {
      if (map) {
        map.invalidateSize();
      } else {
        init();
      }
    });
    ro.observe(el);
    requestAnimationFrame(() => {
      if (map) map.invalidateSize();
      else init();
    });

    return () => {
      if (ro) ro.disconnect();
      if (map) map.remove();
      mapRef.current = null;
    };
  }, [value.lat, value.lng, value.zoom]);

  return (
    <div
      ref={containerRef}
      className="relative w-full rounded-lg border border-blue-900/50 bg-navy-900 overflow-hidden isolate"
      style={{ height, minWidth: 1 }}
    />
  );
}
