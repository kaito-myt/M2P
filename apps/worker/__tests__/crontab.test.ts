import { describe, expect, it } from 'vitest';

import {
  ALERT_COST_CHECK_CRON,
  ARCHIVE_DB_BACKUP_CRON,
  ARCHIVE_JOBS_CRON,
  BATCH_PLAN_DISPATCHER_CRON,
  buildCronItemsWithSettings,
  buildParsedCronItems,
  CATALOG_FETCH_CRON_DEFAULT,
  CRON_ITEMS,
  FX_FETCH_CRON,
  KDP_PUBLISH_STATUS_SYNC_CRON,
  PROMOTION_PLAYBOOK_REFRESH_CRON,
  LOCKS_SWEEP_CRON,
  resolveCatalogFetchCron,
  resolveSalesFetchCron,
  SALES_FETCH_CRON_DEFAULT,
} from '../src/crontab.js';
import { ALERT_COST_CHECK_TASK_NAME } from '../src/tasks/alert-cost-check.js';
import { ARCHIVE_DB_BACKUP_TASK_NAME } from '../src/tasks/archive-db-backup.js';
import { ARCHIVE_JOBS_TASK_NAME } from '../src/tasks/archive-jobs.js';
import { BATCH_PLAN_DISPATCHER_TASK_NAME } from '../src/tasks/batch-plan-dispatcher.js';
import { CATALOG_FETCH_TASK_NAME } from '../src/tasks/catalog-fetch.js';
import { FX_FETCH_TASK_NAME } from '../src/tasks/fx-fetch.js';
import { ADS_SPEND_FETCH_TASK_NAME } from '../src/tasks/ads-spend-fetch.js';
import { KDP_PUBLISH_STATUS_SYNC_TASK_NAME } from '../src/tasks/kdp-publish-status-sync.js';
import { PROMOTION_PLAYBOOK_REFRESH_TASK_NAME } from '../src/tasks/promotion-playbook-refresh.js';
import { PROMOTION_METRICS_FETCH_TASK_NAME } from '../src/tasks/promotion-metrics-fetch.js';
import { ORG_PROMO_TICK_TASK_NAME } from '../src/tasks/org-promo-tick.js';
import { KDP_PUBLISH_DIGEST_TASK_NAME } from '../src/tasks/kdp-publish-digest.js';
import { PROMOTION_GROWTH_TODO_TASK_NAME } from '../src/tasks/promotion-growth-todo.js';
import { PROMOTION_X_ENGAGE_TASK_NAME } from '../src/tasks/promotion-x-engage.js';
import { PROMOTION_SNS_ENGAGE_TASK_NAME } from '../src/tasks/promotion-sns-engage.js';
import { NOTE_ENGAGE_TASK_NAME } from '../src/tasks/note-engage.js';
import { PROMOTION_GROWTH_LOOP_TASK_NAME } from '../src/tasks/promotion-growth-loop.js';
import { RECURRING_COST_REFRESH_TASK_NAME } from '../src/tasks/recurring-cost-refresh.js';
import { LOCKS_SWEEP_TASK_NAME } from '../src/tasks/locks-sweep.js';
import { SALES_FETCH_DISPATCHER_TASK_NAME } from '../src/tasks/sales-fetch-dispatcher.js';
import { PROMOTION_DISPATCH_TASK_NAME } from '../src/tasks/promotion-dispatch.js';
import { PROMOTION_DISPATCH_CRON_DEFAULT } from '../src/crontab.js';

describe('crontab.ts', () => {
  it('ARCHIVE_DB_BACKUP_CRON は土曜 18:00 UTC = 日曜 03:00 JST', () => {
    expect(ARCHIVE_DB_BACKUP_CRON).toBe('0 18 * * 6');
  });

  it('LOCKS_SWEEP_CRON は毎時 0 分 (SP-02 T-02-07)', () => {
    expect(LOCKS_SWEEP_CRON).toBe('0 * * * *');
  });

  it('FX_FETCH_CRON は 55 18 * * * UTC = JST 03:55 (SP-02 T-02-08 / docs/05 §5.4)', () => {
    expect(FX_FETCH_CRON).toBe('55 18 * * *');
  });

  it('CATALOG_FETCH_CRON_DEFAULT は 0 19 * * * UTC = JST 04:00 (SP-02 T-02-09 / docs/05 §5.4)', () => {
    expect(CATALOG_FETCH_CRON_DEFAULT).toBe('0 19 * * *');
  });

  it('BATCH_PLAN_DISPATCHER_CRON は毎分 (SP-03 T-03-10 / docs/05 §5.4)', () => {
    expect(BATCH_PLAN_DISPATCHER_CRON).toBe('* * * * *');
  });

  it('resolveCatalogFetchCron は env 未設定なら既定値を返す', () => {
    expect(resolveCatalogFetchCron({})).toBe('0 19 * * *');
  });

  it('resolveCatalogFetchCron は env MODEL_CATALOG_FETCH_CRON を優先する', () => {
    expect(resolveCatalogFetchCron({ MODEL_CATALOG_FETCH_CRON: '30 12 * * *' })).toBe(
      '30 12 * * *',
    );
  });

  it('resolveCatalogFetchCron は env が空文字なら既定値を返す', () => {
    expect(resolveCatalogFetchCron({ MODEL_CATALOG_FETCH_CRON: '' })).toBe('0 19 * * *');
    expect(resolveCatalogFetchCron({ MODEL_CATALOG_FETCH_CRON: '   ' })).toBe('0 19 * * *');
  });

  it('ALERT_COST_CHECK_CRON は毎時 0 分 (SP-07 T-07-02 / docs/05 §5.4)', () => {
    expect(ALERT_COST_CHECK_CRON).toBe('0 * * * *');
  });

  it('ARCHIVE_JOBS_CRON は土曜 18:00 UTC = 日曜 03:00 JST (T-09-04 / docs/05 §5.3.18)', () => {
    expect(ARCHIVE_JOBS_CRON).toBe('0 18 * * 6');
  });

  it('KDP_PUBLISH_STATUS_SYNC_CRON は 6 時間毎', () => {
    expect(KDP_PUBLISH_STATUS_SYNC_CRON).toBe('0 */6 * * *');
  });

  it('CRON_ITEMS は archive.db.backup / fx.fetch / ads.spend.fetch / catalog.fetch / batch_plan.dispatcher / alert.cost.check / archive.jobs / kdp.publish.status.sync / promotion.playbook.refresh / promotion.metrics.fetch / org.promo.tick / kdp.publish.digest / promotion.growth.todo / promotion.x.engage / promotion.sns.engage / note.engage / promotion.growth.loop / recurring.cost.refresh / model.health.probe の 19 件', () => {
    expect(CRON_ITEMS).toHaveLength(19);

    // locks-sweep-hourly は存在しない — sweep は alert.cost.check monthly に相乗り (T-07-11)
    const sweep = CRON_ITEMS.find((c) => c.task === LOCKS_SWEEP_TASK_NAME);
    expect(sweep).toBeUndefined();

    const archive = CRON_ITEMS.find((c) => c.task === ARCHIVE_DB_BACKUP_TASK_NAME);
    expect(archive).toBeDefined();
    expect(archive!.match).toBe(ARCHIVE_DB_BACKUP_CRON);
    expect(archive!.identifier).toBe('archive-db-backup-weekly');

    const fx = CRON_ITEMS.find((c) => c.task === FX_FETCH_TASK_NAME);
    expect(fx).toBeDefined();
    expect(fx!.match).toBe(FX_FETCH_CRON);
    expect(fx!.identifier).toBe('fx-fetch-daily');

    const catalog = CRON_ITEMS.find((c) => c.task === CATALOG_FETCH_TASK_NAME);
    expect(catalog).toBeDefined();
    expect(catalog!.identifier).toBe('catalog-fetch-daily');
    // env 経由なので resolve 後の値で比較
    expect(catalog!.match).toBe(resolveCatalogFetchCron());
    expect(catalog!.payload).toEqual({ trigger: 'cron' });

    const dispatcher = CRON_ITEMS.find(
      (c) => c.task === BATCH_PLAN_DISPATCHER_TASK_NAME,
    );
    expect(dispatcher).toBeDefined();
    expect(dispatcher!.match).toBe(BATCH_PLAN_DISPATCHER_CRON);
    expect(dispatcher!.identifier).toBe('batch-plan-dispatcher-minute');

    const alertCost = CRON_ITEMS.find(
      (c) => c.task === ALERT_COST_CHECK_TASK_NAME,
    );
    expect(alertCost).toBeDefined();
    expect(alertCost!.match).toBe(ALERT_COST_CHECK_CRON);
    expect(alertCost!.identifier).toBe('alert-cost-check-hourly');
    expect(alertCost!.payload).toEqual({ scope: 'monthly' });

    const archiveJobs = CRON_ITEMS.find((c) => c.task === ARCHIVE_JOBS_TASK_NAME);
    expect(archiveJobs).toBeDefined();
    expect(archiveJobs!.match).toBe(ARCHIVE_JOBS_CRON);
    expect(archiveJobs!.identifier).toBe('archive-jobs-weekly');

    const kdpPublishStatusSync = CRON_ITEMS.find((c) => c.task === KDP_PUBLISH_STATUS_SYNC_TASK_NAME);
    expect(kdpPublishStatusSync).toBeDefined();
    expect(kdpPublishStatusSync!.match).toBe(KDP_PUBLISH_STATUS_SYNC_CRON);
    expect(kdpPublishStatusSync!.identifier).toBe('kdp-publish-status-sync-6h');

    const playbookRefresh = CRON_ITEMS.find((c) => c.task === PROMOTION_PLAYBOOK_REFRESH_TASK_NAME);
    expect(playbookRefresh).toBeDefined();
    expect(playbookRefresh!.match).toBe(PROMOTION_PLAYBOOK_REFRESH_CRON);
    expect(playbookRefresh!.identifier).toBe('promotion-playbook-refresh-weekly');

    const promoTick = CRON_ITEMS.find((c) => c.task === ORG_PROMO_TICK_TASK_NAME);
    expect(promoTick).toBeDefined();
    expect(promoTick!.match).toBe('0 16 * * *');
    expect(promoTick!.identifier).toBe('org-promo-tick-daily');

    const pubDigest = CRON_ITEMS.find((c) => c.task === KDP_PUBLISH_DIGEST_TASK_NAME);
    expect(pubDigest).toBeDefined();
    expect(pubDigest!.match).toBe('30 22 * * *');
    expect(pubDigest!.identifier).toBe('kdp-publish-digest-daily');

    const growthTodo = CRON_ITEMS.find((c) => c.task === PROMOTION_GROWTH_TODO_TASK_NAME);
    expect(growthTodo).toBeDefined();
    expect(growthTodo!.match).toBe('0 22 * * 1');
    expect(growthTodo!.identifier).toBe('promotion-growth-todo-weekly');

    const xEngage = CRON_ITEMS.find((c) => c.task === PROMOTION_X_ENGAGE_TASK_NAME);
    expect(xEngage).toBeDefined();
    expect(xEngage!.match).toBe('0 1,7,13 * * *');
    expect(xEngage!.identifier).toBe('promotion-x-engage');

    const snsEngage = CRON_ITEMS.find((c) => c.task === PROMOTION_SNS_ENGAGE_TASK_NAME);
    expect(snsEngage).toBeDefined();
    expect(snsEngage!.match).toBe('0 3,9 * * *');
    expect(snsEngage!.identifier).toBe('promotion-sns-engage');

    const noteEngage = CRON_ITEMS.find((c) => c.task === NOTE_ENGAGE_TASK_NAME);
    expect(noteEngage).toBeDefined();
    expect(noteEngage!.match).toBe('0 4,10 * * *');
    expect(noteEngage!.identifier).toBe('note-engage');

    const growthLoop = CRON_ITEMS.find((c) => c.task === PROMOTION_GROWTH_LOOP_TASK_NAME);
    expect(growthLoop).toBeDefined();
    expect(growthLoop!.match).toBe('0 21 * * *');
    expect(growthLoop!.identifier).toBe('promotion-growth-loop');

    const costRefresh = CRON_ITEMS.find((c) => c.task === RECURRING_COST_REFRESH_TASK_NAME);
    expect(costRefresh).toBeDefined();
    expect(costRefresh!.match).toBe('0 20 1 * *');
    expect(costRefresh!.identifier).toBe('recurring-cost-refresh');
  });

  it('buildParsedCronItems は graphile-worker の parseCronItems に通る', () => {
    const parsed = buildParsedCronItems();
    expect(parsed).toHaveLength(19);
    const tasks = parsed.map((p) => p.task).sort();
    expect(tasks).toEqual(
      [
        ALERT_COST_CHECK_TASK_NAME,
        ARCHIVE_DB_BACKUP_TASK_NAME,
        ARCHIVE_JOBS_TASK_NAME,
        FX_FETCH_TASK_NAME,
        ADS_SPEND_FETCH_TASK_NAME,
        CATALOG_FETCH_TASK_NAME,
        BATCH_PLAN_DISPATCHER_TASK_NAME,
        KDP_PUBLISH_STATUS_SYNC_TASK_NAME,
        PROMOTION_PLAYBOOK_REFRESH_TASK_NAME,
        PROMOTION_METRICS_FETCH_TASK_NAME,
        ORG_PROMO_TICK_TASK_NAME,
        KDP_PUBLISH_DIGEST_TASK_NAME,
        PROMOTION_GROWTH_TODO_TASK_NAME,
        PROMOTION_X_ENGAGE_TASK_NAME,
        PROMOTION_SNS_ENGAGE_TASK_NAME,
        NOTE_ENGAGE_TASK_NAME,
        PROMOTION_GROWTH_LOOP_TASK_NAME,
        RECURRING_COST_REFRESH_TASK_NAME,
        'model.health.probe',
      ].sort(),
    );
  });

  // -----------------------------------------------------------------------
  // resolveSalesFetchCron (SP-12 T-12-05)
  // -----------------------------------------------------------------------

  it('SALES_FETCH_CRON_DEFAULT は 0 17 * * * UTC = JST 02:00 (SP-12 T-12-05 / docs/05 §5.4)', () => {
    expect(SALES_FETCH_CRON_DEFAULT).toBe('0 17 * * *');
  });

  it('resolveSalesFetchCron は env 未設定なら既定値を返す', () => {
    expect(resolveSalesFetchCron({})).toBe('0 17 * * *');
  });

  it('resolveSalesFetchCron は env SALES_FETCH_CRON を優先する', () => {
    expect(resolveSalesFetchCron({ SALES_FETCH_CRON: '30 15 * * *' })).toBe('30 15 * * *');
  });

  it('resolveSalesFetchCron は env が空文字なら既定値を返す', () => {
    expect(resolveSalesFetchCron({ SALES_FETCH_CRON: '' })).toBe('0 17 * * *');
    expect(resolveSalesFetchCron({ SALES_FETCH_CRON: '   ' })).toBe('0 17 * * *');
  });

  // -----------------------------------------------------------------------
  // buildCronItemsWithSettings (SP-12 T-12-05)
  // -----------------------------------------------------------------------

  it('buildCronItemsWithSettings({ sales_auto_fetch_enabled: false }) は sales.fetch.dispatch を含まない', () => {
    const items = buildCronItemsWithSettings({ sales_auto_fetch_enabled: false });
    expect(items).toHaveLength(19); // 静的 CRON_ITEMS と同数
    const dispatch = items.find((c) => c.task === SALES_FETCH_DISPATCHER_TASK_NAME);
    expect(dispatch).toBeUndefined();
  });

  it('buildCronItemsWithSettings({ sales_auto_fetch_enabled: true }) は sales.fetch.dispatch を含む', () => {
    const items = buildCronItemsWithSettings({ sales_auto_fetch_enabled: true });
    expect(items).toHaveLength(20); // 静的 19 件 + dispatch 1 件
    const dispatch = items.find((c) => c.task === SALES_FETCH_DISPATCHER_TASK_NAME);
    expect(dispatch).toBeDefined();
    expect(dispatch!.identifier).toBe('sales-fetch-dispatch-daily');
  });

  it('buildCronItemsWithSettings は sales_auto_fetch_cron DB 値を cron match に使う', () => {
    const items = buildCronItemsWithSettings({
      sales_auto_fetch_enabled: true,
      sales_auto_fetch_cron: '0 10 * * *',
    });
    const dispatch = items.find((c) => c.task === SALES_FETCH_DISPATCHER_TASK_NAME);
    expect(dispatch).toBeDefined();
    expect(dispatch!.match).toBe('0 10 * * *');
  });

  it('buildCronItemsWithSettings は sales_auto_fetch_cron が null なら resolveSalesFetchCron() を使う', () => {
    const items = buildCronItemsWithSettings({
      sales_auto_fetch_enabled: true,
      sales_auto_fetch_cron: null,
    });
    const dispatch = items.find((c) => c.task === SALES_FETCH_DISPATCHER_TASK_NAME);
    expect(dispatch).toBeDefined();
    expect(dispatch!.match).toBe(resolveSalesFetchCron());
  });

  it('buildCronItemsWithSettings は元の CRON_ITEMS を変更しない (immutable)', () => {
    const beforeLength = CRON_ITEMS.length;
    buildCronItemsWithSettings({ sales_auto_fetch_enabled: true });
    expect(CRON_ITEMS).toHaveLength(beforeLength);
  });

  it('buildParsedCronItems(buildCronItemsWithSettings(enabled=true)) は 20 件の ParsedCronItem を返す', () => {
    const items = buildCronItemsWithSettings({ sales_auto_fetch_enabled: true });
    const parsed = buildParsedCronItems(items);
    expect(parsed).toHaveLength(20);
    const tasks = parsed.map((p) => p.task).sort();
    expect(tasks).toContain(SALES_FETCH_DISPATCHER_TASK_NAME);
  });

  // -----------------------------------------------------------------------
  // 販促自動投稿ディスパッチャ (F-052)
  // -----------------------------------------------------------------------

  it('PROMOTION_DISPATCH_CRON_DEFAULT は 30 分毎', () => {
    expect(PROMOTION_DISPATCH_CRON_DEFAULT).toBe('*/30 * * * *');
  });

  it('promo_auto_post_enabled=false なら promotion.dispatch を含まない', () => {
    const items = buildCronItemsWithSettings({
      sales_auto_fetch_enabled: false,
      promo_auto_post_enabled: false,
    });
    expect(items.find((c) => c.task === PROMOTION_DISPATCH_TASK_NAME)).toBeUndefined();
  });

  it('promo_auto_post_enabled=true なら promotion.dispatch を含む', () => {
    const items = buildCronItemsWithSettings({
      sales_auto_fetch_enabled: false,
      promo_auto_post_enabled: true,
    });
    const promo = items.find((c) => c.task === PROMOTION_DISPATCH_TASK_NAME);
    expect(promo).toBeDefined();
    expect(promo!.identifier).toBe('promotion-dispatch');
    expect(promo!.match).toBe(PROMOTION_DISPATCH_CRON_DEFAULT);
  });

  it('promo_dispatch_cron の DB 値を cron match に使う', () => {
    const items = buildCronItemsWithSettings({
      sales_auto_fetch_enabled: false,
      promo_auto_post_enabled: true,
      promo_dispatch_cron: '0 */2 * * *',
    });
    const promo = items.find((c) => c.task === PROMOTION_DISPATCH_TASK_NAME);
    expect(promo!.match).toBe('0 */2 * * *');
  });

  it('sales と promo の両方 ON なら静的 19 + 2 件', () => {
    const items = buildCronItemsWithSettings({
      sales_auto_fetch_enabled: true,
      promo_auto_post_enabled: true,
    });
    expect(items).toHaveLength(21);
    expect(items.find((c) => c.task === SALES_FETCH_DISPATCHER_TASK_NAME)).toBeDefined();
    expect(items.find((c) => c.task === PROMOTION_DISPATCH_TASK_NAME)).toBeDefined();
  });

  it('docs/05 §5.1 のドット表記タスク名 (archive.db.backup) を programmatic API で受け付ける', () => {
    // crontab 文字列パーサ (CRONTAB_COMMAND) はドット非対応のため、cron は CronItem[] で
    // 直接定義する設計判断。本テストは将来 graphile-worker を upgrade した際にも
    // ドット表記が壊れていないことを担保する回帰テスト。
    expect(() => buildParsedCronItems([
      { task: 'archive.db.backup', match: '0 18 * * 6', identifier: 'a' },
      { task: 'pipeline.book.kickoff', match: '0 0 * * *', identifier: 'b' },
      { task: 'locks.sweep', match: '0 * * * *', identifier: 'c' },
      { task: 'fx.fetch', match: '55 18 * * *', identifier: 'd' },
      { task: 'catalog.fetch', match: '0 19 * * *', identifier: 'e' },
      { task: 'batch_plan.dispatcher', match: '* * * * *', identifier: 'f' },
    ])).not.toThrow();
  });
});
