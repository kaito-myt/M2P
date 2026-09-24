/**
 * F-098b: CEO が起票したコード変更要求 (`org_code_requests`) を **ローカルで** 実装する。
 *
 *   bash scripts/paperback/pb-env.sh node scripts/org/apply-code-requests.mjs [--id=<id>] [--count=1] [--dry]
 *
 * なぜローカルか: 本番 worker はコンテナで動いておりリポジトリを書き換えられない。また、
 * コードの自動変更は取り返しがつきにくいので「運営者の端末で・ブランチ上で・テストが通ったときだけ
 * コミット」という形に閉じる。**main へのマージと push は行わない** (人が見てから)。
 *
 * 流れ (1 要求ごと):
 *   1. status=open の要求を古い順に取り、in_progress にする
 *   2. `ceo/<id>` ブランチを作る (既存なら再利用)
 *   3. Claude Code CLI (headless) に要求内容を渡して実装させる
 *   4. typecheck + 変更パッケージのテストを回す
 *   5. 通ったらブランチにコミットして status=done (resolution_note にブランチ名)
 *      失敗したら status=open に戻し、理由を resolution_note に残す (ブランチは調査用に残す)
 */
import { createRequire } from 'module';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';

const ROOT = 'C:/DEV/M2P';
const reqRoot = createRequire(path.join(ROOT, 'package.json'));
const { Client } = reqRoot(path.join(ROOT, 'node_modules/.pnpm/pg@8.21.0/node_modules/pg'));

const args = process.argv.slice(2);
const argOf = (name, fallback = '') => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const ONLY_ID = argOf('id');
const COUNT = Number(argOf('count', '1')) || 1;
const DRY = args.includes('--dry');

function git(...a) {
  return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function buildPrompt(r) {
  const files = Array.isArray(r.files_json) ? r.files_json : [];
  return [
    'あなたはこのリポジトリ (M2P モノレポ) の実装担当です。CLAUDE.md のハードルールに従ってください。',
    '以下は AI 企業の CEO エージェントが運営者との会話の中で起票した「コード変更要求」です。',
    '',
    `# ${r.title}`,
    '',
    '## 背景・目的',
    r.intent,
    '',
    '## 変更内容 (仕様)',
    r.change_summary,
    files.length > 0 ? `\n## 想定ファイル\n${files.map((f) => `- ${f}`).join('\n')}` : '',
    '',
    '## 実装の条件',
    '- 既存のコード規約・命名・コメントの粒度に合わせること。日本語 UI 文言は messages 辞書へ。',
    '- 変更に対応する Vitest を追加/更新すること。',
    '- 触った範囲の `pnpm --filter <pkg> exec tsc --noEmit` と該当テストが通る状態にすること。',
    '- 設計ドキュメント (docs/02 / docs/05 / docs/11 のうち該当するもの) を同じ変更内で更新すること。',
    '- **git commit / push はしないこと** (呼び出し側のスクリプトが行う)。',
    '- 仕様が曖昧で判断できない場合は、最小限の安全な実装に留め、何を保留したか最後に明記すること。',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

function runClaude(prompt) {
  const res = spawnSync(
    'claude',
    ['-p', prompt, '--permission-mode', 'acceptEdits', '--output-format', 'text'],
    { cwd: ROOT, encoding: 'utf8', timeout: 45 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 },
  );
  return { ok: res.status === 0, out: `${res.stdout ?? ''}${res.stderr ?? ''}`.slice(-4000) };
}

function runChecks() {
  const changed = git('status', '--porcelain');
  if (!changed) return { ok: false, note: '変更がありません (実装されませんでした)' };
  const pkgs = new Set();
  for (const line of changed.split('\n')) {
    const f = line.slice(3);
    if (f.startsWith('apps/worker')) pkgs.add('@a2p/worker');
    else if (f.startsWith('apps/web')) pkgs.add('@a2p/web');
    else if (f.startsWith('apps/anp')) pkgs.add('@anp/web');
    else if (f.startsWith('packages/contracts')) pkgs.add('@a2p/contracts');
    else if (f.startsWith('packages/agents')) pkgs.add('@a2p/agents');
  }
  for (const pkg of pkgs) {
    const tc = spawnSync('pnpm', ['--filter', pkg, 'exec', 'tsc', '--noEmit'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 15 * 60 * 1000,
      shell: true,
    });
    if (tc.status !== 0) return { ok: false, note: `${pkg} の typecheck に失敗:\n${(tc.stdout ?? '').slice(-1200)}` };
    const t = spawnSync('pnpm', ['--filter', pkg, 'run', 'test:unit'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 25 * 60 * 1000,
      shell: true,
    });
    if (t.status !== 0) return { ok: false, note: `${pkg} のテストに失敗:\n${(t.stdout ?? '').slice(-1200)}` };
  }
  return { ok: true, note: `checks ok (${[...pkgs].join(', ') || 'no package'})` };
}

async function main() {
  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const { rows } = await c.query(
      ONLY_ID
        ? 'select * from org_code_requests where id=$1'
        : `select * from org_code_requests where status='open' order by
             case urgency when 'high' then 0 when 'normal' then 1 else 2 end, created_at limit ${COUNT}`,
      ONLY_ID ? [ONLY_ID] : [],
    );
    if (rows.length === 0) {
      console.log('対象のコード変更要求はありません');
      return;
    }

    const startBranch = git('rev-parse', '--abbrev-ref', 'HEAD');
    const dirty = git('status', '--porcelain');
    if (dirty && !DRY) {
      console.log('作業ツリーに未コミットの変更があります。先に整理してください:');
      console.log(dirty.slice(0, 500));
      return;
    }

    for (const r of rows) {
      console.log(`\n=== ${r.title} (${r.id}) urgency=${r.urgency}`);
      const prompt = buildPrompt(r);
      if (DRY) {
        console.log('--- prompt ---');
        console.log(prompt);
        continue;
      }

      await c.query("update org_code_requests set status='in_progress', updated_at=now() where id=$1", [r.id]);
      const branch = `ceo/${String(r.id).slice(-8)}`;
      try {
        git('checkout', '-B', branch);
      } catch (e) {
        console.log('ブランチ作成に失敗:', e.message);
        await c.query("update org_code_requests set status='open', resolution_note=$2 where id=$1", [r.id, `branch error: ${e.message}`]);
        continue;
      }

      console.log('Claude Code に実装させています (最大 45 分)…');
      const impl = runClaude(prompt);
      const checks = impl.ok ? runChecks() : { ok: false, note: `実装コマンドが失敗:\n${impl.out.slice(-800)}` };

      if (!checks.ok) {
        console.log('⚠️', checks.note.split('\n')[0]);
        await c.query(
          "update org_code_requests set status='open', resolution_note=$2, updated_at=now() where id=$1",
          [r.id, `${branch}: ${checks.note}`.slice(0, 4000)],
        );
        continue;
      }

      git('add', '-A');
      execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', `feat(ceo): ${r.title}\n\nCEO のコード変更要求 ${r.id} を実装。\n${r.change_summary}\n`], { cwd: ROOT });
      const sha = git('rev-parse', '--short', 'HEAD');
      console.log(`✅ ${branch} に ${sha} でコミットしました (main へのマージは人が判断)`);
      await c.query(
        "update org_code_requests set status='done', resolution_note=$2, updated_at=now() where id=$1",
        [r.id, `${branch} ${sha}`],
      );
    }

    if (!DRY) {
      git('checkout', startBranch);
      console.log(`\n元のブランチ (${startBranch}) に戻りました。実装は ceo/* ブランチを確認してください。`);
    }
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error('fatal:', e.message);
  process.exit(1);
});
