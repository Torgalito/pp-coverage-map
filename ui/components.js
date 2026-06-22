/* ============================================================
 * PPMap — UI layer components
 * ------------------------------------------------------------
 * Pure presentation: builds DOM controls and binds them to the
 * engine's PUBLIC API only (setView, toggleService, setBasemap,
 * setProbe, queryPoint, loadCountries, flyToCountry, on, ...).
 * No data or WebGL logic here. Restyling = theme-*.css.
 *
 * Optional deps: gsap (animations, degrades gracefully).
 * External service: Photon geocoder (komoot.io, free, no key).
 * ============================================================ */

(function (global) {
  'use strict';

  var REDUCED = global.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // strict timing: tweens jump to their real position after tab throttling
  if (global.gsap) gsap.ticker.lagSmoothing(0);

  function el(tag, className, html) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  function fmt(n) { return n.toLocaleString('en-US'); }

  function animateCount(node, to) {
    if (global.gsap && !REDUCED) {
      const obj = { v: 0 };
      gsap.to(obj, { v: to, duration: 1.4, ease: 'power2.out', onUpdate: () => { node.textContent = fmt(Math.round(obj.v)); } });
    } else {
      node.textContent = fmt(to);
    }
  }

  function entrance(nodes) {
    if (global.gsap && !REDUCED) {
      gsap.from(nodes, { y: 14, opacity: 0, duration: 0.7, stagger: 0.09, ease: 'power3.out', clearProps: 'all' });
    }
  }

  const VIEWS = [
    { id: 'coverage', label: 'Coverage' },
    { id: 'heatmap', label: 'Heatmap' }
  ];

  const GEOCODER = 'https://photon.komoot.io/api/?limit=5&q=';

  /* ================= search (the answer machine) ================= */

  function buildSearch(engine, parent) {
    const wrap = el('div', 'pp-search');
    const row = el('div', 'pp-search-row');
    const input = el('input');
    input.type = 'search';
    input.placeholder = 'Check coverage — city, address…';
    input.setAttribute('aria-label', 'Check coverage at a location');
    const geoBtn = el('button', 'pp-geobtn', '◎ My location');
    geoBtn.title = 'Use my current location';
    row.appendChild(input); row.appendChild(geoBtn);
    const results = el('div', 'pp-search-results');
    results.setAttribute('role', 'listbox');
    wrap.appendChild(row); wrap.appendChild(results);
    parent.appendChild(wrap);

    let timer = null, lastQuery = '', items = [];

    function close() { results.classList.remove('is-open'); results.innerHTML = ''; items = []; }

    function probeAt(coords, placeLabel, zoom) {
      close();
      input.blur();
      if (placeLabel) engine._probePlace = placeLabel; // display-only hint, read by the verdict card
      engine.flyTo({ center: coords, zoom: zoom || 8 });
      engine.setProbe(coords);
    }

    function renderResults(features) {
      results.innerHTML = '';
      items = features;
      if (!features.length) { close(); return; }
      features.forEach((f, idx) => {
        const p = f.properties;
        const context = [p.city, p.state, p.country].filter(Boolean).filter(v => v !== p.name).join(', ');
        const b = el('button', null, p.name + '<small>' + context + '</small>');
        b.setAttribute('role', 'option');
        b.addEventListener('click', () => probeAt(f.geometry.coordinates, p.name + (p.country ? ', ' + p.country : '')));
        results.appendChild(b);
      });
      results.classList.add('is-open');
    }

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 3) { close(); return; }
      timer = setTimeout(() => {
        lastQuery = q;
        fetch(GEOCODER + encodeURIComponent(q))
          .then(r => r.json())
          .then(d => { if (q === lastQuery) renderResults(d.features || []); })
          .catch(() => close());
      }, 300);
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && items.length) {
        const f = items[0], p = f.properties;
        probeAt(f.geometry.coordinates, p.name + (p.country ? ', ' + p.country : ''));
      }
      if (e.key === 'Escape') close();
    });

    document.addEventListener('click', e => { if (!wrap.contains(e.target)) close(); });

    geoBtn.addEventListener('click', () => {
      if (!navigator.geolocation) return;
      geoBtn.textContent = '…';
      navigator.geolocation.getCurrentPosition(
        pos => { geoBtn.innerHTML = '◎ My location'; probeAt([pos.coords.longitude, pos.coords.latitude], 'Your location'); },
        () => { geoBtn.innerHTML = '◎ My location'; }
      );
    });

    return wrap;
  }

  /* ================= verdict card ================= */

  function buildVerdict(engine, root, cta) {
    const card = el('div', 'pp-verdict');
    card.setAttribute('role', 'status');
    root.appendChild(card);

    function statusLine(s) {
      const dist = s.distanceKm === null ? '—'
        : s.distanceKm < 100 ? s.distanceKm.toFixed(1) + ' km'
        : Math.round(s.distanceKm) + ' km';
      const word = s.status === 'optimal' ? 'optimal' : s.status === 'covered' ? 'covered' : 'out of range';
      return '<div class="pp-verdict-net' + (s.status === 'out' ? ' is-out' : '') + '">' +
        '<span class="pp-dot" style="background:var(--pp-' + s.id + '-color)"></span>' +
        s.label + ' · ' + word +
        '<span class="pp-net-dist">' + dist + '</span></div>';
    }

    engine.on('probe', probe => {
      if (!probe) { card.classList.remove('is-open'); return; }
      const v = probe.verdict;
      const place = engine._probePlace ||
        (v.coords[1].toFixed(3) + ', ' + v.coords[0].toFixed(3));
      engine._probePlace = null;

      card.classList.remove('is-dual', 'is-single', 'is-out');
      let headline;
      if (v.dual) { card.classList.add('is-dual'); headline = 'Dual-network coverage'; }
      else if (v.any) { card.classList.add('is-single'); headline = 'Covered — single network'; }
      else { card.classList.add('is-out'); headline = 'Outside current coverage'; }

      let html =
        '<button class="pp-verdict-close" aria-label="Close">✕</button>' +
        '<p class="pp-verdict-place">📍 ' + place + '</p>' +
        '<p class="pp-verdict-status"><span class="pp-dot"></span>' + headline + '</p>' +
        v.services.map(statusLine).join('');

      if (v.any) {
        html += '<p class="pp-verdict-note">Nearest station distances shown. Centimetre-grade accuracy is best within ' +
                engine.config.optimalRadiusKm + ' km of a station.</p>';
      } else {
        html += '<p class="pp-verdict-note">Not in range of the current network — coverage expands regularly. Talk to us about your region.</p>';
      }

      html += '<div class="pp-cta-row">';
      if (cta && cta.primary) html += '<a class="pp-btn pp-btn--primary" href="' + cta.primary.href + '" target="_top">' + cta.primary.label + '</a>';
      if (v.any && cta && cta.secondary) html += '<a class="pp-btn pp-btn--secondary" href="' + cta.secondary.href + '" target="_top">' + cta.secondary.label + '</a>';
      html += '</div>';

      card.innerHTML = html;
      card.classList.add('is-open');
      card.querySelector('.pp-verdict-close').addEventListener('click', () => engine.setProbe(null));
      if (global.gsap && !REDUCED) gsap.from(card, { y: 10, opacity: 0, duration: 0.35, ease: 'power3.out', clearProps: 'all' });
    });

    return card;
  }

  /* ================= countries panel ================= */

  function buildCountries(engine, root) {
    const panel = el('div', 'pp-countries');
    panel.innerHTML =
      '<div class="pp-countries-head"><b>Coverage by country</b>' +
      '<button class="pp-verdict-close" aria-label="Close" style="position:static">✕</button></div>' +
      '<div class="pp-countries-list"></div>';
    root.appendChild(panel);
    panel.querySelector('.pp-verdict-close').addEventListener('click', () => panel.classList.remove('is-open'));

    engine.on('countries', c => {
      const list = panel.querySelector('.pp-countries-list');
      list.innerHTML = '';
      c.list.forEach(country => {
        const row = el('button', 'pp-country-row',
          country.name + '<span class="pp-country-count">' + fmt(country.count) + '</span>');
        row.addEventListener('click', () => { engine.flyToCountry(country.name); });
        list.appendChild(row);
      });
    });

    return panel;
  }

  /* ================= full app UI ================= */

  /**
   * @param {PPMap} engine
   * @param {HTMLElement} root  element with class pp-root
   * @param {Object} [opts] {title, subtitle, cta: {primary:{label,href}, secondary:{label,href}}, dataDate}
   */
  function buildAppUI(engine, root, opts) {
    opts = opts || {};

    /* --- header: identity, stats, search --- */
    const header = el('div', 'pp-panel pp-panel--header');
    header.appendChild(el('h1', 'pp-title', opts.title || 'Premium Positioning Coverage'));
    header.appendChild(el('p', 'pp-subtitle', opts.subtitle || 'Check coverage where you operate'));
    const statsRow = el('div', 'pp-stats');
    header.appendChild(statsRow);
    buildSearch(engine, header);
    root.appendChild(header);

    /* --- verdict + countries --- */
    buildVerdict(engine, root, opts.cta);
    const countriesPanel = buildCountries(engine, root);

    /* --- controls --- */
    const controls = el('div', 'pp-panel pp-panel--controls');

    const viewBlock = el('div');
    viewBlock.appendChild(el('p', 'pp-label', 'View'));
    const seg = el('div', 'pp-seg');
    VIEWS.forEach(v => {
      const b = el('button', null, v.label);
      b.dataset.view = v.id;
      b.addEventListener('click', () => engine.setView(v.id));
      seg.appendChild(b);
    });
    viewBlock.appendChild(seg);
    controls.appendChild(viewBlock);

    const svcBlock = el('div');
    svcBlock.appendChild(el('p', 'pp-label', 'Networks'));
    const chips = el('div', 'pp-chips');
    engine.services.forEach(s => {
      const chip = el('button', 'pp-chip');
      chip.style.setProperty('--chip-color', 'var(--pp-' + s.id + '-color)');
      chip.dataset.service = s.id;
      chip.innerHTML = '<span class="pp-dot"></span>' + s.label + '<span class="pp-count">…</span>';
      chip.addEventListener('click', () => engine.toggleService(s.id));
      chips.appendChild(chip);
    });
    svcBlock.appendChild(chips);
    controls.appendChild(svcBlock);

    const actions = el('div', 'pp-actions');
    const themeBtn = el('button', 'pp-iconbtn', '☾ Theme');
    themeBtn.addEventListener('click', () => {
      const light = root.classList.toggle('pp-theme-light');
      engine.setBasemap(light ? 'light' : 'dark');
      themeBtn.innerHTML = light ? '☀ Theme' : '☾ Theme';
    });
    const fitBtn = el('button', 'pp-iconbtn', '⤢ Fit data');
    fitBtn.addEventListener('click', () => engine.fitToData());
    const fsBtn = el('button', 'pp-iconbtn', '⛶ Full');
    fsBtn.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else root.requestFullscreen && root.requestFullscreen();
    });
    actions.appendChild(themeBtn); actions.appendChild(fitBtn); actions.appendChild(fsBtn);
    controls.appendChild(actions);
    root.appendChild(controls);

    /* --- legend --- */
    const legend = el('div', 'pp-panel pp-panel--legend');
    engine.services.forEach(s => {
      const row = el('div', 'pp-legend-row');
      row.innerHTML = '<span class="pp-dot" style="background:var(--pp-' + s.id + '-color)"></span>' + s.label;
      legend.appendChild(row);
    });
    legend.appendChild(el('div', 'pp-legend-note',
      'Each station serves a ~60 km radius. Overlapping networks = redundancy, not duplication.' +
      (opts.dataDate ? '<br>Network data — ' + opts.dataDate + '.' : '')));
    root.appendChild(legend);

    /* --- tooltip --- */
    const tooltip = el('div', 'pp-tooltip');
    root.appendChild(tooltip);
    engine.on('hover', info => {
      if (info && info.object && info.layer && info.layer.id.indexOf('pp-probe') === -1) {
        const meta = info.layer.props.serviceMeta || {};
        tooltip.innerHTML = '<b>' + (meta.label || 'Station') + '</b><br><small>Base station · ~60 km service radius<br>Click anywhere to check coverage</small>';
        tooltip.style.left = info.x + 'px';
        tooltip.style.top = info.y + 'px';
        tooltip.classList.add('is-visible');
      } else {
        tooltip.classList.remove('is-visible');
      }
    });

    /* --- state sync --- */
    function sync(state) {
      seg.querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.view === state.view));
      chips.querySelectorAll('.pp-chip').forEach(c => c.classList.toggle('is-off', !state.enabled[c.dataset.service]));
    }
    engine.on('statechange', sync);
    sync(engine.getState());

    engine.on('ready', stats => {
      statsRow.innerHTML = '';
      // per-network counts (no inflated grand total)
      Object.keys(stats.services).forEach(id => {
        const s = stats.services[id];
        const node = el('div', 'pp-stat', '<b>0</b><span>' + s.label + '</span>');
        statsRow.appendChild(node);
        animateCount(node.querySelector('b'), s.count);
        const chip = chips.querySelector('[data-service="' + id + '"] .pp-count');
        if (chip) chip.textContent = fmt(s.count);
      });
      // countries count appears once computed; click -> panel
      const countriesStat = el('button', 'pp-stat', '<b>…</b><span>Countries</span>');
      countriesStat.addEventListener('click', () => countriesPanel.classList.toggle('is-open'));
      statsRow.appendChild(countriesStat);
      engine.on('countries', c => animateCount(countriesStat.querySelector('b'), c.count));

      entrance([header, controls, legend]);
    });

    return { header, controls, legend, tooltip };
  }

  global.PPMapUI = { buildAppUI: buildAppUI, buildSearch: buildSearch, buildVerdict: buildVerdict, REDUCED: REDUCED };
})(window);
