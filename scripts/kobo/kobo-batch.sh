#!/usr/bin/env bash
# 楽天Kobo 全冊出版バッチ (F-095)。
#   - デバッグで作った既存商品UUID(dup-uuids.txt)をまず別々の書籍で上書き出版(削除不可のため再利用)
#   - UUIDを使い切ったら新規作成で出版
#   - 出版済みは kobo-map.txt(bookId uuid) で記録し二度と出さない(重複防止)
#   - アダルト(戦場/オナニスト)は除外
#   nohup bash scripts/paperback/pb-env.sh bash scripts/kobo/kobo-batch.sh > scripts/kobo/kobo-batch.log 2>&1 &
set -uo pipefail
cd /c/DEV/M2P
LOCK=scripts/kobo/.batch.lock
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK")" 2>/dev/null; then echo "既に稼働中 pid=$(cat "$LOCK")"; exit 0; fi
echo $$ > "$LOCK"; trap 'rm -f "$LOCK"' EXIT
MAP=scripts/kobo/kobo-map.txt; touch "$MAP"
UUIDS=scripts/kobo/dup-uuids.txt

# 対象書籍(done+資産あり, 新NISA除外, アダルト除外, 未Kobo, 未マップ)を取得
LIST=$(DBURL="$DBURL" node -e "
const {Client}=require('./node_modules/.pnpm/pg@8.21.0/node_modules/pg');
const fs=require('fs');
const mapped=new Set(fs.readFileSync('$MAP','utf8').split(/\r?\n/).filter(Boolean).map(l=>l.split(' ')[0]));
(async()=>{const c=new Client({connectionString:process.env.DBURL,ssl:{rejectUnauthorized:false}});await c.connect();
const q=await c.query(\`SELECT b.id FROM books b LEFT JOIN theme_candidates tc ON tc.id=b.theme_id
  WHERE b.status IN ('done','needs_human_review') AND b.id<>'cms7rr9dz000pmr0vldlrtocz'
    AND COALESCE(b.kobo_publish_status,'unlisted') IN ('unlisted','failed')
    AND COALESCE(tc.genre,'') NOT IN ('adult') AND b.title !~ 'オナニスト|官能'
    AND EXISTS(SELECT 1 FROM kdp_metadata km WHERE km.book_id=b.id)
    AND EXISTS(SELECT 1 FROM covers cv WHERE cv.book_id=b.id AND cv.status='adopted')
    AND EXISTS(SELECT 1 FROM chapters ch WHERE ch.book_id=b.id)
    AND NOT EXISTS(SELECT 1 FROM revision_comments rc WHERE rc.book_id=b.id AND rc.priority='must' AND rc.status='pending')
  ORDER BY b.done_at DESC NULLS LAST\`);
for(const r of q.rows)if(!mapped.has(r.id))console.log(r.id);
await c.end();})().catch(e=>{console.error(e.message);process.exit(1)})")

# 未使用UUIDのキュー(map済みで使われたuuidを除く)
mapfile -t ALL_UUIDS < "$UUIDS"
usedUuids=$(awk '{print $2}' "$MAP")
avail=(); for u in "${ALL_UUIDS[@]}"; do echo "$usedUuids" | grep -q "$u" || avail+=("$u"); done
ui=0

ok=0; fail=0
for bid in $LIST; do
  [ -z "$bid" ] && continue
  # EPUB+表紙生成
  node scripts/bookwalker/build-epub.mjs "$bid" > "scripts/kobo/out/$bid-epub.log" 2>&1
  [ -f "scripts/bookwalker/out/$bid-cover.jpg" ] || node scripts/bookwalker/bw-cover-jpg.mjs "$bid" > "scripts/kobo/out/$bid-cover.log" 2>&1
  if [ ! -f "scripts/bookwalker/out/$bid.epub" ] || [ ! -f "scripts/bookwalker/out/$bid-cover.jpg" ]; then echo "SKIP(no assets) $bid"; continue; fi
  # 既存UUIDがあれば上書き、無ければ新規
  tgt=""; if [ $ui -lt ${#avail[@]} ]; then tgt="${avail[$ui]}"; fi
  echo "=== $bid $(date '+%m/%d %H:%M') $([ -n "$tgt" ] && echo "上書き:${tgt:0:8}" || echo "新規") ==="
  if [ -n "$tgt" ]; then
    KWL_TARGET_ID="$tgt" timeout 260 node scripts/kobo/kwl-submit.mjs "$bid" --submit > "scripts/kobo/out/$bid-kobo.log" 2>&1
  else
    timeout 260 node scripts/kobo/kwl-submit.mjs "$bid" --submit > "scripts/kobo/out/$bid-kobo.log" 2>&1
  fi
  # 結果判定 + マップ記録
  uuid=$(grep -oE 'ebook/[0-9a-f-]{20,}' "scripts/kobo/out/$bid-kobo.log" | head -1 | sed 's#ebook/##')
  [ -z "$uuid" ] && uuid="$tgt"
  if grep -q 'KOBO_SUBMITTED' "scripts/kobo/out/$bid-kobo.log"; then
    echo "✅ Kobo出版 $bid -> ${uuid:0:8}"; echo "$bid $uuid" >> "$MAP"; ok=$((ok+1))
    [ -n "$tgt" ] && ui=$((ui+1))
    DBURL="$DBURL" node -e "const {Client}=require('./node_modules/.pnpm/pg@8.21.0/node_modules/pg');(async()=>{const c=new Client({connectionString:process.env.DBURL,ssl:{rejectUnauthorized:false}});await c.connect();await c.query(\"UPDATE books SET kobo_publish_status='submitted', kobo_submitted_at=NOW(), kobo_publish_queued=false WHERE id=\$1\",['$bid']);await c.end();})().catch(()=>{})"
  else
    echo "Kobo NG $bid ($(grep -oE 'KOBO_FAILED status=\w+' "scripts/kobo/out/$bid-kobo.log" | head -1))"; fail=$((fail+1))
    # 新規作成で商品ができていれば次回のUUID再利用のためavailに足す(削除不可なので無駄にしない)
    [ -z "$tgt" ] && [ -n "$uuid" ] && avail+=("$uuid")
  fi
  sleep 8
done
echo "KOBO BATCH DONE ok=$ok fail=$fail"
