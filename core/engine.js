/* ============================================================
 * PPMap — Functional core (data + map + interactions)
 * ------------------------------------------------------------
 * This layer knows NOTHING about UI components or branding.
 * All visual decisions are read from CSS custom properties on
 * the container element (design layer) or from config defaults.
 *
 * Swap the design layer (CSS tokens + components) freely:
 * this file does not need to change.
 *
 * Dependencies (globals): maplibregl, deck
 * ============================================================ */

(function (global) {
  'use strict';

  /* ---------- small utils ---------- */

  function hexToRgb(hex) {
    hex = (hex || '').trim().replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const n = parseInt(hex, 16);
    if (isNaN(n)) return [255, 255, 255];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mix(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t)
    ];
  }

  // Color ramp for heat/density layers, derived from one brand color
  function rampFrom(rgb, darkBase) {
    const base = darkBase ? [8, 12, 24] : [240, 244, 248];
    return [
      mix(base, rgb, 0.25),
      mix(base, rgb, 0.45),
      mix(base, rgb, 0.65),
      rgb,
      mix(rgb, [255, 255, 255], 0.35),
      mix(rgb, [255, 255, 255], 0.7)
    ];
  }

  // Tiny CSV parser — expects a header row with lat/lon columns
  function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length);
    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const iLat = header.indexOf('lat'), iLon = header.indexOf('lon');
    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const lat = parseFloat(cols[iLat]), lon = parseFloat(cols[iLon]);
      if (!isNaN(lat) && !isNaN(lon)) out.push({ position: [lon, lat] });
    }
    return out;
  }

  /* ---------- defaults (overridable via config) ---------- */

  const BASEMAPS = {
    dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
  };

  const DEFAULTS = {
    basemap: 'dark',
    view: 'coverage',            // 'coverage' | 'heatmap' | 'density'
    coverageRadiusMeters: 60000, // matches original 60 km circles
    optimalRadiusKm: 30,         // centimetre-grade accuracy is best within this baseline
    // coverage-view point sizing/opacity (app: true-ish service discs;
    // demo globe: small bright dots — override there)
    coverageMinPixels: 1.6,
    coverageMaxPixels: 60,
    coverageOpacity: 0.28,
    probeOnClick: false,         // click anywhere -> coverage verdict (full app)
    projection: 'mercator',      // 'globe' needs maplibre-gl >= 5 and deck.gl >= 9.1
    cooperativeGestures: false,  // true for in-page embeds (Webflow)
    interactive: true,
    initialViewState: { longitude: -40, latitude: 38, zoom: 2.2, pitch: 0, bearing: 0 }
  };

  /* ---------- geo utils ---------- */

  function haversineKm(a, b) {
    const R = 6371, toRad = Math.PI / 180;
    const dLat = (b[1] - a[1]) * toRad, dLon = (b[0] - a[0]) * toRad;
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  function pointInRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > pt[1]) !== (yj > pt[1])) &&
          (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  /* ---------- engine ---------- */

  class PPMap {
    /**
     * @param {Object} opts
     * @param {HTMLElement|string} opts.container
     * @param {Array}  opts.services [{id, label, url}] — CSV sources
     * @param {Object} [opts.config] overrides of DEFAULTS
     */
    constructor(opts) {
      this.container = typeof opts.container === 'string'
        ? document.querySelector(opts.container) : opts.container;
      this.services = opts.services || [];
      this.config = Object.assign({}, DEFAULTS, opts.config || {});
      this.basemaps = Object.assign({}, BASEMAPS, this.config.basemaps || {});

      this.state = {
        view: this.config.view,
        basemap: this.config.basemap,
        enabled: {},   // serviceId -> bool
        data: {},      // serviceId -> [{position}]
        probe: null,   // {coords, verdict} — active coverage query
        countries: null, // {count, list} once loadCountries() resolves
        ready: false
      };
      this.services.forEach(s => { this.state.enabled[s.id] = true; });

      this._listeners = {};
      this._initMap();
      this._loadData();
    }

    /* ----- events: on('ready'|'statechange'|'hover'|'movestart') ----- */
    on(evt, cb) { (this._listeners[evt] = this._listeners[evt] || []).push(cb); return this; }
    _emit(evt, payload) { (this._listeners[evt] || []).forEach(cb => cb(payload)); }

    /* ----- design tokens read from the container (design layer) ----- */
    _token(name, fallback) {
      const v = getComputedStyle(this.container).getPropertyValue(name).trim();
      return v || fallback;
    }
    _serviceColor(service) {
      return hexToRgb(this._token('--pp-' + service.id + '-color', service.color || '#00e5ff'));
    }

    /* ----- map ----- */
    _initMap() {
      this.map = new maplibregl.Map({
        container: this.container,
        style: this.basemaps[this.state.basemap],
        center: [this.config.initialViewState.longitude, this.config.initialViewState.latitude],
        zoom: this.config.initialViewState.zoom,
        pitch: this.config.initialViewState.pitch,
        bearing: this.config.initialViewState.bearing,
        attributionControl: { compact: true },
        cooperativeGestures: this.config.cooperativeGestures,
        interactive: this.config.interactive,
        dragRotate: true
      });

      this.overlay = new deck.MapboxOverlay({
        // globe projection requires interleaved rendering (deck.gl >= 9.1)
        interleaved: this.config.projection === 'globe',
        layers: [],
        onHover: info => this._emit('hover', info),
        getCursor: ({ isHovering }) => (isHovering ? 'pointer' : 'grab')
      });
      this.map.addControl(this.overlay);
      this.map.on('movestart', () => this._emit('movestart'));

      // globe projection (maplibre >= 5) — reapplied on every style swap,
      // since setStyle resets the projection
      if (this.config.projection === 'globe') {
        this.map.on('style.load', () => {
          if (this.map.setProjection) this.map.setProjection({ type: 'globe' });
        });
      }

      if (this.config.probeOnClick) {
        this.map.on('click', e => this.setProbe([e.lngLat.lng, e.lngLat.lat]));
      }
    }

    _loadData() {
      Promise.all(this.services.map(s =>
        fetch(s.url).then(r => r.text()).then(t => { this.state.data[s.id] = parseCSV(t); })
      )).then(() => {
        this.state.ready = true;
        this._render();
        this._emit('ready', this.getStats());
      });
    }

    /* ----- layers ----- */
    _render() {
      if (!this.state.ready) return;
      const dark = this.state.basemap !== 'light';
      const layers = [];
      const view = this.state.view;

      if (view === 'density') {
        // Combined density of all enabled services, ramp from accent token
        const pts = [];
        this.services.forEach(s => {
          if (this.state.enabled[s.id]) pts.push.apply(pts, this.state.data[s.id]);
        });
        const accent = hexToRgb(this._token('--pp-accent-color', '#00e5ff'));
        layers.push(new deck.HexagonLayer({
          id: 'pp-density',
          data: pts,
          getPosition: d => d.position,
          radius: 60000,
          coverage: 0.85,
          extruded: true,
          elevationScale: 120,
          elevationRange: [0, 4000],
          colorRange: rampFrom(accent, dark),
          pickable: true,
          opacity: 0.85
        }));
      } else {
        this.services.forEach(s => {
          if (!this.state.enabled[s.id]) return;
          const rgb = this._serviceColor(s);
          const data = this.state.data[s.id];

          if (view === 'heatmap') {
            layers.push(new deck.HeatmapLayer({
              id: 'pp-heat-' + s.id,
              data,
              getPosition: d => d.position,
              getWeight: 1,
              radiusPixels: 42,
              intensity: 1.1,
              threshold: 0.04,
              aggregation: 'SUM',
              colorRange: rampFrom(rgb, dark)
            }));
          } else { // 'coverage'
            layers.push(new deck.ScatterplotLayer({
              id: 'pp-cov-' + s.id,
              data,
              getPosition: d => d.position,
              getFillColor: rgb,
              radiusUnits: 'meters',
              getRadius: this.config.coverageRadiusMeters,
              radiusMinPixels: this.config.coverageMinPixels,
              radiusMaxPixels: this.config.coverageMaxPixels,
              stroked: false,
              opacity: this.config.coverageOpacity,
              pickable: true,
              parameters: { depthTest: false },
              // tag picked objects with their service for tooltips
              updateTriggers: {},
              serviceMeta: s
            }));
          }
        });
      }
      this.overlay.setProps({ layers: layers.concat(this._probeLayers()) });
      this._emit('statechange', this.getState());
    }

    /* ----- coverage verdict ----- */

    /**
     * Coverage check at [lon, lat] against ALL networks (regardless of
     * current toggles — availability is a property of the platform).
     * status per network: 'optimal' (<=optimalRadiusKm) | 'covered'
     * (<=coverage radius) | 'out'.
     */
    queryPoint(coords) {
      const maxKm = this.config.coverageRadiusMeters / 1000;
      const optKm = this.config.optimalRadiusKm;
      const services = this.services.map(s => {
        let best = Infinity, nearest = null;
        (this.state.data[s.id] || []).forEach(p => {
          const d = haversineKm(coords, p.position);
          if (d < best) { best = d; nearest = p.position; }
        });
        return {
          id: s.id, label: s.label,
          distanceKm: isFinite(best) ? best : null,
          nearest,
          status: best <= optKm ? 'optimal' : best <= maxKm ? 'covered' : 'out'
        };
      });
      const inRange = services.filter(s => s.status !== 'out');
      return {
        coords,
        services,
        coveredCount: inRange.length,
        dual: inRange.length >= 2,
        any: inRange.length > 0
      };
    }

    /** Place (or clear) the coverage probe; emits 'probe' with the verdict. */
    setProbe(coords) {
      if (!this.state.ready) return;
      this.state.probe = coords ? { coords, verdict: this.queryPoint(coords) } : null;
      this._render();
      this._emit('probe', this.state.probe);
    }

    _probeLayers() {
      const p = this.state.probe;
      if (!p) return [];
      const accent = hexToRgb(this._token('--pp-accent-color', '#276ef1'));
      const layers = [
        // service-radius ring: any station inside it covers the probe
        new deck.ScatterplotLayer({
          id: 'pp-probe-range',
          data: [p],
          getPosition: d => d.coords,
          radiusUnits: 'meters',
          getRadius: this.config.coverageRadiusMeters,
          stroked: true, filled: true,
          getFillColor: accent.concat([18]),
          getLineColor: accent.concat([160]),
          lineWidthMinPixels: 1.5,
          parameters: { depthTest: false }
        }),
        new deck.ScatterplotLayer({
          id: 'pp-probe-pin',
          data: [p],
          getPosition: d => d.coords,
          radiusMinPixels: 7, radiusMaxPixels: 7,
          stroked: true, filled: true,
          getFillColor: accent,
          getLineColor: [255, 255, 255, 230],
          lineWidthMinPixels: 2.5,
          parameters: { depthTest: false }
        })
      ];
      // link probe -> nearest in-range station, per network
      const links = p.verdict.services.filter(s => s.status !== 'out' && s.nearest);
      if (links.length) {
        layers.push(new deck.LineLayer({
          id: 'pp-probe-links',
          data: links,
          getSourcePosition: () => p.coords,
          getTargetPosition: d => d.nearest,
          getColor: d => this._serviceColor(this.services.find(s => s.id === d.id)).concat([200]),
          getWidth: 2,
          widthUnits: 'pixels',
          parameters: { depthTest: false }
        }));
      }
      return layers;
    }

    /* ----- country aggregation (serves reseller / enterprise views) ----- */

    /** Async: counts stations per country from a GeoJSON; emits 'countries'. */
    loadCountries(url) {
      return fetch(url).then(r => r.json()).then(geo => {
        const feats = geo.features.map(f => {
          const polys = f.geometry.type === 'Polygon'
            ? [f.geometry.coordinates[0]]
            : f.geometry.coordinates.map(p => p[0]);
          let minX = 180, minY = 90, maxX = -180, maxY = -90;
          polys.forEach(r => r.forEach(pt => {
            minX = Math.min(minX, pt[0]); maxX = Math.max(maxX, pt[0]);
            minY = Math.min(minY, pt[1]); maxY = Math.max(maxY, pt[1]);
          }));
          return { name: f.properties.name, polys, bbox: [minX, minY, maxX, maxY] };
        });
        const tally = {};
        this.services.forEach(svc => {
          (this.state.data[svc.id] || []).forEach(pt => {
            const c = pt.position;
            for (let i = 0; i < feats.length; i++) {
              const f = feats[i], b = f.bbox;
              if (c[0] < b[0] || c[0] > b[2] || c[1] < b[1] || c[1] > b[3]) continue;
              if (f.polys.some(ring => pointInRing(c, ring))) {
                const t = tally[f.name] = tally[f.name] || { name: f.name, count: 0, bbox: f.bbox, perService: {} };
                t.count++;
                t.perService[svc.id] = (t.perService[svc.id] || 0) + 1;
                break;
              }
            }
          });
        });
        const list = Object.values(tally).sort((a, b) => b.count - a.count);
        this.state.countries = { count: list.length, list };
        this._emit('countries', this.state.countries);
        return this.state.countries;
      });
    }

    flyToCountry(name) {
      const c = (this.state.countries && this.state.countries.list.find(x => x.name === name));
      if (c) this.map.fitBounds([[c.bbox[0], c.bbox[1]], [c.bbox[2], c.bbox[3]]], { padding: 70, duration: 1100, maxZoom: 7 });
    }

    /* ----- public API (used by the UI layer) ----- */

    setView(view) { this.state.view = view; this._handlePitch(view); this._render(); }

    _handlePitch(view) {
      if (view === 'density') this.map.easeTo({ pitch: 48, duration: 900 });
      else if (this.map.getPitch() > 0) this.map.easeTo({ pitch: 0, duration: 900 });
    }

    toggleService(id, on) {
      this.state.enabled[id] = (on !== undefined) ? on : !this.state.enabled[id];
      this._render();
    }

    setBasemap(name) {
      this.state.basemap = name;
      this.map.setStyle(this.basemaps[name]);
      // re-style data layers once the new basemap settles
      this.map.once('styledata', () => this._render());
    }

    /** Re-read CSS tokens (call after the design layer swaps a theme class) */
    refreshTheme() { this._render(); }

    flyTo(opts) { this.map.flyTo(Object.assign({ speed: 0.9, curve: 1.5, essential: true }, opts)); }

    fitToData(padding) {
      const all = [];
      this.services.forEach(s => { if (this.state.enabled[s.id]) all.push.apply(all, this.state.data[s.id] || []); });
      if (!all.length) return;
      let minX = 180, minY = 90, maxX = -180, maxY = -90;
      all.forEach(p => {
        minX = Math.min(minX, p.position[0]); maxX = Math.max(maxX, p.position[0]);
        minY = Math.min(minY, p.position[1]); maxY = Math.max(maxY, p.position[1]);
      });
      this.map.fitBounds([[minX, minY], [maxX, maxY]], { padding: padding || 60, duration: 1200 });
    }

    /** Top-N densest regions (5° grid bins) — used for guided tours */
    getHotspots(n) {
      const bins = {};
      this.services.forEach(s => {
        (this.state.data[s.id] || []).forEach(p => {
          const k = Math.round(p.position[0] / 5) + '|' + Math.round(p.position[1] / 5);
          (bins[k] = bins[k] || { count: 0, x: 0, y: 0 });
          bins[k].count++; bins[k].x += p.position[0]; bins[k].y += p.position[1];
        });
      });
      return Object.values(bins)
        .sort((a, b) => b.count - a.count)
        .slice(0, n || 4)
        .map(b => ({ longitude: b.x / b.count, latitude: b.y / b.count, count: b.count }));
    }

    getStats() {
      const stats = { total: 0, services: {} };
      this.services.forEach(s => {
        const c = (this.state.data[s.id] || []).length;
        stats.services[s.id] = { label: s.label, count: c, enabled: this.state.enabled[s.id] };
        stats.total += c;
      });
      return stats;
    }

    getState() {
      return { view: this.state.view, basemap: this.state.basemap, enabled: Object.assign({}, this.state.enabled) };
    }
  }

  global.PPMap = PPMap;
})(window);
