import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { Minus, Plus, LocateFixed } from 'lucide-react';
import type { FootprintDetail, Place, PlatformId } from '../lib/types';
import { PLATFORM_UI } from '../lib/platforms';
import { categoryTone, placeInitial } from '../lib/utils';

export interface MapLayers {
  footprints: boolean;
  fog: boolean;
  tracks: boolean;
  platforms: Record<PlatformId, boolean>;
  other: boolean;
}

interface FootprintMapProps {
  footprints: FootprintDetail[];
  places?: Place[];
  activeId?: string | null;
  layers: MapLayers;
  className?: string;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string));
}

export function placePlatforms(place: Place): PlatformId[] {
  const linked = (Object.keys(place.links || {}) as PlatformId[]).filter((id) => PLATFORM_UI[id]);
  if (linked.length) return linked;
  const source = place.source?.platform as PlatformId | undefined;
  return source && PLATFORM_UI[source] ? [source] : [];
}

export function isPlaceVisible(place: Place, layers: MapLayers) {
  if (!place.location) return false;
  const platforms = placePlatforms(place);
  if (!platforms.length) return layers.other;
  return platforms.some((id) => layers.platforms[id]);
}

function placeColor(place: Place, layers: MapLayers) {
  const platforms = placePlatforms(place).filter((id) => layers.platforms[id]);
  if (platforms.length) return PLATFORM_UI[platforms[0]].color;
  return '#8b8578';
}

export function FootprintMap({ footprints, places = [], activeId, layers, className }: FootprintMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const fogLayerRef = useRef<L.LayerGroup | null>(null);
  const placeLayerRef = useRef<L.LayerGroup | null>(null);
  const fitKeyRef = useRef('');

  const fitToData = () => {
    const map = mapRef.current;
    if (!map) return;
    const bounds = L.latLngBounds([]);
    for (const footprint of footprints) {
      if (!layers.footprints) break;
      if (activeId && footprint.id !== activeId) continue;
      if (footprint.format === 'fwss' ? !layers.fog : !layers.tracks) continue;
      for (const track of footprint.tracks) {
        for (const point of track.points) bounds.extend([point.lat, point.lng]);
      }
    }
    for (const place of places) {
      if (isPlaceVisible(place, layers) && place.location) bounds.extend([place.location.lat, place.location.lng]);
    }
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.12), { animate: false, maxZoom: 12 });
      window.setTimeout(() => { if (mapRef.current === map) map.invalidateSize(); }, 60);
    } else {
      map.setView([34.3, 108.9], 4);
    }
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: false,
      minZoom: 2,
      maxZoom: 18,
    }).setView([34.3, 108.9], 4);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    fogLayerRef.current = L.layerGroup().addTo(map);
    placeLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(containerRef.current);
    return () => {
      resize.disconnect();
      map.remove();
      mapRef.current = null;
      fogLayerRef.current = null;
      placeLayerRef.current = null;
      fitKeyRef.current = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const fogLayer = fogLayerRef.current;
    const placeLayer = placeLayerRef.current;
    if (!map || !fogLayer || !placeLayer) return;

    fogLayer.clearLayers();
    placeLayer.clearLayers();

    if (layers.footprints) {
      const activePointCount = footprints.filter((item) => !activeId || item.id === activeId)
        .reduce((sum, item) => sum + item.tracks.reduce((n, track) => n + track.points.length, 0), 0);
      const ordered = [...footprints].sort((a, b) => Number(a.format === 'fwss') - Number(b.format === 'fwss'));
      for (const footprint of ordered) {
        const active = !activeId || footprint.id === activeId;
        const fog = footprint.format === 'fwss';
        if (fog ? !layers.fog : !layers.tracks) continue;
        if (activeId && footprint.id !== activeId) continue;
        for (const track of footprint.tracks) {
          if (!track.points.length) continue;
          const latlngs = track.points.map((point) => [point.lat, point.lng] as [number, number]);
          if (latlngs.length === 1) {
            L.circleMarker(latlngs[0], fog ? {
              radius: 2.8,
              stroke: false,
              fillColor: '#2f7a63',
              fillOpacity: active ? 0.42 : 0.24,
            } : {
              radius: 4,
              color: active ? '#b95432' : '#b9aa9a',
              weight: active ? 1.5 : 1,
              fillColor: active ? '#d4744f' : '#c9beb1',
              fillOpacity: 0.72,
            }).addTo(fogLayer);
          } else {
            if (active) L.polyline(latlngs, { color: '#dba17f', weight: 9, opacity: 0.2, lineCap: 'round' }).addTo(fogLayer);
            L.polyline(latlngs, {
              color: active ? '#b95432' : '#b9aa9a',
              weight: active ? 3 : 1.3,
              opacity: active ? 0.95 : 0.4,
              lineCap: 'round',
              lineJoin: 'round',
            }).addTo(fogLayer);
            if (active) {
              L.circleMarker(latlngs[0], { radius: 4, color: '#fff', weight: 1.5, fillColor: '#3f7c61', fillOpacity: 1 }).addTo(fogLayer);
              L.circleMarker(latlngs[latlngs.length - 1], { radius: 4, color: '#fff', weight: 1.5, fillColor: '#cf603a', fillOpacity: 1 }).addTo(fogLayer);
              if (activePointCount <= 3000) {
                for (const point of track.points) {
                  L.circleMarker([point.lat, point.lng], { radius: 1.7, color: '#a94428', weight: 0, fillColor: '#c65c39', fillOpacity: 0.64 }).addTo(fogLayer);
                }
              }
            }
          }
        }
      }
    }

    for (const place of places) {
      if (!isPlaceVisible(place, layers) || !place.location) continue;
      const color = placeColor(place, layers);
      const platforms = placePlatforms(place);
      const platformChips = platforms.map((id) => `<span><i style="background:${PLATFORM_UI[id].color}"></i>${escapeHtml(PLATFORM_UI[id].shortName)}</span>`).join('');
      const icon = L.divIcon({
        className: 'fog-place-marker',
        html: `<div class="fog-place-pin tone-${categoryTone(place.category)}" style="--pin:${color}"><span>${escapeHtml(placeInitial(place))}</span></div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        popupAnchor: [0, -13],
      });
      L.marker([place.location.lat, place.location.lng], { icon, keyboard: true, title: place.name })
        .addTo(placeLayer)
        .bindTooltip(escapeHtml(place.name), { direction: 'top', offset: [0, -10], className: 'fog-place-tip' })
        .bindPopup(
          `<div class="fog-place-popup"><strong>${escapeHtml(place.name)}</strong>` +
          `<small>${escapeHtml([place.city, place.district, place.category].filter(Boolean).join(' · ') || '未填写城市')}</small>` +
          `<p>${escapeHtml(place.address || '')}</p>` +
          `<div class="fog-popup-platforms">${platformChips}</div></div>`,
          { closeButton: false, offset: [0, -4], className: 'fog-place-popup-wrap' },
        );
    }

    const dataKey = `${footprints.map((item) => item.id).join(',')}|${places.map((item) => item.id).join(',')}|${activeId || ''}|${layers.fog ? 1 : 0}${layers.tracks ? 1 : 0}`;
    if (dataKey !== fitKeyRef.current) {
      fitKeyRef.current = dataKey;
      fitToData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [footprints, places, activeId, layers]);

  const zoom = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    if (delta > 0) map.zoomIn(); else map.zoomOut();
  };

  return (
    <div className={`place-map footprint-map ${className || ''}`}>
      <div ref={containerRef} className="footprint-map-canvas" />
      <div className="map-zoom-controls">
        <button type="button" onClick={() => zoom(1)} aria-label="放大地图" title="放大"><Plus size={16} /></button>
        <button type="button" onClick={() => zoom(-1)} aria-label="缩小地图" title="缩小"><Minus size={16} /></button>
        <button type="button" onClick={fitToData} aria-label="重置视野" title="重置视野"><LocateFixed size={15} /></button>
      </div>
    </div>
  );
}
