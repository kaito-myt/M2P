/**
 * 3DP — GLB の配布用最適化 (docs/12-3dp-design.md §4.3)。
 *
 * 生成直後の GLB は頂点が溶接されていない / 同じマテリアルが重複している /
 * 使われないノードが残っている、という状態が普通。そのまま配ると
 * 「重い」「マテリアルが無駄に多い」という評価になるので、配布前に必ず通す。
 *
 * **形は変えない処理だけを既定にする** (weld/dedup/prune/resample)。
 * ポリゴン削減 (simplify) は見た目が変わりうるので明示的に要求されたときだけ行い、
 * 削減後は必ず再検査する前提にする (呼出側の責務)。
 */
import { NodeIO, type Document } from '@gltf-transform/core';
import { dedup, prune, weld } from '@gltf-transform/functions';

export interface OptimizeOptions {
  /**
   * 頂点の溶接を行うか (既定 true)。
   *
   * gltf-transform v4 の `weld()` は**ビット列が完全一致する頂点のみ**をまとめる
   * (v2 までの `tolerance` は廃止された)。生成物は同一座標の頂点が分かれている
   * ことが多いのでここだけで効くが、「ほぼ同じ座標」の統合はしない。
   * 近接頂点の削減が必要なら `simplify()` を使う判断になる (形が変わるので別工程)。
   */
  weldVertices?: boolean;
  /** 使われていないノード・マテリアル・アクセサを落とす。既定 true。 */
  pruneUnused?: boolean;
  /**
   * 使われていない頂点属性 (テクスチャ未割当の UV など) も落とすか。既定 **false**。
   *
   * gltf-transform の `prune()` は既定で「テクスチャが無いから UV は不要」と判断して
   * **UV を削る**。3DP の商材は買い手が改変する前提 (テクスチャ差し替え・色変え) なので、
   * UV を落とすと商品価値が消える。既定では必ず残す。
   * (この挙動はテストで実際に踏んで気付いた — prune 既定のまま配ると UV 無しの
   *  GLB が出荷され、自前の検査が missing_uv で弾くという矛盾が起きていた。)
   */
  pruneVertexAttributes?: boolean;
  /** 重複したマテリアル・メッシュ・テクスチャを 1 つにまとめる。既定 true。 */
  dedupResources?: boolean;
}

export interface OptimizeResult {
  glb: Uint8Array;
  beforeBytes: number;
  afterBytes: number;
  /** 適用した処理の名前 (監査・UI 表示用)。 */
  applied: string[];
}

const io = new NodeIO();

/** GLB を配布用に最適化する。形を変える処理は既定で行わない。 */
export async function optimizeGlb(
  glb: Uint8Array,
  opts: OptimizeOptions = {},
): Promise<OptimizeResult> {
  const doc = await io.readBinary(glb);
  const applied = await optimizeDocument(doc, opts);
  const out = await io.writeBinary(doc);
  return {
    glb: out,
    beforeBytes: glb.byteLength,
    afterBytes: out.byteLength,
    applied,
  };
}

/** Document を直接最適化する (テストと、生成直後の一括処理で使い回す)。 */
export async function optimizeDocument(
  doc: Document,
  opts: OptimizeOptions = {},
): Promise<string[]> {
  const applied: string[] = [];
  const transforms = [];

  if (opts.dedupResources !== false) {
    transforms.push(dedup());
    applied.push('dedup');
  }
  if (opts.weldVertices !== false) {
    transforms.push(weld());
    applied.push('weld');
  }
  if (opts.pruneUnused !== false) {
    transforms.push(prune({ keepAttributes: opts.pruneVertexAttributes !== true }));
    applied.push('prune');
  }

  await doc.transform(...transforms);
  return applied;
}
