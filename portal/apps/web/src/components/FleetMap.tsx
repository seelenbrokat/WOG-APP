'use client';

import { useEffect, useRef } from 'react';
import type { Map as LeafletMap, Marker } from 'leaflet';

export type FleetVehicle = {
  id: string;
  number: string | null;
  licensePlate: string | null;
  matchcode: string | null;
  latitude: number | null;
  longitude: number | null;
  locationAt: string | null;
  locationSource?: string | null;
  driverId: string | null;
  driverName?: string | null;
  statusText?: string | null;
  address?: string | null;
  tour: {
    id: string;
    tourNumber: string;
    status: string;
    telematicsStatus: string | null;
    driverName: string | null;
  } | null;
};

function fmt(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function esc(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function driverLabel(v: FleetVehicle) {
  return (v.driverName || v.tour?.driverName || '').trim();
}

export function FleetMap({ vehicles }: { vehicles: FleetVehicle[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<Marker[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function setup() {
      if (!containerRef.current) return;
      const L = await import('leaflet');
      // CSS via CDN once
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link');
        link.id = 'leaflet-css';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }

      if (cancelled) return;

      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current, {
          zoomControl: true,
          attributionControl: true,
        }).setView([47.35, 9.55], 9);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18,
          attribution: '&copy; OpenStreetMap',
        }).addTo(mapRef.current);
      }

      const map = mapRef.current;
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];

      const points: [number, number][] = [];

      for (const v of vehicles) {
        if (v.latitude == null || v.longitude == null) continue;
        const latlng: [number, number] = [v.latitude, v.longitude];
        points.push(latlng);
        const plate = v.licensePlate || v.number || v.matchcode || v.id;
        const name = driverLabel(v);
        const label = name || plate;
        const isMtrack = (v.locationSource || '').toLowerCase() === 'mtrack';
        const sourceClass = isMtrack ? ' fleet-marker-dot--mtrack' : '';
        const sourceLabel = isMtrack ? 'mTrack' : 'VLB-Zustellapp';
        const icon = L.divIcon({
          className: 'fleet-marker',
          html: `<div class="fleet-marker-wrap"><span class="fleet-marker-dot${sourceClass}"></span><span class="fleet-marker-label">${esc(label)}</span></div>`,
          iconSize: [120, 36],
          iconAnchor: [9, 9],
        });
        const tourLine = v.tour
          ? `Tour ${v.tour.tourNumber}${v.tour.telematicsStatus ? ` · ${v.tour.telematicsStatus}` : ''}`
          : isMtrack
            ? v.statusText || 'mTrack GPS'
            : 'Keine aktive Tour';
        const popupName = name ? `<div>${esc(name)}</div>` : '';
        const addr = v.address ? `<div style="color:#5e6f65">${esc(v.address)}</div>` : '';
        const marker = L.marker(latlng, { icon, title: name ? `${name} · ${plate}` : plate }).addTo(
          map,
        );
        marker.bindPopup(
          `<strong>${esc(plate)}</strong>${popupName}<br/>${esc(tourLine)}${addr}<br/><span style="color:#5e6f65">${esc(sourceLabel)} · ${fmt(v.locationAt)}</span>`,
        );
        markersRef.current.push(marker);
      }

      if (points.length === 1) {
        map.setView(points[0], 11);
      } else if (points.length > 1) {
        map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 12 });
      }

      setTimeout(() => map.invalidateSize(), 80);
    }

    void setup();
    return () => {
      cancelled = true;
    };
  }, [vehicles]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="fleet-map" />;
}
