import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { Place } from '../lib/types';
import { categoryTone, placeInitial } from '../lib/utils';

interface PlaceMapProps {
  places: Place[];
  selectedId?: string | null;
  onSelect: (place: Place) => void;
  className?: string;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string));
}

export function PlaceMap({ places, selectedId, onSelect, className }: PlaceMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const placesRef = useRef(places);
  const selectedRef = useRef<string | null>(selectedId ?? null);
  const onSelectRef = useRef(onSelect);
  const fitKeyRef = useRef('');
  const hasFittedRef = useRef(false);

  placesRef.current = places;
  selectedRef.current = selectedId ?? null;
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: false,
      minZoom: 3,
      maxZoom: 18,
    }).setView([34.3, 108.9], 4);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const render = () => {
      if (markersRef.current) renderClusters(map, markersRef.current, placesRef.current, selectedRef.current, onSelectRef.current);
    };
    map.on('moveend zoomend', render);
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(containerRef.current);
    const initialTimer = window.setTimeout(() => {
      if (mapRef.current === map) { map.invalidateSize(); render(); }
    }, 60);

    return () => {
      window.clearTimeout(initialTimer);
      resize.disconnect();
      map.off('moveend zoomend', render);
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = markersRef.current;
    if (!map || !layer) return;
    const located = places.filter((place) => place.location);
    const fitKey = located.map((place) => place.id).join('|');
    renderClusters(map, layer, places, selectedId || null, onSelect);
    if (located.length && (fitKey !== fitKeyRef.current || !hasFittedRef.current)) {
      fitKeyRef.current = fitKey;
      hasFittedRef.current = true;
      const bounds = L.latLngBounds(located.map((place) => [place.location!.lat, place.location!.lng]));
      map.fitBounds(bounds.pad(0.18), { animate: false, maxZoom: 12 });
    }
  }, [places, selectedId, onSelect]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId) return;
    const place = places.find((item) => item.id === selectedId);
    if (!place?.location) return;
    map.flyTo([place.location.lat, place.location.lng], Math.max(map.getZoom(), 11), { duration: 0.65 });
  }, [selectedId, places]);

  return <div ref={containerRef} className={`place-map ${className || ''}`} />;
}

function renderClusters(map: L.Map, layer: L.LayerGroup, places: Place[], selectedId: string | null, onSelect: (place: Place) => void) {
  layer.clearLayers();
  const located = places.filter((place) => place.location);
  if (!located.length) return;
  const zoom = map.getZoom();
  const groups = new Map<string, { places: Place[]; x: number; y: number }>();
  for (const place of located) {
    const projected = map.project([place.location!.lat, place.location!.lng], zoom);
    const key = `${Math.floor(projected.x / 54)}:${Math.floor(projected.y / 54)}`;
    if (!groups.has(key)) groups.set(key, { places: [], x: 0, y: 0 });
    const group = groups.get(key)!;
    group.places.push(place);
    group.x += projected.x;
    group.y += projected.y;
  }

  for (const group of groups.values()) {
    const latlng = map.unproject(L.point(group.x / group.places.length, group.y / group.places.length), zoom);
    if (group.places.length === 1) {
      const place = group.places[0];
      const selected = place.id === selectedId;
      const icon = L.divIcon({
        className: 'tuhe-marker-wrap',
        html: `<div class="map-pin tone-${categoryTone(place.category)} ${selected ? 'is-selected' : ''}"><span>${escapeHtml(placeInitial(place))}</span><i></i></div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 34],
        popupAnchor: [0, -32],
      });
      L.marker(latlng, { icon, keyboard: true, title: place.name })
        .addTo(layer)
        .on('click', () => onSelect(place));
    } else {
      const icon = L.divIcon({
        className: 'tuhe-cluster-wrap',
        html: `<div class="map-cluster"><strong>${group.places.length}</strong><span>个地点</span></div>`,
        iconSize: [54, 54],
        iconAnchor: [27, 27],
      });
      L.marker(latlng, { icon, keyboard: true, title: `${group.places.length} 个地点` })
        .addTo(layer)
        .on('click', () => {
          map.flyTo(latlng, Math.min(map.getZoom() + 2, 15), { duration: 0.55 });
        });
    }
  }
}
