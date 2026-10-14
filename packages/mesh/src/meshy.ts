/**
 * 3DP — Meshy API クライアント (docs/12-3dp-design.md §4.1)。
 *
 * Meshy は**非同期タスク方式**: 生成を投げると task id が返り、ポーリングして
 * `SUCCEEDED` になったら結果 URL から GLB を取る。
 *
 * 設計上の注意:
 *  - **無料枠は使えない。** Meshy の無料枠の出力は CC BY 4.0 (商用可だが帰属表示が必要で、
 *    かつ他人も同じモデルを使える) なので販売物には使えない。Pro 以上が前提。
 *  - **credit を消費する。** LLM ではないが `token_usage` に記録する
 *    (でないとツール別の純利益が出せない / CLAUDE.md Hard Rule #5)。記録は呼出側 (worker)。
 *  - **テクスチャまで一気に取らない。** preview (形だけ) → 検査 → 合格したら refine
 *    (テクスチャ) の 2 段にすると、形で落ちる物にテクスチャ分の credit を払わずに済む。
 *
 * HTTP は `fetch` を注入できるようにしてテストから叩けるようにする (API キー不要で
 * 失敗系まで検証できる)。
 */

/** Meshy のタスク状態。 */
export type MeshyTaskStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';

export interface MeshyTask {
  id: string;
  status: MeshyTaskStatus;
  /** 0〜100。 */
  progress: number;
  /** 完了時のダウンロード URL (glb / fbx / obj / usdz)。 */
  model_urls?: Partial<Record<'glb' | 'fbx' | 'obj' | 'usdz', string>>;
  /** サムネ URL (プレビュー画像の当たりを付けるのに使える)。 */
  thumbnail_url?: string;
  task_error?: { message?: string };
}

export interface MeshyTextTo3dArgs {
  prompt: string;
  /** 'preview' = 形だけ (安い) / 'refine' = テクスチャ付き。 */
  mode: 'preview' | 'refine';
  /** mode='refine' のとき必須 — preview タスクの id。 */
  previewTaskId?: string;
  /** 低ポリで出す (ワールド小物は軽さが要件)。 */
  targetPolycount?: number;
  /** 出さないものを明示する (AI 3D は余計な台座や床を付けがち)。 */
  negativePrompt?: string;
  artStyle?: string;
}

export interface MeshyClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** ポーリング間隔 (ms)。既定 5 秒。 */
  pollIntervalMs?: number;
  /** ポーリングの上限回数。既定 120 回 (= 既定間隔で 10 分)。 */
  maxPolls?: number;
  /** テストで待たないための待機関数差し替え。 */
  sleep?: (ms: number) => Promise<void>;
}

export class MeshyError extends Error {
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(message: string, opts: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = 'MeshyError';
    this.status = opts.status;
    // 429 / 5xx はこちらの作りの問題ではないので上位のリトライに委ねる。
    this.retryable = opts.retryable ?? false;
  }
}

const DEFAULT_BASE_URL = 'https://api.meshy.ai';

export class MeshyClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: MeshyClientOptions) {
    if (!opts.apiKey) throw new MeshyError('Meshy API キーが未設定です');
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.pollIntervalMs = opts.pollIntervalMs ?? 5_000;
    this.maxPolls = opts.maxPolls ?? 120;
    this.sleep =
      opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  /** text-to-3D タスクを投げて task id を返す。 */
  async createTextTo3d(args: MeshyTextTo3dArgs): Promise<string> {
    if (args.mode === 'refine' && !args.previewTaskId) {
      throw new MeshyError('mode=refine には previewTaskId が必要です');
    }
    const body: Record<string, unknown> = { mode: args.mode };
    if (args.mode === 'preview') {
      body.prompt = args.prompt;
      if (args.targetPolycount !== undefined) body.target_polycount = args.targetPolycount;
      if (args.negativePrompt) body.negative_prompt = args.negativePrompt;
      if (args.artStyle) body.art_style = args.artStyle;
    } else {
      body.preview_task_id = args.previewTaskId;
    }

    const res = await this.request('POST', '/openapi/v2/text-to-3d', body);
    const id = typeof res?.result === 'string' ? res.result : undefined;
    if (!id) throw new MeshyError(`Meshy のタスク id が取得できませんでした: ${JSON.stringify(res)}`);
    return id;
  }

  /** タスクの状態を 1 回取る。 */
  async getTask(taskId: string): Promise<MeshyTask> {
    const res = await this.request('GET', `/openapi/v2/text-to-3d/${encodeURIComponent(taskId)}`);
    const task = (res ?? {}) as unknown as MeshyTask;
    if (!task.status) {
      throw new MeshyError(`Meshy のタスク応答が不正です: ${JSON.stringify(res)}`);
    }
    return task;
  }

  /**
   * SUCCEEDED / FAILED / CANCELED になるまでポーリングする。
   *
   * 上限に達したら `MeshyError(retryable=true)` を投げる — タスク自体は Meshy 側で
   * 走り続けている可能性があるので、**上位は同じ task id で再開できるようにする**
   * (ここで新しいタスクを投げ直すと credit を二重に払う)。
   */
  async waitForTask(taskId: string, onProgress?: (task: MeshyTask) => void): Promise<MeshyTask> {
    for (let i = 0; i < this.maxPolls; i++) {
      const task = await this.getTask(taskId);
      onProgress?.(task);
      if (task.status === 'SUCCEEDED') return task;
      if (task.status === 'FAILED' || task.status === 'CANCELED') {
        throw new MeshyError(
          `Meshy のタスクが ${task.status} になりました: ${task.task_error?.message ?? '(詳細なし)'}`,
        );
      }
      await this.sleep(this.pollIntervalMs);
    }
    throw new MeshyError(
      `Meshy のタスクが ${this.maxPolls} 回のポーリングで完了しませんでした (task_id=${taskId})。` +
        'タスクは Meshy 側で継続している可能性があるため、同じ task_id で再開すること (投げ直すと credit を二重に払う)。',
      { retryable: true },
    );
  }

  /** 完了タスクから GLB を取得する。 */
  async downloadGlb(task: MeshyTask): Promise<Uint8Array> {
    const url = task.model_urls?.glb;
    if (!url) {
      throw new MeshyError(`GLB の URL がありません (task=${task.id}, status=${task.status})`);
    }
    const res = await this.fetchImpl(url);
    if (!res.ok) {
      throw new MeshyError(`GLB のダウンロードに失敗しました: HTTP ${res.status}`, {
        status: res.status,
        retryable: res.status >= 500 || res.status === 429,
      });
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0) throw new MeshyError('GLB が空でした');
    return new Uint8Array(buf);
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new MeshyError(`Meshy API エラー: HTTP ${res.status} ${text.slice(0, 300)}`, {
        status: res.status,
        // 402 = credit 切れ。リトライしても無駄なので retryable にしない。
        retryable: res.status >= 500 || res.status === 429,
      });
    }
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (json === null) throw new MeshyError('Meshy API の応答が JSON ではありません');
    return json;
  }
}

/**
 * ワールド小物向けの生成プロンプトを組む。
 *
 * AI 3D は指示しないと「台座」「地面」「背景の板」を勝手に付ける。
 * また 1 枚絵として破綻しない代わりに**裏側が無い**ことがあるので明示する。
 * ここはプロンプト本体ではなく**定型の制約部分**だけを持つ
 * (企画依存の文面は DB の `tdp.prompter` プロンプトが作る / CLAUDE.md Hard Rule #4)。
 */
export const PROP_NEGATIVE_PROMPT =
  'pedestal, base plate, ground plane, floor,背景, backdrop, text, watermark, logo, ' +
  'multiple objects, duplicated object, human, character, broken geometry, floating parts';

/** 生成プロンプトに必ず足す制約 (形・向き・スケールの前提を揃える)。 */
export function buildPropPromptSuffix(args: {
  /** 想定実寸 (m)。Meshy は寸法を保証しないが、形の比率に効く。 */
  approxSizeMeters?: number;
}): string {
  const lines = [
    'single standalone object, no pedestal and no ground plane',
    'complete geometry on all sides including the back and bottom',
    'upright orientation, Y axis up',
    'clean low-poly topology suitable for real-time rendering',
  ];
  if (args.approxSizeMeters !== undefined) {
    lines.push(`real-world scale approximately ${args.approxSizeMeters} meters at the longest side`);
  }
  return lines.join(', ');
}
