const SHELL='rosen-shell-v2', DATA='rosen-data-v2', TILE='rosen-tile-v1';
const ASSETS=['./','index.html','style.css','core.js','app.js','manifest.json','vendor/leaflet.js','vendor/leaflet.css','data/routes.json','data/addr.json','icons/icon-192.png','icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(SHELL).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>![SHELL,DATA,TILE].includes(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.hostname==='cyberjapandata.gsi.go.jp'){ // 地図タイル：キャッシュ優先＋表示した分を保存
    e.respondWith(caches.open(TILE).then(async c=>{const hit=await c.match(e.request);if(hit)return hit;try{const r=await fetch(e.request);if(r.ok||r.type==='opaque')c.put(e.request,r.clone());return r;}catch(x){return new Response('',{status:504});}}));return;}
  if(u.origin!==location.origin) return;
  if(u.pathname.includes('/data/')){ // データ：キャッシュ優先
    e.respondWith(caches.open(DATA).then(async c=>{const hit=await c.match(e.request)||await caches.match(e.request);if(hit)return hit;const r=await fetch(e.request);if(r.ok)c.put(e.request,r.clone());return r;}));return;}
  e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(SHELL).then(c=>c.put(e.request,cp));return r;}).catch(()=>caches.match(e.request)));
});
