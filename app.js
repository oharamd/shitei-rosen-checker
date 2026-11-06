(() => {
  const $ = s => document.querySelector(s);
  const C = window.Core;
  const cellCache = new Map(), bundleCache = new Map();
  const PATCH = fetch('data/patch.json').then(r => r.ok ? r.json() : {}).catch(() => ({}));
  let ADDR = null, map, layer, roadLayer, mwLayer, drawnCells = new Set(), last = null, showMw = false;
  const toast = (m, ms = 2500) => { const t = $('#toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), ms); };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- 端末内保存（履歴・お気に入り・設定）----
  const store = {
    get(k, d) { try { const v = localStorage.getItem('rosen.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('rosen.' + k, JSON.stringify(v)); } catch (e) { } }
  };
  const HMAX = 50;
  const hist = () => store.get('hist', []);
  const keyOf = pt => pt[0].toFixed(5) + ',' + pt[1].toFixed(5);
  function addHist(item) {
    const h = hist().filter(x => keyOf(x.pt) !== keyOf(item.pt));
    h.unshift(item);
    const fav = h.filter(x => x.fav), rest = h.filter(x => !x.fav).slice(0, HMAX);
    store.set('hist', [...fav, ...rest].sort((a, b) => b.t - a.t));
    renderHist();
  }
  function toggleFav(k) {
    const h = hist(); const x = h.find(x => keyOf(x.pt) === k); if (!x) return;
    x.fav = !x.fav; store.set('hist', h); renderHist(); return x.fav;
  }
  const vLabel = { ok: '該当', warn: '要確認', ng: '非該当' };
  function renderHist() {
    const h = hist(); const favs = h.filter(x => x.fav), rec = h.filter(x => !x.fav);
    const row = x => `<div class="hrow" data-k="${keyOf(x.pt)}"><button class="star ${x.fav ? 'on' : ''}" data-fav="${keyOf(x.pt)}" aria-label="お気に入り">${x.fav ? '★' : '☆'}</button>`
      + `<div class="hmain" data-go="${keyOf(x.pt)}"><div class="ht">${esc(x.title || '地点')}</div><div class="hs"><span class="badge ${x.v}">${vLabel[x.v] || ''}</span> ${esc(x.sum || '')}<span class="hd">${new Date(x.t).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}</span></div></div></div>`;
    let s = '';
    if (favs.length) s += `<div class="pref">お気に入り</div>` + favs.map(row).join('');
    s += `<div class="pref">最近の判定</div>` + (rec.length ? rec.map(row).join('') : '<p class="muted">まだ履歴はありません。</p>');
    s += '<p class="muted">履歴・お気に入りはこの端末の中だけに保存され、他の人には見えません。</p>';
    $('#t-hist').innerHTML = s;
  }
  $('#t-hist').addEventListener('click', e => {
    const f = e.target.closest('[data-fav]'); if (f) { toggleFav(f.dataset.fav); return; }
    const g = e.target.closest('[data-go]'); if (!g) return;
    const x = hist().find(x => keyOf(x.pt) === g.dataset.go); if (!x) return;
    $('#drawer').classList.add('hidden'); run(x.pt, x.title, x.level);
  });
  $('#btnClearHist').onclick = () => { store.set('hist', hist().filter(x => x.fav)); renderHist(); toast('履歴を消去しました'); };

  // ---- 設定（テーマ・文字サイズ）----
  function applySettings() {
    const th = store.get('theme', 'auto'), fs = store.get('fs', '1');
    if (th === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', th);
    document.documentElement.style.setProperty('--ui', fs);
    document.querySelectorAll('.seg').forEach(g => g.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(store.get(g.dataset.k, g.dataset.k === 'theme' ? 'auto' : '1')))));
    requestAnimationFrame(sheetH);
  }
  document.querySelectorAll('.seg').forEach(g => g.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; store.set(g.dataset.k, b.dataset.v); applySettings(); }));

  async function init() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    applySettings(); renderHist();
    const meta = await (await fetch('data/routes.json')).json();
    C.setMeta(meta);
    $('#ver').textContent = `データ作成日 ${meta.built} ／ 路線数 ${meta.routes.length - 1}`;
    map = L.map('map', { zoomControl: false, attributionControl: true }).setView([34.69, 135.5], 11);
    L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', { maxZoom: 19, maxNativeZoom: 18, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a> | © OpenStreetMap contributors' }).addTo(map);
    roadLayer = L.layerGroup().addTo(map); mwLayer = L.layerGroup(); layer = L.layerGroup().addTo(map);
    map.on('click', async e => { const pt = [e.latlng.lng, e.latlng.lat]; const a = await nearAddr(pt); run(pt, a ? a + ' 付近' : '地図で選択した地点'); });
    map.on('moveend', drawRoads);
    buildList(meta);
    drawRoads();
    sheetH();
    showNotice(meta);
    fixOldHist();
  }

  // ---- データ更新のお知らせ ----
  function showNotice(meta) {
    const seen = store.get('seenData', null), n = $('#notice');
    const ch = (meta.changes || []).map(c => `<li>${esc(c)}</li>`).join('');
    if (seen && seen !== meta.built) {
      n.innerHTML = `<b>路線データを更新しました（${esc(meta.built)}）</b>${ch ? `<ul>${ch}</ul>` : ''}<button class="nx" aria-label="閉じる">✕</button>`;
      n.classList.remove('hidden');
    } else {
      const mo = new Date().getMonth() + 1;
      if ((mo === 3 || mo === 4) && store.get('seasonNote', '') !== `${new Date().getFullYear()}`) {
        n.innerHTML = `<b>3〜4月は認定路線の改正が多い時期です</b><div>このアプリのデータ：${esc(meta.built)}時点。改正があれば更新後にここでお知らせします。</div><button class="nx" aria-label="閉じる">✕</button>`;
        n.classList.remove('hidden'); n.dataset.season = '1';
      }
    }
    store.set('seenData', meta.built);
    n.addEventListener('click', e => { if (e.target.closest('.nx')) { n.classList.add('hidden'); if (n.dataset.season) store.set('seasonNote', `${new Date().getFullYear()}`); } });
  }

  // ---- データ読み込み ----
  const bundleOf = k => { const [x, y] = k.split('_').map(Number), n = C.meta().bundle; return `${Math.floor(x / n)}_${Math.floor(y / n)}`; };
  function getBundle(bk, dir = 'b') {
    const ck = dir + '/' + bk;
    if (!bundleCache.has(ck)) bundleCache.set(ck, fetch(`data/${dir}/${bk}.json`).then(r => { if (!r.ok) throw 0; return r.json(); }).catch(e => { bundleCache.delete(ck); throw new Error('データを読み込めません（オフライン時は「保存」タブでデータを保存してください）'); }));
    return bundleCache.get(ck);
  }
  async function getCell(k) {
    if (cellCache.has(k)) return cellCache.get(k);
    if (!C.meta().cells.includes(k)) return { roads: [], blds: [] };
    const wb = C.meta().wb || [], bk = bundleOf(k);
    const p = Promise.all([getBundle(bk), PATCH, wb.includes(bk) ? getBundle(bk, 'w').catch(() => null) : null]).then(([b, pt, w]) => {
      let raw = b[k];
      // 路線の線と道路幅は data/w を優先（無ければ data/b の線）
      if (w) { const wc = w[k]; raw = { r: wc ? wc.r : [], w: wc ? wc.w : null, b: raw ? raw.b : [] }; }
      if (pt[k]) raw = { r: pt[k].r, b: [...(raw ? raw.b : []), ...pt[k]['b+']] };
      return raw ? C.decode(k, raw) : { roads: [], blds: [] };
    });
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

  // ---- 住所検索・入力候補 ----
  async function gsiSearch(q, n) {
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 6000);
    const r = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q), { signal: ctl.signal });
    const j = await r.json();
    return (j || []).slice(0, n).map(x => ({ lng: x.geometry.coordinates[0], lat: x.geometry.coordinates[1], title: x.properties.title, level: '住所' }));
  }
  async function loadAddr() { if (!ADDR) ADDR = await (await fetch('data/addr.json')).json(); return ADDR; }
  // 座標 → いちばん近い町名（オフラインで動く・3km以内）
  async function nearAddr(pt) {
    try {
      const A = await loadAddr(), cl = Math.cos(pt[1] * Math.PI / 180);
      let best = null, bd = Infinity;
      for (const p in A) for (const c in A[p]) for (const t in A[p][c]) {
        const v = A[p][c][t], dx = (v[1] - pt[0]) * cl, dy = v[0] - pt[1], d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = c + t; }
      }
      return best && Math.sqrt(bd) * 111 < 3 ? best : null;
    } catch (e) { return null; }
  }
  // 以前の「地図で選択した地点」の履歴にも住所を付ける
  async function fixOldHist() {
    const h = hist(); let n = 0;
    for (const x of h) if (x.title === '地図で選択した地点') { const a = await nearAddr(x.pt); if (a) { x.title = a + ' 付近'; n++; } }
    if (n) { store.set('hist', h); renderHist(); }
  }
  async function geocode(q) {
    if (navigator.onLine) { try { const r = await gsiSearch(q, 1); if (r[0]) return r[0]; } catch (e) { } }
    return C.offlineGeocode(q, await loadAddr());
  }
  function offlineSuggest(q, A, n) {
    const s = C.normalize(q); const out = [];
    if (s.length < 2) return out;
    for (const p of Object.keys(A)) for (const c of Object.keys(A[p])) {
      const pc = p + c;
      if (!(pc.includes(s) || s.startsWith(pc) || s.startsWith(c) || c.startsWith(s))) continue;
      const rest = s.startsWith(pc) ? s.slice(pc.length) : s.startsWith(c) ? s.slice(c.length) : '';
      for (const t of Object.keys(A[p][c])) {
        if (rest && !t.startsWith(rest) && !t.replace(/^大字|^字/, '').startsWith(rest)) continue;
        const [lat, lng] = A[p][c][t]; out.push({ lng, lat, title: p + c + t, level: '町丁目' });
        if (out.length >= n) return out;
      }
    }
    return out;
  }
  let sugItems = [], sugTimer = null, sugSeq = 0, sugIdx = -1;
  function showSug(items, head) {
    sugItems = items; sugIdx = -1;
    const ul = $('#sug');
    if (!items.length) { ul.classList.add('hidden'); return; }
    ul.innerHTML = (head ? `<li class="sh">${esc(head)}</li>` : '') + items.map((x, i) => `<li role="option" data-i="${i}">${x.fav ? '★ ' : x.hist ? '🕘 ' : ''}${esc(x.title)}${x.v ? ` <span class="badge ${x.v}">${vLabel[x.v]}</span>` : ''}</li>`).join('');
    ul.classList.remove('hidden');
  }
  function histSug() {
    const h = hist().slice(0, 8);
    showSug(h.map(x => ({ ...x, lng: x.pt[0], lat: x.pt[1], hist: true })), h.length ? '最近・お気に入り' : '');
  }
  $('#q').addEventListener('focus', () => { if (!$('#q').value.trim()) histSug(); });
  $('#q').addEventListener('input', () => {
    const q = $('#q').value.trim(); clearTimeout(sugTimer);
    if (!q) { histSug(); return; }
    const seq = ++sugSeq;
    sugTimer = setTimeout(async () => {
      let items = [];
      const hm = hist().filter(x => (x.title || '').includes(q)).slice(0, 3).map(x => ({ ...x, lng: x.pt[0], lat: x.pt[1], hist: true }));
      if (navigator.onLine) { try { items = await gsiSearch(q, 6); } catch (e) { } }
      if (items.length < 6) { try { const seen = new Set(items.map(x => C.normalize(x.title))); for (const x of offlineSuggest(q, await loadAddr(), 12)) { if (items.length >= 6) break; if (!seen.has(C.normalize(x.title))) { items.push(x); seen.add(C.normalize(x.title)); } } } catch (e) { } }
      if (seq === sugSeq) showSug([...hm, ...items]);
    }, 250);
  });
  $('#q').addEventListener('keydown', e => {
    if ($('#sug').classList.contains('hidden')) return;
    const lis = [...$('#sug').querySelectorAll('li[data-i]')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sugIdx = (sugIdx + (e.key === 'ArrowDown' ? 1 : -1) + lis.length) % lis.length; lis.forEach((l, i) => l.classList.toggle('on', i === sugIdx)); }
    else if (e.key === 'Enter' && sugIdx >= 0) { e.preventDefault(); pickSug(sugIdx); }
    else if (e.key === 'Escape') $('#sug').classList.add('hidden');
  });
  $('#sug').addEventListener('mousedown', e => e.preventDefault());
  $('#sug').addEventListener('click', e => { const li = e.target.closest('li[data-i]'); if (li) pickSug(+li.dataset.i); });
  function pickSug(i) {
    const x = sugItems[i]; if (!x) return;
    $('#sug').classList.add('hidden'); $('#q').value = x.title; $('#q').blur();
    run([x.lng, x.lat], x.title, x.level);
  }
  document.addEventListener('click', e => { if (!e.target.closest('.topbar')) $('#sug').classList.add('hidden'); });

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
    const sum = r.hits.length ? r.hits.map(h => `${h.route.name.replace(/^主要地方道|^(府|県)道/, '')}（${h.dirs.join('・') || '直上'}）`).join('、') : '';
    const k = keyOf(pt), old = hist().find(x => keyOf(x.pt) === k);
    addHist({ pt, title, level, v: r.verdict, sum, t: Date.now(), fav: old ? !!old.fav : false });
    updateFavBtn();
  }
  function updateFavBtn() {
    const b = $('#btnFav'); if (!b || !last) return;
    const x = hist().find(x => keyOf(x.pt) === keyOf(last.pt));
    b.textContent = x && x.fav ? '★ お気に入り' : '☆ お気に入りに追加'; b.classList.toggle('on', !!(x && x.fav));
  }

  // ---- シート ----
  const sheet = $('#sheet');
  function sheetH() { const h = innerWidth >= 820 ? 0 : sheet.getBoundingClientRect().height; document.documentElement.style.setProperty('--sheet-h', h + 'px'); }
  function setPeek(html, hasDetail) { $('#peek').innerHTML = html; sheet.classList.toggle('idle', !hasDetail); if (!hasDetail) { sheet.classList.remove('open'); $('#detail').innerHTML = ''; } requestAnimationFrame(sheetH); }
  const toggle = open => { sheet.classList.toggle('open', open ?? !sheet.classList.contains('open')); requestAnimationFrame(sheetH); };
  $('#grab').onclick = () => toggle();
  $('#peek').addEventListener('click', () => { if (!sheet.classList.contains('idle')) toggle(); });
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
    const lab = vLabel[r.verdict];
    const base = r.building ? '建物' : '地点';
    let chips;
    if (r.hits.length) chips = `<div class="rchips">${r.hits.map(h => `<span class="rc ${h.warn ? 'w' : ''}"><b>${esc(shortDir(h.dirs))}</b>${esc(h.route.name.replace(/^主要地方道|^(府|県)道/, ''))}</span>`).join('')}</div>`;
    else chips = `<div class="ngtxt">${(n0 => n0 ? `最寄り：${esc(n0.route.name)} 約${n0.d.toFixed(0)}m` : `周辺に認定路線なし`)(r.near.find(n => n.route.id !== 'MW'))}</div>`;
    const lv = level && level !== '住所' ? `（${esc(level)}の位置）` : '';
    setPeek(`<div class="sum"><div class="vb ${r.verdict}">${lab}</div><div class="t"><div class="ad">${esc(title || '')}${lv}</div>${chips}</div></div>`, true);

    let h = `<div class="acts"><button id="btnFav" class="plain">☆ お気に入りに追加</button></div>`;
    for (const x of r.hits) {
      h += `<div class="hit">${compass(x.sideIdx)}<div><div class="nm">${esc(x.route.name)}</div>`
        + `<div>${base}の <span class="dirs">${esc(shortDir(x.dirs))}${x.dirs.length ? '側' : ''}</span> に接道</div>`
        + `<div class="meta">${esc(x.route.pref)}${x.route.no ? ` 認定No.${x.route.no}` : ''}・道路端まで約${x.emin.toFixed(0)}m</div>`
        + (x.warn ? `<div class="note">⚠ ${esc(x.warn)}</div>` : '')
        + (x.route.group ? `<div class="meta">和歌山県警の認定路線図から取得（市道・町道・港湾道路）</div>` : x.route.sec.type !== 'all' ? `<div class="meta">区間：${esc(x.route.sec.text || (x.route.sec.munis || []).join('、'))}</div>` : '') + `</div></div>`;
    }
    const nr = r.near.filter(n => n.d < 200 && n.route.id !== 'MW');
    const mw = r.near.find(n => n.route.id === 'MW' && n.d < 60);
    if (mw && !showMw) h += `<div class="foot">⚠ 約${mw.d.toFixed(0)}mに高速道路・自動車専用道路があります（高架下・側道の作業は現地確認）。上の「高速道路も表示・判定」にチェックで判定に含めます。</div>`;
    if (nr.length) h += `<div class="foot">近くの認定路線：${nr.map(n => `${esc(n.route.name)} 約${n.d.toFixed(0)}m`).join('／')}</div>`;
    if (level && level !== '住所') h += `<div class="foot">${esc(level)}レベルの位置です。対象の建物を地図でタップすると正確に判定できます。</div>`;
    h += `<div class="foot">${r.building ? '建物の外周' : '地点（建物データなし）'}から道路端まで${r.th}m以内・間に建物なしで「接道」。参考判定です。最終確認は最新の公安委員会告示で。</div>`;
    $('#detail').innerHTML = h;
    $('#btnFav').onclick = () => { if (!last) return; const on = toggleFav(keyOf(last.pt)); updateFavBtn(); toast(on ? 'お気に入りに追加しました' : 'お気に入りを外しました'); };
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
    let h = '<p class="muted">高速自動車国道・自動車専用道路も全府県で配置対象です（上の「高速道路も表示・判定」で紫線を表示）。</p>';
    for (const [p, rs] of Object.entries(by)) {
      const real = rs.filter(r => r.no);
      h += `<div class="pref">${p}（${real.length}路線）</div><div class="muted">${esc(real[0].src)}</div>`;
      h += real.map(r => `<div class="rl ${r.mapped ? '' : 'un'}"><span>${r.no}.</span><div>${esc(r.name)}<div class="s">${esc(r.sec.type === 'all' ? '全域' : r.sec.type === 'muni' ? r.sec.munis.join('、') : r.sec.text)}</div></div>${!r.mapped ? '<span class="tag">地図未整備</span>' : r.group ? '<span class="tag">路線図から収録</span>' : (r.note ? '<span class="tag">要確認</span>' : '')}</div>`).join('');
    }
    $('#t-list').innerHTML = h;
  }

  async function downloadAll() {
    const keys = [...C.meta().bundles.map(k => 'b/' + k), ...(C.meta().wb || []).map(k => 'w/' + k)]; let done = 0; $('#btnDl').disabled = true;
    const cache = await caches.open('rosen-data-v2');
    try { await cache.add('data/addr.json'); await cache.add('data/patch.json'); } catch (e) { }
    const q = [...keys];
    const worker = async () => { while (q.length) { const k = q.shift(); try { await cache.add(`data/${k}.json`); } catch (e) { } done++; $('#dlBar').style.width = (done / keys.length * 100) + '%'; $('#dlMsg').textContent = `${done} / ${keys.length}`; } };
    await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
    $('#dlMsg').textContent = '保存しました。電波がなくても判定できます。'; $('#btnDl').disabled = false;
  }

  $('#f').addEventListener('submit', async e => {
    e.preventDefault(); const q = $('#q').value.trim(); if (!q) return; $('#q').blur(); $('#sug').classList.add('hidden');
    let g; try { g = await geocode(q); } catch (err) { toast('住所データを読み込めません（オフライン時は事前に「保存」タブでデータを保存）'); return; }
    if (!g) { toast('住所が見つかりません（関西2府4県の住所を入力）'); return; }
    run([g.lng, g.lat], g.title, g.level);
  });
  $('#btnGps').addEventListener('click', () => {
    if (!navigator.geolocation) return toast('位置情報が使えません');
    toast('現在地を取得中…');
    navigator.geolocation.getCurrentPosition(async p => { const pt = [p.coords.longitude, p.coords.latitude]; const a = await nearAddr(pt); run(pt, `${a ? a + ' 付近' : '現在地'}（現在地・誤差 約${Math.round(p.coords.accuracy)}m）`); }, () => toast('現在地を取得できませんでした'), { enableHighAccuracy: true, timeout: 15000 });
  });
  $('#th').addEventListener('change', () => { if (last) run(last.pt, last.title, last.level); });
  $('#btnMenu').onclick = () => { renderHist(); $('#drawer').classList.remove('hidden'); };
  $('#btnClose').onclick = () => $('#drawer').classList.add('hidden');
  $('#drawer').addEventListener('click', e => { if (e.target.id === 'drawer') $('#drawer').classList.add('hidden'); });
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b)); document.querySelectorAll('.tab').forEach(t => t.classList.toggle('hidden', t.id !== 't-' + b.dataset.t)); });
  $('#btnDl').onclick = downloadAll;
  $('#chkMw').onchange = () => { showMw = $('#chkMw').checked; showMw ? mwLayer.addTo(map) : mwLayer.remove(); if (last) run(last.pt, last.title, last.level); };
  init().catch(e => toast('初期化エラー: ' + e.message, 6000));
})();
