// usage: bash scripts/paperback/pb-env.sh node scripts/anp/reenqueue-stuck-jobs.cjs  — 内部 Job が queued のまま graphile に無い ANP ジョブを再投入する
const path = require('path');
const { createRequire } = require('module');
const req = createRequire(path.join('C:/DEV/M2P', 'apps/anp/package.json'));
const { makeWorkerUtils } = req('graphile-worker');
const { Client } = createRequire(path.join('C:/DEV/M2P','package.json'))(path.join('C:/DEV/M2P','node_modules/.pnpm/pg@8.21.0/node_modules/pg'));
(async () => {
  const c = new Client({ connectionString: process.env.DBURL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const rows = (await c.query("select id, kind, payload_json from jobs where status='queued' and kind in ('note.account.profile','note.account.design','pipeline.note.publish') and created_at > now() - interval '1 day' order by created_at")).rows;
  console.log('stuck:', rows.map(r => `${r.kind}:${r.id}`).join(', ') || '(none)');
  const utils = await makeWorkerUtils({ connectionString: process.env.DBURL + (process.env.DBURL.includes('?') ? '&' : '?') + 'sslmode=no-verify' });
  for (const r of rows) {
    const payload = { ...r.payload_json, job_id: r.id };
    if (r.kind === 'note.account.design') payload.design_id = r.payload_json.design_id;
    const job = await utils.addJob(r.kind, payload, { maxAttempts: 2 });
    console.log('enqueued', r.kind, r.id, '-> graphile', String(job.id));
  }
  await utils.release();
  const g = (await c.query("select j.id, t.identifier from graphile_worker._private_jobs j join graphile_worker._private_tasks t on t.id=j.task_id order by j.id desc limit 5")).rows;
  console.log('graphile now:', JSON.stringify(g));
  await c.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
