import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Plus, Minus, RotateCcw, X } from 'lucide-react';

export interface MapPickerValue {
  lat: number;
  lng: number;
  zoom: number;
}

/** Bounds ของภาพ ERLC bitmap ในระบบพิกัดโลก (south, west → north, east) */
export const MAP_BOUNDS: L.LatLngBoundsLiteral = [
  [13.5, 100.3],
  [14.0, 100.9],
];

const MAP_CENTER: L.LatLngTuple = [13.75, 100.6];

const MIN_ZOOM = 11;
const MAX_ZOOM = 17;
const DEFAULT_ZOOM = 13;

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
    value ? `📍 ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` : 'ยังไม่ได้ปักหมุด',
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const initialZoom = value?.zoom ?? DEFAULT_ZOOM;
    const map = L.map(el, {
      crs: L.CRS.EPSG3857,
      zoomControl: false,
      attributionControl: false,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      maxBounds: MAP_BOUNDS,
      maxBoundsViscosity: 1.0,
      zoomSnap: 0.25,
      wheelPxPerZoomLevel: 120,
      dragging: interactive,
      doubleClickZoom: false,
      scrollWheelZoom: false,
      touchZoom: false,
      boxZoom: false,
      keyboard: interactive,
    });
    mapRef.current = map;

    L.imageOverlay(MAP_IMAGE_URL, MAP_BOUNDS).addTo(map);

    if (value) {
      map.setView([value.lat, value.lng], initialZoom);
      markerRef.current = L.marker([value.lat, value.lng], { icon: createPinIcon() }).addTo(map);
    } else {
      map.setView(MAP_CENTER, initialZoom);
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
      setCoordLabel(`📍 ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}`);
    } else if (markerRef.current) {
      map.removeLayer(markerRef.current);
      markerRef.current = null;
      setCoordLabel('ยังไม่ได้ปักหมุด');
    }
  }, [value?.lat, value?.lng]);

  function handleReset() {
    const map = mapRef.current;
    if (!map) return;
    map.setView(MAP_CENTER, DEFAULT_ZOOM);
    if (value) {
      onChangeRef.current({ ...value, zoom: DEFAULT_ZOOM });
    }
  }

  function handleZoomIn() {
    const map = mapRef.current;
    if (!map) return;
    map.zoomIn();
  }

  function handleZoomOut() {
    const map = mapRef.current;
    if (!map) return;
    map.zoomOut();
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
          คลิกเพื่อปักหมุด · ลากเพื่อเลื่อน · ใช้ปุ่ม +/- ซูม
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
      map = L.map(el, {
        crs: L.CRS.EPSG3857,
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        doubleClickZoom: false,
        scrollWheelZoom: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false,
      });
      mapRef.current = map;
      L.imageOverlay(MAP_IMAGE_URL, MAP_BOUNDS).addTo(map);
      map.fitBounds(MAP_BOUNDS, { padding: [0, 0] });
      map.setView([value.lat, value.lng], value.zoom);
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

export const MAP_IMAGE_URL = 'https://robloxbot-team.sirv.com/privately/ER%3ALC/erlc-bitmap.png';
