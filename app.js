(() => {
  const $ = s => document.querySelector(s);
  const C = window.Core;
  const cellCache = new Map(), bundleCache = new Map();
  let ADDR = null, map, layer, roadLayer, mwLayer, drawnCells = new Set(), last = null, showMw = false;
  const toast = (m, ms = 2500) => { const t = $('#toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), ms); };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function init() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    const meta = await (await fetch('data/routes.json')).json();
    C.setMeta(meta);
    $('#ver').textContent = `データ作成日 ${meta.built} ／ 路線数 ${meta.routes.length - 1}`;
    map = L.map('map', { zoomControl: false, attributionControl: true }).setView([34.69, 135.5], 11);
    L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', { maxZoom: 19, maxNativeZoom: 18, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a> | © OpenStreetMap contributors' }).addTo(map);
    roadLayer = L.layerGroup().addTo(map); mwLayer = L.layerGroup(); layer = L.layerGroup().addTo(map);
    map.on('click', e => run([e.latlng.lng, e.latlng.lat], '地図で選択した地点'));
    map.on('moveend', drawRoads);
    buildList(meta);
    drawRoads();
    sheetH();
  }

  // ---- データ読み込み ----
  const bundleOf = k => { const [x, y] = k.split('_').map(Number), n = C.meta().bundle; return `${Math.floor(x / n)}_${Math.floor(y / n)}`; };
  function getBundle(bk) {
    if (!bundleCache.has(bk)) bundleCache.set(bk, fetch(`data/b/${bk}.json`).then(r => { if (!r.ok) throw 0; return r.json(); }).catch(e => { bundleCache.delete(bk); throw new Error('データを読み込めません（オフライン時は「オフライン用データを保存」が必要です）'); }));
    return bundleCache.get(bk);
  }
  async function getCell(k) {
    if (cellCache.has(k)) return cellCache.get(k);
    if (!C.meta().cells.includes(k)) return { roads: [], blds: [] };
    const p = getBundle(bundleOf(k)).then(b => C.decode(k, b[k]));
    p.catch(() => cellCache.delete(k));
    cellCache.set(k, p); return p;
  }
  async function loadAround(lng, lat) {
    const parts = await Promise.all(C.cellsAround(lng, lat).map(getCell));
    return { roads: parts.flatMap(p => p.roads), blds: parts.flatMap(p => p.blds) };
  }
  const colorOf = r => r.id === 'MW' ? '#7c3aed' : (r.note && !r.group ? '#f59e0b' : '#ef4444');
  async function drawRoads() {
    if (map.getZoom() < 13) { roadLayer.clearLayers(); mwLayer.clearLayers(); drawnCells.clear(); return; }
    const b = map.getBounds(), cs = C.meta().cell, keys = [];
    for (let x = Math.floor(b.getWest() / cs); x <= Math.floor(b.getEast() / cs); x++)
      for (let y = Math.floor(b.getSouth() / cs); y <= Math.floor(b.getNorth() / cs); y++) keys.push(`${x}_${y}`);
    if (keys.length > 16) return;
    for (const k of keys) {
      if (drawnCells.has(k)) continue; drawnCells.add(k);
      try {
        const d = await getCell(k);
        for (const r of d.roads) { const m = C.meta().routes[r.ri]; L.polyline(r.pts.map(p => [p[1], p[0]]), { color: colorOf(m), weight: m.id === 'MW' ? 4 : 5, opacity: m.id === 'MW' ? .45 : .5, interactive: false }).addTo(m.id === 'MW' ? mwLayer : roadLayer); }
      } catch (e) { drawnCells.delete(k); }
    }
  }

  async function geocode(q) {
    if (navigator.onLine) {
      try {
        const ctl = new AbortController(); setTimeout(() => ctl.abort(), 6000);
        const r = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q), { signal: ctl.signal });
        const j = await r.json();
        if (j && j[0]) return { lng: j[0].geometry.coordinates[0], lat: j[0].geometry.coordinates[1], title: j[0].properties.title, level: '住所' };
      } catch (e) { }
    }
    if (!ADDR) ADDR = await (await fetch('data/addr.json')).json();
    return C.offlineGeocode(q, ADDR);
  }

  // ---- 判定 ----
  async function run(pt, title, level) {
    last = { pt, title, level };
    const th = +$('#th').value;
    setPeek('<div class="hint">判定中…</div>', false);
    let data;
    try { data = await loadAround(pt[0], pt[1]); } catch (e) { setPeek(`<div class="hint">${esc(e.message)}</div>`, false); return; }
    const r = C.judge(pt, data, { th, mw: showMw });
    render(r, title, level);
    draw(r, pt);
  }

  // ---- シート ----
  const sheet = $('#sheet');
  function sheetH() { const h = innerWidth >= 820 ? 0 : sheet.getBoundingClientRect().height; document.documentElement.style.setProperty('--sheet-h', h + 'px'); }
  function setPeek(html, hasDetail) { $('#peek').innerHTML = html; sheet.classList.toggle('idle', !hasDetail); if (!hasDetail) { sheet.classList.remove('open'); $('#detail').innerHTML = ''; } requestAnimationFrame(sheetH); }
  const toggle = open => { sheet.classList.toggle('open', open ?? !sheet.classList.contains('open')); requestAnimationFrame(sheetH); };
  $('#grab').onclick = () => toggle();
  $('#peek').addEventListener('click', () => { if (!sheet.classList.contains('idle')) toggle(); });
  // 上下スワイプで開閉
  let y0 = null;
  sheet.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener('touchend', e => { if (y0 == null || sheet.classList.contains('idle')) return; const dy = e.changedTouches[0].clientY - y0; if (Math.abs(dy) > 40 && ($('#detail').scrollTop === 0 || dy < 0)) toggle(dy < 0); y0 = null; });
  addEventListener('resize', sheetH);

  const compass = idx => {
    const s = new Set(idx); let p = '';
    for (let i = 0; i < 4; i++) {
      const a0 = (i * 90 - 45 - 90) * Math.PI / 180, a1 = (i * 90 + 45 - 90) * Math.PI / 180;
      p += `<path d="M26 26 L${26 + 24 * Math.cos(a0)} ${26 + 24 * Math.sin(a0)} A24 24 0 0 1 ${26 + 24 * Math.cos(a1)} ${26 + 24 * Math.sin(a1)}Z" fill="${s.has(i) ? '#dc2626' : 'rgba(148,163,184,.22)'}" stroke="var(--card)" stroke-width="1.5"/>`;
    }
    return `<svg class="compass" viewBox="0 0 52 52">${p}<rect x="19" y="19" width="14" height="14" rx="3" fill="#2563eb"/><text x="26" y="9" font-size="7.5" text-anchor="middle" fill="#64748b" font-weight="800">北</text></svg>`;
  };
  const shortDir = d => d.length ? d.join('・') : '直上';

  function render(r, title, level) {
    const lab = { ok: '該当', warn: '要確認', ng: '非該当' }[r.verdict];
    const base = r.building ? '建物' : '地点';
    let chips;
    if (r.hits.length) chips = `<div class="rchips">${r.hits.map(h => `<span class="rc ${h.warn ? 'w' : ''}"><b>${esc(shortDir(h.dirs))}</b>${esc(h.route.name.replace(/^主要地方道|^(府|県)道/, ''))}</span>`).join('')}</div>`;
    else chips = `<div class="ngtxt">${(n0 => n0 ? `最寄り：${esc(n0.route.name)} 約${n0.d.toFixed(0)}m` : `周辺に認定路線なし`)(r.near.find(n => n.route.id !== 'MW'))}</div>`;
    const lv = level && level !== '住所' ? `（${esc(level)}の位置）` : '';
    setPeek(`<div class="sum"><div class="vb ${r.verdict}">${lab}</div><div class="t"><div class="ad">${esc(title || '')}${lv}</div>${chips}</div></div>`, true);

    let h = '';
    for (const x of r.hits) {
      h += `<div class="hit">${compass(x.sideIdx)}<div><div class="nm">${esc(x.route.name)}</div>`
        + `<div>${base}の <span class="dirs">${esc(shortDir(x.dirs))}${x.dirs.length ? '側' : ''}</span> に接道</div>`
        + `<div class="meta">${esc(x.route.pref)}${x.route.no ? ` 認定No.${x.route.no}` : ''}・道路端まで約${x.emin.toFixed(0)}m</div>`
        + (x.warn ? `<div class="note">⚠ ${esc(x.warn)}</div>` : '')
        + (x.route.group ? `<div class="meta">和歌山県警の認定路線図から取得（市道・町道・港湾道路）</div>` : x.route.sec.type !== 'all' ? `<div class="meta">区間：${esc(x.route.sec.text || (x.route.sec.munis || []).join('、'))}</div>` : '') + `</div></div>`;
    }
    const nr = r.near.filter(n => n.d < 200 && n.route.id !== 'MW');
    const mw = r.near.find(n => n.route.id === 'MW' && n.d < 60);
    if (mw) h += `<div class="foot">⚠ 約${mw.d.toFixed(0)}mに高速道路・自動車専用道路があります（高架下・側道の作業は現地確認）。上の「高速道路も表示・判定」にチェックで判定に含めます。</div>`;
    if (nr.length) h += `<div class="foot">近くの認定路線：${nr.map(n => `${esc(n.route.name)} 約${n.d.toFixed(0)}m`).join('／')}</div>`;
    if (level && level !== '住所') h += `<div class="foot">${esc(level)}レベルの位置です。対象の建物を地図でタップすると正確に判定できます。</div>`;
    h += `<div class="foot">${r.building ? '建物の外周' : '地点（建物データなし）'}から道路端まで${r.th}m以内・間に建物なしで「接道」。参考判定です。最終確認は最新の公安委員会告示で。</div>`;
    $('#detail').innerHTML = h;
    requestAnimationFrame(sheetH);
  }

  function draw(r, pt) {
    layer.clearLayers();
    if (r.building) L.polygon(r.building.map(p => [p[1], p[0]]), { color: '#2563eb', weight: 2.5, fillOpacity: .25 }).addTo(layer);
    else L.circleMarker([pt[1], pt[0]], { radius: 7, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }).addTo(layer);
    const pts = [[pt[1], pt[0]]];
    if (r.building) r.building.forEach(p => pts.push([p[1], p[0]]));
    for (const h of r.hits) {
      for (const s of Object.values(h.sides)) { L.polyline([[s.from[1], s.from[0]], [s.to[1], s.to[0]]], { color: h.warn ? '#d97706' : '#dc2626', weight: 2.5, dashArray: '5 5' }).addTo(layer); pts.push([s.to[1], s.to[0]]); }
      L.marker([h.to[1], h.to[0]], { icon: L.divIcon({ className: '', html: `<span class="rlabel ${h.warn ? 'w' : ''}">${esc(h.route.name.replace(/^主要地方道|^(府|県)道/, ''))}</span>`, iconSize: [0, 0] }), interactive: false }).addTo(layer);
    }
    const mob = innerWidth < 820, sh = mob ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-h')) || 140) : 0;
    map.fitBounds(L.latLngBounds(pts).pad(0.35), { maxZoom: 19, paddingTopLeft: [mob ? 20 : 430, 110], paddingBottomRight: [20, sh + 20] });
  }

  function buildList(meta) {
    const by = {};
    meta.routes.filter(r => r.id !== 'MW').forEach(r => (by[r.pref] = by[r.pref] || []).push(r));
    let h = '<p class="muted">全府県共通：高速自動車国道・自動車専用道路も配置対象（紫線）。赤＝認定路線、橙＝区間端を推定した路線。</p>';
    for (const [p, rs] of Object.entries(by)) {
      const real = rs.filter(r => r.no);
      h += `<div class="pref">${p}（${real.length}路線）</div><div class="muted">${esc(real[0].src)}</div>`;
      h += real.map(r => `<div class="rl ${r.mapped ? '' : 'un'}"><span>${r.no}.</span><div>${esc(r.name)}<div class="s">${esc(r.sec.type === 'all' ? '全域' : r.sec.type === 'muni' ? r.sec.munis.join('、') : r.sec.text)}</div></div>${!r.mapped ? '<span class="tag">地図未整備</span>' : r.group ? '<span class="tag">路線図から収録</span>' : (r.note ? '<span class="tag">要確認</span>' : '')}</div>`).join('');
    }
    $('#t-list').innerHTML = h;
  }

  async function downloadAll() {
    const keys = C.meta().bundles; let done = 0; $('#btnDl').disabled = true;
    const cache = await caches.open('rosen-data-v2');
    try { await cache.add('data/addr.json'); } catch (e) { }
    const q = [...keys];
    const worker = async () => { while (q.length) { const k = q.shift(); try { await cache.add(`data/b/${k}.json`); } catch (e) { } done++; $('#dlBar').style.width = (done / keys.length * 100) + '%'; $('#dlMsg').textContent = `${done} / ${keys.length}`; } };
    await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
    $('#dlMsg').textContent = '保存しました。電波がなくても判定できます。'; $('#btnDl').disabled = false;
  }

  $('#f').addEventListener('submit', async e => {
    e.preventDefault(); const q = $('#q').value.trim(); if (!q) return; $('#q').blur();
    let g; try { g = await geocode(q); } catch (err) { toast('住所データを読み込めません（オフライン時は事前に「オフライン用データを保存」）'); return; }
    if (!g) { toast('住所が見つかりません（関西2府4県の住所を入力）'); return; }
    run([g.lng, g.lat], g.title, g.level);
  });
  $('#btnGps').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('位置情報が使えません');
    toast('現在地を取得中…');
    navigator.geolocation.getCurrentPosition(p => run([p.coords.longitude, p.coords.latitude], `現在地（誤差 約${Math.round(p.coords.accuracy)}m）`), () => toast('現在地を取得できませんでした'), { enableHighAccuracy: true, timeout: 15000 });
  });
  $('#th').addEventListener('change', () => { if (last) run(last.pt, last.title, last.level); });
  $('#btnMenu').onclick = () => $('#drawer').classList.remove('hidden');
  $('#btnClose').onclick = () => $('#drawer').classList.add('hidden');
  $('#drawer').addEventListener('click', e => { if (e.target.id === 'drawer') $('#drawer').classList.add('hidden'); });
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b)); document.querySelectorAll('.tab').forEach(t => t.classList.toggle('hidden', t.id !== 't-' + b.dataset.t)); });
  $('#btnDl').onclick = downloadAll;
  $('#chkMw').onchange = () => { showMw = $('#chkMw').checked; showMw ? mwLayer.addTo(map) : mwLayer.remove(); if (last) run(last.pt, last.title, last.level); };
  init().catch(e => toast('初期化エラー: ' + e.message, 6000));
})();
