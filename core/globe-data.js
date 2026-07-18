/* ============================================================
 * PPMap — Globe data layer (renderer-agnostic)
 * ------------------------------------------------------------
 * Loads the same station CSVs as the deck.gl engine and derives
 * the structures a conceptual 3D globe needs: a thinned point
 * field, regional hubs, and a connectivity mesh of arcs.
 *
 * Knows nothing about Three.js / globe.gl or about colors.
 * Output is plain {lat, lng, ...} data — feed it to any renderer.
 * ============================================================ */

(function (global) {
  'use strict';

  function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length);
    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const iLat = header.indexOf('lat'), iLon = header.indexOf('lon');
    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(',');
      const lat = parseFloat(c[iLat]), lng = parseFloat(c[iLon]);
      if (!isNaN(lat) && !isNaN(lng)) out.push({ lat, lng });
    }
    return out;
  }

  function haversineKm(a, b) {
    const R = 6371, toRad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toRad, dLng = (b.lng - a.lng) * toRad;
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // Grid-bin to regional hubs: centroid + count per cell, top N by count.
  function hubsFrom(points, cellDeg, topN) {
    const bins = {};
    points.forEach(p => {
      const k = Math.round(p.lng / cellDeg) + '|' + Math.round(p.lat / cellDeg);
      const b = bins[k] = bins[k] || { lat: 0, lng: 0, count: 0 };
      b.lat += p.lat; b.lng += p.lng; b.count++;
    });
    return Object.values(bins)
      .map(b => ({ lat: b.lat / b.count, lng: b.lng / b.count, count: b.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, topN);
  }

  // Connectivity mesh: link each hub to its k nearest hubs (deduped).
  // Conveys "one connected platform" without a hairball.
  function meshArcs(hubs, k) {
    const seen = new Set(), arcs = [];
    hubs.forEach((h, i) => {
      const near = hubs
        .map((o, j) => ({ j, d: i === j ? Infinity : haversineKm(h, o) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, k);
      near.forEach(n => {
        const key = Math.min(i, n.j) + '-' + Math.max(i, n.j);
        if (seen.has(key)) return;
        seen.add(key);
        const o = hubs[n.j];
        arcs.push({ startLat: h.lat, startLng: h.lng, endLat: o.lat, endLng: o.lng, gap: n.d });
      });
    });
    return arcs;
  }

  // Deterministic thinning (every Nth) → clean field, stable across reloads.
  function thin(points, target) {
    if (points.length <= target) return points.slice();
    const step = points.length / target, out = [];
    for (let i = 0; i < points.length; i += step) out.push(points[Math.floor(i)]);
    return out;
  }

  /**
   * @param {Array} services [{id, url}]
   * @param {Object} [opts] {pointTarget, hubCellDeg, hubCount, meshK}
   * @returns Promise<{ points, hubs, arcs, stats }>
   */
  function loadGlobeData(services, opts) {
    opts = opts || {};
    const pointTarget = opts.pointTarget || 3200;
    return Promise.all(services.map(s =>
      fetch(s.url).then(r => r.text()).then(t => ({ id: s.id, rows: parseCSV(t) }))
    )).then(sets => {
      const stats = { total: 0, services: {} };
      let allPoints = [];
      sets.forEach(set => {
        stats.services[set.id] = set.rows.length;
        stats.total += set.rows.length;
        set.rows.forEach(r => { r.svc = set.id; });
        allPoints = allPoints.concat(set.rows);
      });

      // hubs from the full set (density-true), arcs from hubs
      const hubs = hubsFrom(allPoints, opts.hubCellDeg || 9, opts.hubCount || 11);
      const arcs = meshArcs(hubs, opts.meshK || 2);

      // per-service thinned fields keep the network colours balanced
      const points = [];
      sets.forEach(set => {
        const share = Math.round(pointTarget * (set.rows.length / stats.total));
        thin(set.rows, share).forEach(p => points.push(p));
      });

      return { points, hubs, arcs, stats };
    });
  }

  /* ---------- choropleth: which countries are covered ---------- */

  function pointInRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > pt.lat) !== (yj > pt.lat)) &&
          (pt.lng < (xj - xi) * (pt.lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function ringsOf(feature) {
    const g = feature.geometry;
    return g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map(p => p[0]);
  }
  function bboxOf(rings) {
    let minX = 180, minY = 90, maxX = -180, maxY = -90;
    rings.forEach(r => r.forEach(p => {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    }));
    return [minX, minY, maxX, maxY];
  }

  /**
   * Tag each country feature with a station count, and mark it covered.
   * @param {Object} geo   countries GeoJSON
   * @param {Array}  points [{lat,lng}]
   * @param {Number} minStations threshold to count as "covered" (default 1)
   * @returns { features (with .properties.ppCount/.ppCovered), coveredCount }
   */
  function tagCoverage(geo, points, minStations) {
    const min = minStations || 1;
    const feats = geo.features.map(f => ({ f, rings: ringsOf(f), bbox: bboxOf(ringsOf(f)), count: 0 }));
    points.forEach(p => {
      for (let i = 0; i < feats.length; i++) {
        const e = feats[i], b = e.bbox;
        if (p.lng < b[0] || p.lng > b[2] || p.lat < b[1] || p.lat > b[3]) continue;
        if (e.rings.some(r => pointInRing(p, r))) { e.count++; break; }
      }
    });
    let coveredCount = 0;
    feats.forEach(e => {
      e.f.properties.ppCount = e.count;
      e.f.properties.ppCovered = e.count >= min;
      if (e.f.properties.ppCovered) coveredCount++;
    });
    return { features: geo.features, coveredCount };
  }

  /** Load countries GeoJSON + station CSVs, return tagged features. */
  function loadChoropleth(countriesUrl, services, minStations) {
    return Promise.all([
      fetch(countriesUrl).then(r => r.json()),
      Promise.all(services.map(s => fetch(s.url).then(r => r.text()).then(parseCSV)))
    ]).then(([geo, sets]) => {
      let points = [], total = 0;
      sets.forEach(rows => { total += rows.length; points = points.concat(rows); });
      const tagged = tagCoverage(geo, points, minStations);
      return { features: tagged.features, coveredCount: tagged.coveredCount, total };
    });
  }

  /** Raw per-network station points: [{ id, points:[{lat,lng}] }] */
  function loadStations(services) {
    return Promise.all(services.map(s =>
      fetch(s.url).then(r => r.text()).then(t => ({ id: s.id, points: parseCSV(t) }))
    ));
  }

  global.PPGlobeData = { loadGlobeData, loadChoropleth, loadStations, tagCoverage, hubsFrom, meshArcs, haversineKm };
})(window);
