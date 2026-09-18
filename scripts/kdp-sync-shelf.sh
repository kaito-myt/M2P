#!/usr/bin/env bash
# KDP 本棚(READ-ONLY スキャン)と DB の publish_status を同期する。
#   bash scripts/paperback/pb-env.sh bash scripts/kdp-sync-shelf.sh
# 背景(2026-09-15): サーバー側 kdp.publish.status.sync が機能しておらず、本棚で「販売中」の
# 48冊が DB では「審査中(submitted)」のまま。表示上「出版できていない」ように見えていた。
set -uo pipefail
cd /c/DEV/M2P
OUT=scripts/paperback/out/kdp-shelf-scan.txt
bash scripts/kdp-scan.sh > "$OUT" 2>&1
grep -E "listing 総数" "$OUT"
node - "$OUT" <<'JS'
const { createRequire } = require('module'); const path = require('path'); const fs = require('fs');
const { Client } = createRequire(path.join('C:/DEV/M2P','package.json'))(path.join('C:/DEV/M2P','node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
(async () => {
  const txt = fs.readFileSync(process.argv[2], 'utf8');
  const live = [...txt.matchAll(/^\[販売中\] asin=(B0[A-Z0-9]+) id=([A-Z0-9]+)\s+title="([^"]+)"/gm)].map(m => ({ asin: m[1], title: m[3] }));
  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } }); await c.connect();
  let n = 0;
  for (const b of live) {
    let r = await c.query("update books set publish_status='published', updated_at=now() where asin=$1 and publish_status<>'published'", [b.asin]);
    // 2026-09-18: 同題の別レコードが既に同じ ASIN を持つと books_asin_key で落ちる → ASIN 未使用のときだけタイトル一致で更新
    if (!r.rowCount) r = await c.query("update books set publish_status='published', asin=coalesce(asin,$2), updated_at=now(), kdp_publish_queued=false, kdp_publish_queued_at=null where title=$1 and publish_status in ('submitted','unlisted') and not exists (select 1 from books b2 where b2.asin=$2 and b2.id<>books.id)", [b.title, b.asin]);
    n += r.rowCount;
  }
  console.log('本棚 販売中', live.length, '冊 / DB を published に更新', n, '冊');
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
JS
