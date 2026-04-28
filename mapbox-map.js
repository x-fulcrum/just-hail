/* Just Hail · Mapbox helper module
 * ----------------------------------------------------------------
 * Loaded as a classic <script> tag from admin.html. Exposes a single
 * global namespace `JHMap` with helpers that wrap Mapbox GL JS v3:
 *
 *   JHMap.init({ token })          — call once on page load
 *   JHMap.create(host, opts)       — create a 3D Mapbox map in `host`
 *   JHMap.addPolygon(map, poly)    — add a campaign polygon outline
 *   JHMap.addPolygons(map, polys)  — add many at once with palette
 *   JHMap.addRainRadar(map)        — toggle live rain-radar overlay
 *   JHMap.addIhmSwaths(map, polys) — render IHM hail-swath polygons
 *   JHMap.fitBounds(map, polys)    — auto-fit the camera
 *
 * Why a wrapper?
 *  - Three different map call-sites in admin.html need the same 3D
 *    chrome (terrain + buildings + atmosphere). Wrapping = one place
 *    to tune the visuals.
 *  - Lets us swap providers later without rewriting admin.html.
 *
 * Mapbox GL v3 Standard style already includes 3D buildings + terrain
 * + lighting + atmosphere by default — we just turn the dials and add
 * our own data layers on top.
 */

(function () {
  'use strict';

  const NS = (window.JHMap = window.JHMap || {});

  let _token = null;
  let _ready = false;
  let _readyResolvers = [];

  // ──────────────────────────────────────────────────────────────
  // Init — called once on page load with the public Mapbox token.
  // Lazy-loads Mapbox GL JS + CSS if not already loaded.
  // ──────────────────────────────────────────────────────────────
  NS.init = function init({ token }) {
    if (_ready) return Promise.resolve();
    _token = token;
    if (!_token) {
      console.warn('[JHMap] no token — maps will fall back to Leaflet');
      return Promise.reject(new Error('no_mapbox_token'));
    }

    return new Promise((resolve, reject) => {
      // Load CSS if missing
      if (!document.querySelector('link[data-jh-mapbox-css]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.css';
        link.setAttribute('data-jh-mapbox-css', '1');
        document.head.appendChild(link);
      }
      // Load JS if missing
      if (window.mapboxgl) {
        window.mapboxgl.accessToken = _token;
        _ready = true;
        _readyResolvers.forEach((r) => r());
        _readyResolvers = [];
        return resolve();
      }
      const script = document.createElement('script');
      script.src = 'https://api.mapbox.com/mapbox-gl-js/v3.6.0/mapbox-gl.js';
      script.async = true;
      script.onload = () => {
        window.mapboxgl.accessToken = _token;
        _ready = true;
        _readyResolvers.forEach((r) => r());
        _readyResolvers = [];
        resolve();
      };
      script.onerror = () => reject(new Error('mapbox_script_load_failed'));
      document.head.appendChild(script);
    });
  };

  NS.ready = function ready() {
    if (_ready) return Promise.resolve();
    return new Promise((r) => _readyResolvers.push(r));
  };

  NS.isReady = function isReady() {
    return _ready;
  };

  // ──────────────────────────────────────────────────────────────
  // Create a fully-loaded 3D Mapbox map.
  // opts:
  //   center: [lng, lat]      default Texas centroid
  //   zoom: number            default 5
  //   pitch: number           default 60 (3D tilt)
  //   bearing: number         default -10
  //   style: string           default 'mapbox://styles/mapbox/standard'
  //   terrain: boolean        default true (DEM exaggeration)
  //   buildings: boolean      default true (3D building extrusion)
  //   sky: boolean            default true (atmosphere)
  //   navControl: boolean     default true
  //   scrollZoom: boolean     default true
  //   projection: string      default 'globe' (zooms behave better at scale)
  //   lightPreset: string     'day'|'dawn'|'dusk'|'night'  default 'day'
  // ──────────────────────────────────────────────────────────────
  NS.create = async function create(host, opts = {}) {
    await NS.ready();
    if (typeof host === 'string') host = document.querySelector(host);
    if (!host) throw new Error('JHMap.create: missing host element');

    // Mapbox needs an explicit height — apply a sensible default if the
    // host has none, so we don't end up with a 0-px-tall canvas.
    if (host.style.height === '' && host.offsetHeight === 0) {
      host.style.height = '500px';
    }

    const mapOpts = {
      container: host,
      style: opts.style || 'mapbox://styles/mapbox/standard',
      center: opts.center || [-97.5, 31.5],   // central Texas default
      zoom: opts.zoom != null ? opts.zoom : 5,
      pitch: opts.pitch != null ? opts.pitch : 60,
      bearing: opts.bearing != null ? opts.bearing : -10,
      antialias: true,
      projection: opts.projection || 'globe',
      attributionControl: opts.attribution !== false,
      scrollZoom: opts.scrollZoom !== false,
      hash: false,
      maxPitch: 85,
    };

    const map = new window.mapboxgl.Map(mapOpts);

    // Standard-style preset (Mapbox v3 only — silently ignored on legacy styles)
    map.on('style.load', () => {
      try {
        if (opts.lightPreset && map.setConfigProperty) {
          map.setConfigProperty('basemap', 'lightPreset', opts.lightPreset);
        }
        if (opts.showPlaceLabels === false && map.setConfigProperty) {
          map.setConfigProperty('basemap', 'showPlaceLabels', false);
        }
        if (opts.showRoadLabels === false && map.setConfigProperty) {
          map.setConfigProperty('basemap', 'showRoadLabels', false);
        }
      } catch (e) { /* not Standard style — that's fine */ }

      // 3D terrain via DEM (Standard already shows terrain, but we add the
      // explicit source for older styles + to expose terrain.exaggeration)
      if (opts.terrain !== false) {
        if (!map.getSource('mapbox-dem')) {
          map.addSource('mapbox-dem', {
            type: 'raster-dem',
            url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
            tileSize: 512,
            maxzoom: 14,
          });
        }
        map.setTerrain({ source: 'mapbox-dem', exaggeration: opts.terrainExaggeration || 1.4 });
      }

      // Atmospheric haze + sky — Standard style already does this; this
      // is a no-op there but a meaningful add on legacy / custom styles.
      if (opts.sky !== false) {
        try {
          map.setFog({
            color: 'rgb(186, 210, 235)',
            'high-color': 'rgb(36, 92, 223)',
            'horizon-blend': 0.05,
            'space-color': 'rgb(11, 11, 25)',
            'star-intensity': 0.4,
          });
        } catch (e) { /* style doesn't support fog */ }
      }

      // 3D buildings — only meaningful on legacy styles since Standard
      // ships them by default. Probe for the composite source first;
      // gracefully no-op if it's not there.
      if (opts.buildings !== false) {
        const src = map.getSource('composite');
        if (src && !map.getLayer('jh-3d-buildings')) {
          // Find the first symbol layer so building extrusions render
          // BELOW labels (Mapbox best practice).
          const layers = map.getStyle().layers || [];
          const labelLayer = layers.find((l) => l.type === 'symbol' && l.layout?.['text-field']);
          map.addLayer({
            id: 'jh-3d-buildings',
            source: 'composite',
            'source-layer': 'building',
            filter: ['==', 'extrude', 'true'],
            type: 'fill-extrusion',
            minzoom: 14,
            paint: {
              'fill-extrusion-color': '#a3a3b8',
              'fill-extrusion-height': [
                'interpolate', ['linear'], ['zoom'],
                14, 0,
                15.05, ['get', 'height'],
              ],
              'fill-extrusion-base': [
                'interpolate', ['linear'], ['zoom'],
                14, 0,
                15.05, ['get', 'min_height'],
              ],
              'fill-extrusion-opacity': 0.85,
            },
          }, labelLayer?.id);
        }
      }
    });

    if (opts.navControl !== false) {
      map.addControl(new window.mapboxgl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right');
    }
    if (opts.fullscreen !== false) {
      map.addControl(new window.mapboxgl.FullscreenControl(), 'top-right');
    }
    if (opts.scale !== false) {
      map.addControl(new window.mapboxgl.ScaleControl({ unit: 'imperial' }), 'bottom-left');
    }

    return map;
  };

  // ──────────────────────────────────────────────────────────────
  // Add a single polygon (campaign drawer use case)
  // poly: [{lat, lng}, ...]  outline: hex
  // ──────────────────────────────────────────────────────────────
  NS.addPolygon = function addPolygon(map, poly, opts = {}) {
    if (!poly || !poly.length) return null;
    const id = opts.id || `poly-${Math.random().toString(36).slice(2, 8)}`;
    const ring = poly.map((p) => [p.lng, p.lat]);
    if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
      ring.push(ring[0]);
    }
    const feature = {
      type: 'Feature',
      properties: opts.properties || {},
      geometry: { type: 'Polygon', coordinates: [ring] },
    };

    const apply = () => {
      if (map.getSource(id)) {
        map.getSource(id).setData(feature);
        return;
      }
      map.addSource(id, { type: 'geojson', data: feature });
      // Fill (semi-transparent)
      map.addLayer({
        id: `${id}-fill`,
        type: 'fill',
        source: id,
        paint: {
          'fill-color': opts.color || '#e94f37',
          'fill-opacity': opts.fillOpacity != null ? opts.fillOpacity : 0.18,
        },
      });
      // Outline
      map.addLayer({
        id: `${id}-line`,
        type: 'line',
        source: id,
        paint: {
          'line-color': opts.color || '#e94f37',
          'line-width': opts.lineWidth || 2.5,
        },
      });
      // Optional 3D extrusion at high zooms — visualizes the polygon as a "claim zone"
      if (opts.extrude) {
        map.addLayer({
          id: `${id}-extrude`,
          type: 'fill-extrusion',
          source: id,
          paint: {
            'fill-extrusion-color': opts.color || '#e94f37',
            'fill-extrusion-height': opts.extrudeHeight || 80,
            'fill-extrusion-opacity': 0.25,
          },
        });
      }
      // Click handler → popup
      if (opts.popupHtml) {
        map.on('click', `${id}-fill`, (e) => {
          new window.mapboxgl.Popup({ closeOnClick: true })
            .setLngLat(e.lngLat)
            .setHTML(opts.popupHtml)
            .addTo(map);
        });
        map.on('mouseenter', `${id}-fill`, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', `${id}-fill`, () => (map.getCanvas().style.cursor = ''));
      }
    };

    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);

    return id;
  };

  // ──────────────────────────────────────────────────────────────
  // Add many polygons at once (overview map of all campaigns)
  // polys: [{ id, points: [{lat,lng}], color, name, ... }]
  // ──────────────────────────────────────────────────────────────
  NS.addPolygons = function addPolygons(map, polys, opts = {}) {
    const features = polys.map((p) => {
      const ring = (p.points || p.polygon || []).map((pt) => [pt.lng, pt.lat]);
      if (!ring.length) return null;
      if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
        ring.push(ring[0]);
      }
      return {
        type: 'Feature',
        properties: { ...p, color: p.color || '#5fa8ff' },
        geometry: { type: 'Polygon', coordinates: [ring] },
      };
    }).filter(Boolean);

    const sourceId = opts.sourceId || 'jh-campaign-polygons';
    const apply = () => {
      const data = { type: 'FeatureCollection', features };
      if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData(data);
        return;
      }
      map.addSource(sourceId, { type: 'geojson', data });
      map.addLayer({
        id: `${sourceId}-fill`,
        type: 'fill',
        source: sourceId,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.22,
        },
      });
      map.addLayer({
        id: `${sourceId}-line`,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2.2,
        },
      });
      if (opts.onClick) {
        map.on('click', `${sourceId}-fill`, (e) => {
          if (e.features?.[0]) opts.onClick(e.features[0].properties, e.lngLat);
        });
        map.on('mouseenter', `${sourceId}-fill`, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', `${sourceId}-fill`, () => (map.getCanvas().style.cursor = ''));
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
    return sourceId;
  };

  // ──────────────────────────────────────────────────────────────
  // IHM hail swath polygons — color-coded by severity layer (l field)
  // polys: [{ sizeTier, ring, layer, points }]
  // ──────────────────────────────────────────────────────────────
  const SWATH_COLOR = { 0: '#ffd700', 1: '#ff6200', 2: '#8b00ff' };

  NS.addIhmSwaths = function addIhmSwaths(map, polys, opts = {}) {
    const sourceId = opts.sourceId || 'jh-ihm-swaths';
    const features = polys.map((p, i) => {
      const ring = (p.points || []).map((pt) => [pt.lng, pt.lat]);
      if (ring.length < 3) return null;
      if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
        ring.push(ring[0]);
      }
      return {
        type: 'Feature',
        id: i,
        properties: {
          sizeTier: p.sizeTier ?? null,
          ring: p.ring ?? null,
          layer: p.layer ?? null,
          color: SWATH_COLOR[Number(p.layer)] || '#888',
          severity: ['Light', 'Moderate', 'Heavy'][Number(p.layer)] || 'Unknown',
        },
        geometry: { type: 'Polygon', coordinates: [ring] },
      };
    }).filter(Boolean);

    const data = { type: 'FeatureCollection', features };
    const apply = () => {
      if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData(data);
      } else {
        map.addSource(sourceId, { type: 'geojson', data });
        map.addLayer({
          id: `${sourceId}-fill`,
          type: 'fill',
          source: sourceId,
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': opts.opacity != null ? opts.opacity : 0.35,
          },
        });
        map.addLayer({
          id: `${sourceId}-line`,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 1.2,
          },
        });
        map.on('click', `${sourceId}-fill`, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          new window.mapboxgl.Popup({ closeOnClick: true })
            .setLngLat(e.lngLat)
            .setHTML(`
              <div style="color:#111;font-size:12px;line-height:1.5;font-family:system-ui;">
                <strong style="display:inline-block;padding:2px 8px;background:${f.properties.color};color:#111;border-radius:2px;margin-bottom:4px;">${f.properties.severity} hail</strong>
                <div>Storm cluster #${f.properties.sizeTier ?? '—'} · ring ${f.properties.ring ?? '—'}</div>
              </div>
            `).addTo(map);
        });
        map.on('mouseenter', `${sourceId}-fill`, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', `${sourceId}-fill`, () => (map.getCanvas().style.cursor = ''));
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);

    return {
      sourceId,
      remove: () => {
        ['fill', 'line'].forEach((suf) => {
          if (map.getLayer(`${sourceId}-${suf}`)) map.removeLayer(`${sourceId}-${suf}`);
        });
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      },
      setOpacity: (v) => {
        if (map.getLayer(`${sourceId}-fill`)) map.setPaintProperty(`${sourceId}-fill`, 'fill-opacity', v);
      },
    };
  };

  // ──────────────────────────────────────────────────────────────
  // Live rain radar overlay via RainViewer (free, no auth).
  // We pull the latest frame manifest, then add the most recent radar
  // tileset as a raster source. Auto-refreshes every 5 min.
  // ──────────────────────────────────────────────────────────────
  const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';

  NS.addRainRadar = async function addRainRadar(map, opts = {}) {
    const sourceId = opts.sourceId || 'jh-rain-radar';
    const layerId = `${sourceId}-layer`;
    let timer = null;

    async function refresh() {
      let manifest;
      try {
        const res = await fetch(RAINVIEWER_API, { cache: 'no-store' });
        manifest = await res.json();
      } catch (err) {
        console.warn('[JHMap] rainviewer fetch failed:', err.message);
        return;
      }
      // Use the most-recent past frame (most current = last in `radar.past`)
      const frames = manifest?.radar?.past || [];
      if (!frames.length) return;
      const latest = frames[frames.length - 1];
      const host = manifest.host;
      // Color scheme 2 = Universal Blue→Red, smoothed=1, snow=1
      const tileTpl = `${host}${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;

      if (map.getSource(sourceId)) {
        // Mapbox doesn't allow swapping a raster source's tiles in place;
        // remove & re-add cleanly.
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        map.removeSource(sourceId);
      }
      map.addSource(sourceId, {
        type: 'raster',
        tiles: [tileTpl],
        tileSize: 256,
        attribution: 'Radar © <a href="https://rainviewer.com">RainViewer</a>',
      });

      // Insert ABOVE the basemap but BELOW labels & 3D buildings so the
      // rain doesn't paint over street names or building extrusions.
      const layers = map.getStyle().layers || [];
      const beforeId =
        layers.find((l) => l.id === 'jh-3d-buildings')?.id ||
        layers.find((l) => l.type === 'symbol' && l.layout?.['text-field'])?.id;

      map.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: {
          'raster-opacity': opts.opacity != null ? opts.opacity : 0.7,
          'raster-fade-duration': 0,
        },
      }, beforeId);
    }

    const apply = async () => {
      await refresh();
      if (opts.autoRefreshMs !== 0) {
        timer = setInterval(refresh, opts.autoRefreshMs || 5 * 60 * 1000);
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);

    return {
      sourceId,
      layerId,
      refresh,
      setOpacity: (v) => {
        if (map.getLayer(layerId)) map.setPaintProperty(layerId, 'raster-opacity', v);
      },
      remove: () => {
        if (timer) clearInterval(timer);
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      },
    };
  };

  // ──────────────────────────────────────────────────────────────
  // Auto-fit camera to a list of polygons (uses GeoJSON BBox)
  // ──────────────────────────────────────────────────────────────
  NS.fitBounds = function fitBounds(map, polys, opts = {}) {
    let minLat = Infinity, minLng = Infinity, maxLat = -Infinity, maxLng = -Infinity;
    for (const p of polys) {
      const points = p.points || p.polygon || (Array.isArray(p) ? p : []);
      for (const pt of points) {
        if (typeof pt.lat === 'number' && typeof pt.lng === 'number') {
          if (pt.lat < minLat) minLat = pt.lat;
          if (pt.lat > maxLat) maxLat = pt.lat;
          if (pt.lng < minLng) minLng = pt.lng;
          if (pt.lng > maxLng) maxLng = pt.lng;
        }
      }
    }
    if (!isFinite(minLat)) return;
    const apply = () => {
      map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
        padding: opts.padding || 60,
        duration: opts.duration != null ? opts.duration : 1500,
        pitch: opts.pitch != null ? opts.pitch : 60,
        bearing: opts.bearing != null ? opts.bearing : -10,
      });
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  };

  // ──────────────────────────────────────────────────────────────
  // Convenience — drop a hail-impact pin (pulses by size).
  // ──────────────────────────────────────────────────────────────
  NS.addHailPin = function addHailPin(map, { lat, lng, sizeIn, html }) {
    const el = document.createElement('div');
    const size = Math.max(8, Math.min(40, 8 + (sizeIn || 0.5) * 8));
    el.style.cssText = `
      width: ${size}px; height: ${size}px;
      background: ${hailSizeColor(sizeIn)};
      border: 2px solid rgba(0,0,0,0.4);
      border-radius: 50%;
      box-shadow: 0 0 12px rgba(255,255,255,0.4);
      cursor: pointer;
    `;
    const marker = new window.mapboxgl.Marker(el).setLngLat([lng, lat]);
    if (html) {
      const popup = new window.mapboxgl.Popup({ offset: size / 2 + 4 }).setHTML(html);
      marker.setPopup(popup);
    }
    marker.addTo(map);
    return marker;
  };

  function hailSizeColor(sizeIn) {
    const s = parseFloat(sizeIn) || 0;
    if (s >= 2.5) return '#8b00ff';
    if (s >= 1.75) return '#ff0040';
    if (s >= 1.0) return '#ff6200';
    if (s >= 0.5) return '#ffd700';
    return '#9ee0ff';
  }
})();
