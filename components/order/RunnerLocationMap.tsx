'use client'

import { APIProvider, Map, AdvancedMarker } from '@vis.gl/react-google-maps'

// ─── THE RUNNER DOT — one marker, and nothing it cannot prove ────────────────────────────────
//
// Renders the live runner position for the owning customer. It is deliberately NOT a
// rideshare-style tracking view: there is no route line, no ETA, and no destination pin, because
// none of those can be drawn from data this app has. `Order` carries deliveryStreet/City/State/
// Zip and no destination lat/lng, and nothing here calls Directions. Drawing a route would mean
// inventing one.
//
// ⛔ NO MARKER WITHOUT A FIX. This component is only rendered once a real coordinate exists —
// the caller owns that branch. It has no default centre, no "probably at the vendor booth"
// fallback, and no placeholder pin. A dot on a map is read as fact; a wrong one is worse than an
// empty panel (scripts/flicker-class-guard.ts — a skeleton is fine, anything that looks like
// real data is not).
//
// ⛔ THE HONESTY SIGNALS TRAVEL WITH THE DOT. On a map an old fix looks exactly like a live one,
// which is precisely why the text version showed accuracy and staleness — so they are rendered
// ON the map, not dropped in the upgrade:
//   • accuracy → an actual circle at the reported radius, so ±120m LOOKS like ±120m rather than
//     hiding behind a pin drawn at a single point.
//   • staleness → the marker desaturates and the caption goes amber past the threshold.
//
// This file is 'use client' and must stay free of any server-only import (lib/db, prisma,
// stripe, …) — see CURRENT_STATE.md §7: a server-only module reachable from a client entry
// point passes every suite and dies on first page load.

/** Metres-per-pixel at a given latitude and zoom, for sizing the accuracy circle in CSS px. */
function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom)
}

const ZOOM = 16

export default function RunnerLocationMap({
  lat,
  lng,
  accuracy,
  stale,
}: {
  lat: number
  lng: number
  accuracy: number | null
  stale: boolean
}) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''
  // No key → no map. The caller still renders the coordinate line and the honesty signals, so
  // this degrades to exactly the pre-map surface rather than to a broken grey box.
  if (!apiKey) return null

  // Accuracy circle sized in CSS pixels for this latitude/zoom. Clamped so a very precise fix
  // still shows a visible dot and a very poor one cannot swallow the panel — the clamp is
  // cosmetic only; the numeric ±Nm is always printed by the caller.
  const radiusPx = accuracy != null && accuracy > 0
    ? Math.min(140, Math.max(10, accuracy / metresPerPixel(lat, ZOOM)))
    : null

  return (
    <div className="relative w-full h-48 rounded-xl overflow-hidden border border-white/5">
      <APIProvider apiKey={apiKey}>
        <Map
          defaultCenter={{ lat, lng }}
          center={{ lat, lng }}
          defaultZoom={ZOOM}
          gestureHandling="greedy"
          disableDefaultUI
          mapId="runner-location-map"
          className="w-full h-full"
        >
          <AdvancedMarker position={{ lat, lng }}>
            <div className="relative flex items-center justify-center">
              {radiusPx != null && (
                <span
                  aria-hidden
                  className={`absolute rounded-full ${stale ? 'bg-amber-400/10 border border-amber-400/25' : 'bg-[#FF0077]/10 border border-[#FF0077]/30'}`}
                  style={{ width: radiusPx * 2, height: radiusPx * 2 }}
                />
              )}
              <span
                className={`relative w-3.5 h-3.5 rounded-full border-2 border-white shadow ${stale ? 'bg-amber-400' : 'bg-[#FF0077]'}`}
              />
            </div>
          </AdvancedMarker>
        </Map>
      </APIProvider>
    </div>
  )
}
