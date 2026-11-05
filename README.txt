指定路線チェッカー（関西2府4県）PWA版 v0.1  2026-11-05

■ 動かし方（PC）
  このフォルダで:  python -m http.server 8000
  ブラウザで http://localhost:8000 を開く
■ スマホで使う／ホーム画面に追加（オフライン可）
  HTTPS 公開が必要（GitHub Pages / Cloudflare Pages 等・無料）→ フォルダをそのままアップロード
■ データ更新（告示改正時）
  tools/routes_src.py の路線表を直す → extract.py → admin.py → match.py → sections.py → buildings.py → pack.py
■ 出典
  各府県公安委員会告示／地図・道路・建物: © OpenStreetMap contributors (ODbL)／背景地図: 国土地理院／住所: 国土地理院 住所検索・Geolonia 住所データ(CC BY 4.0)
