/* 判定コア（ブラウザ／Node共通） */
(function (root) {
  const C = {};
  let META = null;
  const DIRS = ['北', '東', '南', '西'];
  C.DIRS = DIRS;
  C.setMeta = m => { META = m; };
  C.meta = () => META;
  C.cellKey = (lng, lat) => `${Math.floor(lng / META.cell)}_${Math.floor(lat / META.cell)}`;
  C.cellsAround = (lng, lat) => {
    const ix = Math.floor(lng / META.cell), iy = Math.floor(lat / META.cell), out = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) out.push(`${ix + dx}_${iy + dy}`);
    return out;
  };
  C.decode = (key, raw) => {
    const [ix, iy] = key.split('_').map(Number), ox = ix * META.cell, oy = iy * META.cell, q = META.q;
    const dec = (a, s) => { const p = []; let x = 0, y = 0; for (let i = s; i < a.length; i += 2) { x += a[i]; y += a[i + 1]; p.push([ox + x / q, oy + y / q]); } return p; };
    return { roads: raw.r.map(a => ({ ri: a[0], pts: dec(a, 1) })), blds: raw.b.map(a => dec(a, 0)) };
  };
  // 平面近似（m）
  const proj = (lng0, lat0) => { const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110574; return { f: ([x, y]) => [(x - lng0) * kx, (y - lat0) * ky], inv: ([x, y]) => [x / kx + lng0, y / ky + lat0] }; };
  const near = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return [a[0] + t * dx, a[1] + t * dy]; };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const pip = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const area = poly => { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  const octant = (vx, vy) => { let ang = Math.atan2(vx, vy) * 180 / Math.PI; if (ang < 0) ang += 360; return Math.round(ang / 90) % 4; };
  C.octant = octant;

  /** pt=[lng,lat], data={roads,blds}, opt={th:30, building:true} */
  C.judge = (pt, data, opt = {}) => {
    const th = opt.th || 30, P = proj(pt[0], pt[1]), p0 = [0, 0];
    // 建物の特定
    let bld = null, bldXY = null;
    if (opt.building !== false) {
      let best = 9;
      for (const b of data.blds) {
        const xy = b.map(P.f);
        let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
        for (const [x, y] of xy) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
        if (minx > best || maxx < -best || miny > best || maxy < -best) continue;
        if (pip(p0, xy)) { bld = b; bldXY = xy; best = 0; break; }
        for (let i = 0; i < xy.length; i++) { const d = dist(p0, near(p0, xy[i], xy[(i + 1) % xy.length])); if (d < best) { best = d; bld = b; bldXY = xy; } }
      }
    }
    // サンプル点（建物外周 or 地点）
    const samples = [];
    if (bldXY) {
      const ccw = area(bldXY) > 0;
      for (let i = 0; i < bldXY.length; i++) {
        const a = bldXY[i], b = bldXY[(i + 1) % bldXY.length], L = dist(a, b);
        if (L < 0.3) continue;
        const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, n = ccw ? [uy, -ux] : [-uy, ux];
        const k = Math.max(1, Math.ceil(L / 1.5));
        for (let j = 0; j <= k; j++) samples.push({ p: [a[0] + ux * L * j / k, a[1] + uy * L * j / k], n });
      }
    } else samples.push({ p: p0, n: null });
    let R = 0; for (const s of samples) R = Math.max(R, Math.hypot(s.p[0], s.p[1]));
    const routes = META.routes;
    // 道路の片側幅（中心線→道路端）の目安：建物から道路端までを判定距離で測る
    const halfW = r => r.id === 'MW' ? 12 : /^国道/.test(r.name) ? 10 : /^主要地方道/.test(r.name) ? 8 : /^(府道|県道)/.test(r.name) ? 6 : 4;
    const reach = R + th + 12, nearR = Math.max(150, R + 120);
    // 間に別の建物がある場合は「接道していない」とみなすための障害物（周辺建物の辺）
    const obst = [];
    for (const b of data.blds) {
      if (b === bld) continue;
      const xy = b.map(P.f); let ok = false;
      for (const q of xy) if (Math.abs(q[0]) < reach && Math.abs(q[1]) < reach) { ok = true; break; }
      if (!ok || (!bld && pip(p0, xy))) continue;
      for (let i = 0; i < xy.length; i++) { const u = xy[i], v = xy[(i + 1) % xy.length]; obst.push([u[0], u[1], v[0], v[1], Math.min(u[0], v[0]), Math.max(u[0], v[0]), Math.min(u[1], v[1]), Math.max(u[1], v[1])]); }
    }
    const cross = (p, q) => {
      const x0 = Math.min(p[0], q[0]), x1 = Math.max(p[0], q[0]), y0 = Math.min(p[1], q[1]), y1 = Math.max(p[1], q[1]);
      for (const e of obst) {
        if (e[5] < x0 || e[4] > x1 || e[7] < y0 || e[6] > y1) continue;
        const d1 = (q[0] - p[0]) * (e[1] - p[1]) - (q[1] - p[1]) * (e[0] - p[0]), d2 = (q[0] - p[0]) * (e[3] - p[1]) - (q[1] - p[1]) * (e[2] - p[0]);
        const d3 = (e[2] - e[0]) * (p[1] - e[1]) - (e[3] - e[1]) * (p[0] - e[0]), d4 = (e[2] - e[0]) * (q[1] - e[1]) - (e[3] - e[1]) * (q[0] - e[0]);
        if (d1 * d2 < 0 && d3 * d4 < 0) return true;
      }
      return false;
    };
    const cand = new Map(), nears = new Map();
    for (const rd of data.roads) {
      const r = routes[rd.ri], lim = th + halfW(r), xy = rd.pts.map(P.f);
      for (let i = 0; i < xy.length - 1; i++) {
        const a = xy[i], b = xy[i + 1];
        const c0 = near(p0, a, b), d0 = dist(p0, c0);
        if (d0 > nearR + R) continue;
        const nn = nears.get(rd.ri); if (!nn || d0 < nn.d) nears.set(rd.ri, { d: d0, pt: P.inv(c0) });
        if (d0 > R + lim || (r.id === 'MW' && !opt.mw)) continue;
        for (const s of samples) {
          const c = near(s.p, a, b), d = dist(s.p, c);
          if (d > lim) continue;
          let o;
          if (s.n) {
            if (d > 0.5) { const vx = (c[0] - s.p[0]) / d, vy = (c[1] - s.p[1]) / d; if (vx * s.n[0] + vy * s.n[1] < 0.35) continue; }
            o = octant(s.n[0], s.n[1]);
          } else o = d > 0.5 ? octant(c[0] - s.p[0], c[1] - s.p[1]) : 0;
          const k = rd.ri + ':' + o; let L = cand.get(k); if (!L) cand.set(k, L = []);
          L.push({ ri: rd.ri, o, d, sp: s.p, c, edge: Math.max(0, d - halfW(r)) });
        }
      }
    }
    const hits = new Map();
    for (const L of cand.values()) {
      L.sort((x, y) => x.d - y.d);
      const step = Math.max(1, Math.floor(L.length / 40));
      for (let i = 0; i < L.length; i += (i < 10 ? 1 : step)) {
        const c = L[i];
        // 道路端の手前までの線で遮りを確認（中央分離帯の建物等は無視）
        const t = c.d > 0.5 ? Math.max(0, (c.d - halfW(routes[c.ri])) / c.d) : 0;
        const q = [c.sp[0] + (c.c[0] - c.sp[0]) * t, c.sp[1] + (c.c[1] - c.sp[1]) * t];
        if (t > 0 && cross(c.sp, q)) continue;
        let h = hits.get(c.ri); if (!h) { h = { ri: c.ri, sides: {}, dmin: Infinity, emin: Infinity }; hits.set(c.ri, h); }
        if (samples[0].n || c.d > 0.5) h.sides[c.o] = { d: c.d, from: P.inv(c.sp), to: P.inv(c.c) };
        if (c.d < h.dmin) { h.dmin = c.d; h.emin = c.edge; h.from = P.inv(c.sp); h.to = P.inv(c.c); }
        break;
      }
    }
    const hitList = [...hits.values()].map(h => {
      const r = routes[h.ri];
      let warn = null;
      if (r.note && !r.group) warn = r.note;
      if (r.ends && r.ends.length) {
        const Q = proj(h.to[0], h.to[1]);
        for (const e of r.ends) { if ((e.d || 0) > 100 && dist([0, 0], Q.f(e.pt)) < e.d + 60) { warn = '区間の始点・終点付近です（告示の区間を要確認）'; break; } }
      }
      const sideIdx = Object.keys(h.sides).map(Number).sort((a, b) => a - b);
      return { ...h, route: r, warn, dirs: sideIdx.map(i => DIRS[i]), sideIdx };
    }).sort((a, b) => a.dmin - b.dmin);
    const nearList = [...nears.entries()].filter(([ri]) => !hits.has(ri)).map(([ri, v]) => ({ ri, route: routes[ri], d: v.d, pt: v.pt })).sort((a, b) => a.d - b.d).slice(0, 4);
    let verdict = 'ng';
    if (hitList.length) verdict = hitList.some(h => !h.warn) ? 'ok' : 'warn';
    else if (nearList.some(n => n.d <= th + 15 && (n.route.id !== 'MW' || opt.mw))) verdict = 'warn';
    return { verdict, building: bld, hits: hitList, near: nearList, th };
  };

  // オフライン住所→座標（町丁目レベル）
  const KNUM = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const toKanji = n => { n = +n; if (n < 10) return KNUM[n]; if (n < 20) return '十' + (n % 10 ? KNUM[n % 10] : ''); if (n < 100) return KNUM[Math.floor(n / 10)] + '十' + (n % 10 ? KNUM[n % 10] : ''); return String(n); };
  C.normalize = s => s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[－‐―ー−]/g, '-').replace(/\s/g, '').replace(/ヶ/g, 'ケ');
  C.offlineGeocode = (q, A) => {
    let s = C.normalize(q), pref = Object.keys(A).find(p => s.startsWith(p));
    if (pref) s = s.slice(pref.length);
    const prefs = pref ? [pref] : Object.keys(A);
    let best = null;
    for (const p of prefs) for (const city of Object.keys(A[p])) {
      const cn = city.replace(/ヶ/g, 'ケ');
      let rest = null;
      if (s.startsWith(cn)) rest = s.slice(cn.length);
      else { const m = city.match(/^(.+?郡)(.+)$/); if (m && s.startsWith(m[2].replace(/ヶ/g, 'ケ'))) rest = s.slice(m[2].length); }
      if (rest !== null && (!best || cn.length > best.city.length)) best = { pref: p, city, rest };
    }
    if (!best) return null;
    const towns = A[best.pref][best.city];
    const v = [best.rest, best.rest.replace(/^(\D+?)(\d+)(丁目|-|$)/, (m, a, n) => a + toKanji(n) + '丁目')];
    let tk = null;
    for (const t of Object.keys(towns)) { const tn = t.replace(/ヶ/g, 'ケ'), tn2 = tn.replace(/^大字|^字/, ''); if (v.some(x => x.startsWith(tn) || x.startsWith(tn2)) && (!tk || t.length > tk.length)) tk = t; }
    if (tk) { const [lat, lng] = towns[tk]; return { lng, lat, title: best.pref + best.city + tk, level: '町丁目' }; }
    const all = Object.values(towns); if (!all.length) return null;
    const lat = all.reduce((a, b) => a + b[0], 0) / all.length, lng = all.reduce((a, b) => a + b[1], 0) / all.length;
    return { lng, lat, title: best.pref + best.city, level: '市区町村' };
  };
  if (typeof module !== 'undefined') module.exports = C; else root.Core = C;
})(this);
