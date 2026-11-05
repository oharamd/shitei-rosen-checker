(() => {
  const $ = s => document.querySelector(s);
  const C = window.Core;
  const cellCache = new Map();
  let ADDR = null, map, layer, roadLayer, drawnCells = new Set();
  const toast = (m, ms = 2500) => { const t = $('#toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), ms); };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  async function init() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    const meta = await (await fetch('data/routes.json')).json();
    C.setMeta(meta);
    $('#ver').textContent = `データ作成日 ${meta.built} ／ 路線数 ${meta.routes.length - 1}`;
    map = L.map('map', { zoomControl: true, attributionControl: true }).setView([34.69, 135.5], 11);
    L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', { maxZoom: 19, maxNativeZoom: 18, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a> | © OpenStreetMap contributors' }).addTo(map);
    roadLayer = L.layerGroup().addTo(map); layer = L.layerGroup().addTo(map);
    map.on('click', e => run([e.latlng.lng, e.latlng.lat], '地図で選択した地点'));
    map.on('moveend', drawRoads);
    buildList(meta);
    drawRoads();
  }

  const bundleCache = new Map();
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
  const colorOf = r => r.id === 'MW' ? '#7c3aed' : (r.note ? '#f59e0b' : '#ef4444');
  async function drawRoads() {
    if (map.getZoom() < 13) { roadLayer.clearLayers(); drawnCells.clear(); return; }
    const b = map.getBounds(), cs = C.meta().cell, keys = [];
    for (let x = Math.floor(b.getWest() / cs); x <= Math.floor(b.getEast() / cs); x++)
      for (let y = Math.floor(b.getSouth() / cs); y <= Math.floor(b.getNorth() / cs); y++) keys.push(`${x}_${y}`);
    if (keys.length > 16) return;
    for (const k of keys) {
      if (drawnCells.has(k)) continue; drawnCells.add(k);
      try {
        const d = await getCell(k);
        for (const r of d.roads) { const m = C.meta().routes[r.ri]; L.polyline(r.pts.map(p => [p[1], p[0]]), { color: colorOf(m), weight: 5, opacity: .55, interactive: false }).addTo(roadLayer); }
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

  async function run(pt, title, level) {
    const th = +$('#th').value;
    $('#result').classList.remove('hidden');
    $('#result').innerHTML = '<p class="muted">判定中…</p>';
    let data;
    try { data = await loadAround(pt[0], pt[1]); } catch (e) { $('#result').innerHTML = `<p>${esc(e.message)}</p>`; return; }
    const r = C.judge(pt, data, { th });
    render(r, pt, title, level);
    draw(r, pt);
  }

  const compass = idx => {
    const s = new Set(idx); let p = '';
    for (let i = 0; i < 8; i++) {
      const a0 = (i * 45 - 22.5 - 90) * Math.PI / 180, a1 = (i * 45 + 22.5 - 90) * Math.PI / 180;
      p += `<path d="M27 27 L${27 + 25 * Math.cos(a0)} ${27 + 25 * Math.sin(a0)} A25 25 0 0 1 ${27 + 25 * Math.cos(a1)} ${27 + 25 * Math.sin(a1)}Z" fill="${s.has(i) ? '#dc2626' : 'rgba(148,163,184,.25)'}" stroke="#fff" stroke-width="1"/>`;
    }
    return `<svg class="compass" viewBox="0 0 54 54">${p}<rect x="19" y="19" width="16" height="16" rx="2" fill="#1d4ed8"/><text x="27" y="8.5" font-size="8" text-anchor="middle" fill="#475569" font-weight="700">北</text></svg>`;
  };

  function render(r, pt, title, level) {
    const V = { ok: ['該当', '有資格者（検定合格警備員）の配置が必要な路線に接しています'], warn: ['要確認', '区間端付近または判定距離ぎりぎりです。告示・現地で確認してください'], ng: ['非該当', `${r.th}m以内に認定路線はありません`] }[r.verdict];
    let h = `<div class="addr">${esc(title || '')}${level && level !== '住所' ? `<span class="muted">（${esc(level)}レベルの位置。建物は地図をタップして選んでください）</span>` : ''}</div>`;
    h += `<div class="verdict ${r.verdict}"><div class="big">${V[0]}</div><div>${V[1]}<small>${r.building ? '建物の外周から判定' : '建物データなし：地点から判定'}／判定距離 ${r.th}m</small></div></div>`;
    for (const x of r.hits) {
      h += `<div class="hit">${compass(x.sideIdx)}<div><b>${esc(x.route.name)}</b><div class="meta">${esc(x.route.pref)} 認定No.${x.route.no || '-'}・最短 ${x.dmin.toFixed(0)}m</div>`
        + `<div>${r.building ? '建物' : '地点'}の <span class="dirs">${x.dirs.length ? esc(x.dirs.join('・')) + '側' : '直上'}</span> に接道</div>`
        + (x.warn ? `<div class="note">⚠ ${esc(x.warn)}</div>` : '') + (x.route.group ? `<div class="meta">和歌山県警の認定路線図から取得（市道・町道・港湾道路）</div>` : x.route.sec.type !== 'all' ? `<div class="meta">区間：${esc(x.route.sec.text || (x.route.sec.munis || []).join('、'))}</div>` : '') + `</div></div>`;
    }
    if (r.near.length) h += `<p class="muted">近くの認定路線：${r.near.map(n => `${esc(n.route.pref === '全国' ? '' : n.route.pref)}${esc(n.route.name)} 約${n.d.toFixed(0)}m`).join('／')}</p>`;
    h += `<p class="muted">※参考判定です。最終確認は最新の公安委員会告示で行ってください。</p>`;
    $('#result').innerHTML = h;
  }

  function draw(r, pt) {
    layer.clearLayers();
    L.circleMarker([pt[1], pt[0]], { radius: 6, color: '#1d4ed8', fillOpacity: 1 }).addTo(layer);
    if (r.building) L.polygon(r.building.map(p => [p[1], p[0]]), { color: '#1d4ed8', weight: 2, fillOpacity: .25 }).addTo(layer);
    for (const h of r.hits) for (const s of Object.values(h.sides)) L.polyline([[s.from[1], s.from[0]], [s.to[1], s.to[0]]], { color: '#dc2626', weight: 2, dashArray: '4 4' }).addTo(layer);
    const pts = [[pt[1], pt[0]]];
    if (r.building) r.building.forEach(p => pts.push([p[1], p[0]]));
    for (const h of r.hits) for (const s of Object.values(h.sides)) pts.push([s.to[1], s.to[0]]);
    map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 19 });
  }

  function buildList(meta) {
    const by = {};
    meta.routes.filter(r => r.id !== 'MW').forEach(r => (by[r.pref] = by[r.pref] || []).push(r));
    let h = '<p class="muted">全府県共通：高速自動車国道・自動車専用道路も配置対象です（紫線）。赤＝全域／区間指定、橙＝区間端を推定した路線。</p>';
    for (const [p, rs] of Object.entries(by)) {
      const un = rs.filter(r => !r.mapped).length;
      h += `<div class="pref">${p}（${rs.length}路線${un ? `・地図未整備${un}` : ''}）</div><div class="muted">${esc(rs[0].src)}</div>`;
      h += rs.map(r => `<div class="rl ${r.mapped ? '' : 'un'}"><span>${r.no}.</span><div>${esc(r.name)}<div class="s">${esc(r.sec.type === 'all' ? '全域' : r.sec.type === 'muni' ? r.sec.munis.join('、') : r.sec.text)}</div></div>${!r.mapped ? '<span class="tag">地図未整備</span>' : r.group ? '<span class="tag">路線図から収録</span>' : (r.note ? '<span class="tag">要確認</span>' : '')}</div>`).join('');
    }
    $('#t-list').innerHTML = h;
  }

  async function downloadAll() {
    const keys = C.meta().bundles; let done = 0; $('#btnDl').disabled = true;
    const cache = await caches.open('rosen-data-v1');
    const extra = ['data/addr.json'];
    for (const u of extra) { try { await cache.add(u); } catch (e) { } }
    const q = [...keys];
    const worker = async () => { while (q.length) { const k = q.shift(); try { await cache.add(`data/b/${k}.json`); } catch (e) { } done++; $('#dlBar').style.width = (done / keys.length * 100) + '%'; $('#dlMsg').textContent = `${done} / ${keys.length}`; } };
    await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
    $('#dlMsg').textContent = '保存しました。電波がなくても判定できます。'; $('#btnDl').disabled = false;
    try { localStorage.setItem('offlineSaved', new Date().toISOString()); } catch (e) { }
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
  $('#th').addEventListener('change', () => { const m = layer.getLayers()[0]; if (m && m.getLatLng) { const ll = m.getLatLng(); run([ll.lng, ll.lat], $('.addr') ? $('.addr').firstChild.textContent : ''); } });
  $('#btnMenu').onclick = () => $('#drawer').classList.remove('hidden');
  $('#btnClose').onclick = () => $('#drawer').classList.add('hidden');
  $('#drawer').addEventListener('click', e => { if (e.target.id === 'drawer') $('#drawer').classList.add('hidden'); });
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b)); document.querySelectorAll('.tab').forEach(t => t.classList.toggle('hidden', t.id !== 't-' + b.dataset.t)); });
  $('#btnDl').onclick = downloadAll;
  init().catch(e => toast('初期化エラー: ' + e.message, 6000));
})();
