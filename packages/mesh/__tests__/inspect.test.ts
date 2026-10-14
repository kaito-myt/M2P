/**
 * 3DP アセット検査のテスト (docs/12 §4.3)。
 *
 * **AI 生成の 3D が実際にやってくる壊れ方**を合成 GLB で再現して、検査が
 * 捕まえることを確認する。生成 API を叩かずに検査の正しさを担保できるのが狙い。
 *
 * 再現する壊れ方:
 *  - 親ノードにスケールが入っていて「データ上 1m・実際は 40m」
 *  - 原点が宙に浮いている (床置きできない)
 *  - UV / 法線が無い
 *  - ポリゴン過多・テクスチャ過大・マテリアル過多
 */
import { describe, expect, it } from 'vitest';
import { Document, NodeIO, type Mesh } from '@gltf-transform/core';

import {
  ACCESSORY_THRESHOLDS,
  PROP_THRESHOLDS,
  inspectDocument,
  inspectGlb,
} from '../src/inspect.js';
import { optimizeGlb } from '../src/optimize.js';

/**
 * 箱 1 個のメッシュを作る。
 * @param size 一辺の長さ (m)
 * @param opts uv/normal を外す (生成物で実際に欠けることがある)
 */
function makeBox(
  doc: Document,
  size: number,
  opts: { uv?: boolean; normal?: boolean; baseY?: number } = {},
): Mesh {
  const h = size / 2;
  const baseY = opts.baseY ?? -h; // 既定は原点が中心
  const y0 = baseY;
  const y1 = baseY + size;
  // 2 枚の三角形 × 6 面を素直に展開 (36 頂点)
  const corners: Array<[number, number, number]> = [
    [-h, y0, -h], [h, y0, -h], [h, y1, -h], [-h, y1, -h],
    [-h, y0, h], [h, y0, h], [h, y1, h], [-h, y1, h],
  ];
  const faces: Array<[number, number, number]> = [
    [0, 1, 2], [0, 2, 3], // -Z
    [5, 4, 7], [5, 7, 6], // +Z
    [4, 0, 3], [4, 3, 7], // -X
    [1, 5, 6], [1, 6, 2], // +X
    [4, 5, 1], [4, 1, 0], // -Y
    [3, 2, 6], [3, 6, 7], // +Y
  ];
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  for (const f of faces) {
    for (const idx of f) {
      const c = corners[idx]!;
      positions.push(c[0], c[1], c[2]);
      uvs.push(0.5, 0.5);
      normals.push(0, 1, 0);
    }
  }
  const buffer = doc.getRoot().listBuffers()[0] ?? doc.createBuffer();
  const prim = doc
    .createPrimitive()
    .setAttribute(
      'POSITION',
      doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer),
    );
  if (opts.uv !== false) {
    prim.setAttribute(
      'TEXCOORD_0',
      doc.createAccessor().setType('VEC2').setArray(new Float32Array(uvs)).setBuffer(buffer),
    );
  }
  if (opts.normal !== false) {
    prim.setAttribute(
      'NORMAL',
      doc.createAccessor().setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer),
    );
  }
  prim.setMaterial(doc.createMaterial('mat'));
  return doc.createMesh('box').addPrimitive(prim);
}

/** 床置きの小物として「正しい」ドキュメント: 0.5m の箱、底面が Y=0、原点が中心。 */
function goodProp(): Document {
  const doc = new Document();
  const mesh = makeBox(doc, 0.5, { baseY: 0 });
  const node = doc.createNode('prop').setMesh(mesh);
  doc.createScene('scene').addChild(node);
  return doc;
}

describe('inspectDocument — 正常系', () => {
  it('床置きの小物 (0.5m・底面 Y=0・UV/法線あり) は合格する', () => {
    const r = inspectDocument(goodProp(), 50_000, PROP_THRESHOLDS);
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
    expect(r.metrics.triangles).toBe(12);
    expect(r.metrics.hasUv).toBe(true);
    expect(r.metrics.hasNormals).toBe(true);
    expect(r.metrics.sizeMeters.x).toBeCloseTo(0.5, 5);
    expect(r.metrics.minY).toBeCloseTo(0, 5);
  });

  it('アクセサリのしきい値では原点を問わない (Unity 側で親子付けするため)', () => {
    const doc = new Document();
    // 原点から 0.3m 浮いた 5cm の小物 — 小物としては NG だがアクセサリなら OK
    const mesh = makeBox(doc, 0.05, { baseY: 0.3 });
    doc.createScene('s').addChild(doc.createNode('acc').setMesh(mesh));

    expect(inspectDocument(doc, 10_000, PROP_THRESHOLDS).ok).toBe(false);
    const acc = inspectDocument(doc, 10_000, ACCESSORY_THRESHOLDS);
    expect(acc.ok, JSON.stringify(acc.issues)).toBe(true);
  });
});

describe('inspectDocument — AI 生成が実際にやる壊れ方', () => {
  it('親ノードのスケールで巨大化しているのを捕まえる (データ上 1m・実際 40m)', () => {
    // ここが肝: ノードのスケールを無視して頂点座標だけ見ると見逃す。
    const doc = new Document();
    const mesh = makeBox(doc, 1, { baseY: 0 });
    const child = doc.createNode('mesh').setMesh(mesh);
    const root = doc.createNode('root').setScale([40, 40, 40]).addChild(child);
    doc.createScene('s').addChild(root);

    const r = inspectDocument(doc, 50_000, PROP_THRESHOLDS);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain('scale_too_large');
    expect(r.metrics.sizeMeters.x).toBeCloseTo(40, 3);
  });

  it('親ノードのスケールで極小になっているのも捕まえる', () => {
    const doc = new Document();
    const mesh = makeBox(doc, 1, { baseY: 0 });
    const root = doc.createNode('root').setScale([0.001, 0.001, 0.001]);
    root.addChild(doc.createNode('mesh').setMesh(mesh));
    doc.createScene('s').addChild(root);

    const r = inspectDocument(doc, 50_000, PROP_THRESHOLDS);
    expect(r.issues.map((i) => i.code)).toContain('scale_too_small');
  });

  it('親ノードの移動で原点から浮いているのを捕まえる (床置きできない)', () => {
    const doc = new Document();
    const mesh = makeBox(doc, 0.5, { baseY: 0 });
    const root = doc.createNode('root').setTranslation([0, 1.5, 0]);
    root.addChild(doc.createNode('mesh').setMesh(mesh));
    doc.createScene('s').addChild(root);

    const r = inspectDocument(doc, 50_000, PROP_THRESHOLDS);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain('origin_not_grounded');
    expect(r.metrics.minY).toBeCloseTo(1.5, 3);
  });

  it('水平方向に原点が外れているのを捕まえる', () => {
    const doc = new Document();
    const mesh = makeBox(doc, 0.5, { baseY: 0 });
    const root = doc.createNode('root').setTranslation([3, 0, 0]);
    root.addChild(doc.createNode('mesh').setMesh(mesh));
    doc.createScene('s').addChild(root);

    const r = inspectDocument(doc, 50_000, PROP_THRESHOLDS);
    expect(r.issues.map((i) => i.code)).toContain('origin_far_from_center');
  });

  it('UV が無いのを捕まえる (テクスチャが貼れない)', () => {
    const doc = new Document();
    const mesh = makeBox(doc, 0.5, { baseY: 0, uv: false });
    doc.createScene('s').addChild(doc.createNode('n').setMesh(mesh));
    const r = inspectDocument(doc, 50_000, PROP_THRESHOLDS);
    expect(r.issues.map((i) => i.code)).toContain('missing_uv');
  });

  it('法線が無いのを捕まえる', () => {
    const doc = new Document();
    const mesh = makeBox(doc, 0.5, { baseY: 0, normal: false });
    doc.createScene('s').addChild(doc.createNode('n').setMesh(mesh));
    const r = inspectDocument(doc, 50_000, PROP_THRESHOLDS);
    expect(r.issues.map((i) => i.code)).toContain('missing_normals');
  });

  it('メッシュが無い (生成失敗) を捕まえ、寸法判定は打ち切る', () => {
    const doc = new Document();
    doc.createScene('s').addChild(doc.createNode('empty'));
    const r = inspectDocument(doc, 1_000, PROP_THRESHOLDS);
    expect(r.ok).toBe(false);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]!.code).toBe('no_mesh');
  });

  it('マテリアルが多すぎるのを捕まえる (Draw Call が増える)', () => {
    const doc = new Document();
    const mesh = makeBox(doc, 0.5, { baseY: 0 });
    doc.createScene('s').addChild(doc.createNode('n').setMesh(mesh));
    // 使われないマテリアルでも「商品として持っている数」は多すぎる兆候
    for (let i = 0; i < 5; i++) doc.createMaterial(`extra-${i}`);
    const r = inspectDocument(doc, 50_000, PROP_THRESHOLDS);
    expect(r.issues.map((i) => i.code)).toContain('too_many_materials');
  });

  it('ファイルサイズ超過を捕まえる', () => {
    const r = inspectDocument(goodProp(), 20 * 1024 * 1024, PROP_THRESHOLDS);
    expect(r.issues.map((i) => i.code)).toContain('file_too_large');
  });

  it('しきい値はアクセサリの方が厳しい (三角形・テクスチャ・マテリアル)', () => {
    expect(ACCESSORY_THRESHOLDS.maxTriangles).toBeLessThan(PROP_THRESHOLDS.maxTriangles);
    expect(ACCESSORY_THRESHOLDS.maxTextureSize).toBeLessThan(PROP_THRESHOLDS.maxTextureSize);
    expect(ACCESSORY_THRESHOLDS.maxMaterials).toBeLessThanOrEqual(PROP_THRESHOLDS.maxMaterials);
  });

  it('問題は全部まとめて返す (1 個直して再生成を繰り返さない)', () => {
    const doc = new Document();
    // 巨大 + 浮いている + UV 無し
    const mesh = makeBox(doc, 1, { baseY: 0, uv: false });
    const root = doc.createNode('root').setScale([30, 30, 30]).setTranslation([0, 5, 0]);
    root.addChild(doc.createNode('m').setMesh(mesh));
    doc.createScene('s').addChild(root);

    const r = inspectDocument(doc, 50_000, PROP_THRESHOLDS);
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain('scale_too_large');
    expect(codes).toContain('origin_not_grounded');
    expect(codes).toContain('missing_uv');
  });
});

describe('inspectGlb / optimizeGlb — GLB バイト列を通す', () => {
  it('GLB に書き出して読み直しても判定が変わらない', async () => {
    const io = new NodeIO();
    const glb = await io.writeBinary(goodProp());
    const r = await inspectGlb(glb, PROP_THRESHOLDS);
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
    expect(r.metrics.byteSize).toBe(glb.byteLength);
  });

  it('最適化で頂点が溶接され、形 (寸法) は変わらない', async () => {
    const io = new NodeIO();
    const before = await io.writeBinary(goodProp());
    const beforeInspect = await inspectGlb(before, PROP_THRESHOLDS);

    const opt = await optimizeGlb(before);
    expect(opt.applied).toContain('weld');
    expect(opt.applied).toContain('dedup');
    expect(opt.applied).toContain('prune');

    const afterInspect = await inspectGlb(opt.glb, PROP_THRESHOLDS);
    // 形は変えない処理なので寸法と三角形数は保たれる
    expect(afterInspect.metrics.triangles).toBe(beforeInspect.metrics.triangles);
    expect(afterInspect.metrics.sizeMeters.x).toBeCloseTo(beforeInspect.metrics.sizeMeters.x, 5);
    expect(afterInspect.ok).toBe(true);
  });

  it('最適化は UV / 法線を落とさない (買い手が改変する前提の商材なので)', async () => {
    // gltf-transform の prune() は既定で「テクスチャ未割当の UV は不要」と判断して削る。
    // 改変用の商材で UV が消えると商品価値が無くなるため、既定で残す設定にしている。
    const io = new NodeIO();
    const glb = await io.writeBinary(goodProp());
    const opt = await optimizeGlb(glb);
    const r = await inspectGlb(opt.glb, PROP_THRESHOLDS);
    expect(r.metrics.hasUv).toBe(true);
    expect(r.metrics.hasNormals).toBe(true);
  });

  it('明示的に指定すれば未使用の頂点属性も落とせる', async () => {
    const io = new NodeIO();
    const glb = await io.writeBinary(goodProp());
    const opt = await optimizeGlb(glb, { pruneVertexAttributes: true });
    const r = await inspectGlb(opt.glb, PROP_THRESHOLDS);
    expect(r.metrics.hasUv).toBe(false);
  });

  it('最適化は冪等 (2 回通しても壊れない)', async () => {
    const io = new NodeIO();
    const glb = await io.writeBinary(goodProp());
    const once = await optimizeGlb(glb);
    const twice = await optimizeGlb(once.glb);
    const r = await inspectGlb(twice.glb, PROP_THRESHOLDS);
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
  });
});
