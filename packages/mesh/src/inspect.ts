/**
 * 3DP — GLB の検査 (docs/12-3dp-design.md §4.3)。
 *
 * **AI の 3D 出力は「見た目は良いが使えない」ことが多い。** 生成した物をそのまま
 * 売ると「Unity に入れたら 40m の椅子だった」「原点が宙に浮いていて床に置けない」
 * 「Quest でポリゴン上限を超えて使えない」といった返品理由になる。
 * 3DP の付加価値は生成 API を叩くことではなく、**この検査を通った物だけを売ること**。
 *
 * 判定は決定論的な数値チェックのみ。「見栄え」は人間のプレビュー承認 (docs/12 §6) で見る。
 */
import { NodeIO, type Document, type Node as GltfNode } from '@gltf-transform/core';

/** 検査のしきい値。種別 (小物/家具) と配布先 (PC/Quest) で変える。 */
export interface InspectThresholds {
  /** 三角形数の上限。Quest 向けのワールド小物は厳しく取る。 */
  maxTriangles: number;
  /** テクスチャ 1 枚の最大辺 (px)。 */
  maxTextureSize: number;
  /** テクスチャ枚数の上限。 */
  maxTextureCount: number;
  /** マテリアル数の上限。小物は 1 が理想。 */
  maxMaterials: number;
  /** 想定するおおよその実寸レンジ (m)。最大辺がこの外なら疑う。 */
  minSizeMeters: number;
  maxSizeMeters: number;
  /**
   * 原点から底面までの許容ずれ (m)。床置きの家具・小物は足元が原点でないと配置できない。
   * `requireGroundedOrigin` が false のときは見ない (アクセサリ等)。
   */
  originToleranceMeters: number;
  requireGroundedOrigin: boolean;
  /** GLB のファイルサイズ上限 (bytes)。 */
  maxByteSize: number;
}

/** 床置き前提の小物・家具 (ワールド用プロップ)。 */
export const PROP_THRESHOLDS: InspectThresholds = {
  maxTriangles: 20_000,
  maxTextureSize: 2048,
  maxTextureCount: 4,
  maxMaterials: 2,
  minSizeMeters: 0.05,
  maxSizeMeters: 5,
  originToleranceMeters: 0.02,
  requireGroundedOrigin: true,
  maxByteSize: 8 * 1024 * 1024,
};

/** アバターに付けるアクセサリ。小さく、軽く、原点は問わない (Unity 側で親子付けする)。 */
export const ACCESSORY_THRESHOLDS: InspectThresholds = {
  maxTriangles: 7_500,
  maxTextureSize: 1024,
  maxTextureCount: 2,
  maxMaterials: 1,
  minSizeMeters: 0.005,
  maxSizeMeters: 0.6,
  originToleranceMeters: 0,
  requireGroundedOrigin: false,
  maxByteSize: 2 * 1024 * 1024,
};

export type InspectIssueCode =
  | 'no_mesh'
  | 'too_many_triangles'
  | 'texture_too_large'
  | 'too_many_textures'
  | 'too_many_materials'
  | 'scale_too_small'
  | 'scale_too_large'
  | 'origin_not_grounded'
  | 'origin_far_from_center'
  | 'file_too_large'
  | 'missing_uv'
  | 'missing_normals'
  | 'degenerate_bounds';

export interface InspectIssue {
  code: InspectIssueCode;
  /** 運営者向けの説明 (日本語)。そのまま UI に出す。 */
  message: string;
  /** 実測値と期待値。 */
  actual: number | string;
  expected: number | string;
}

export interface InspectMetrics {
  triangles: number;
  materials: number;
  textures: number;
  maxTextureSize: number;
  byteSize: number;
  /** バウンディングボックスの寸法 (m)。 */
  sizeMeters: { x: number; y: number; z: number };
  /** 底面 (最小 Y) の高さ (m)。0 に近いほど床置きしやすい。 */
  minY: number;
  /** 水平方向の中心が原点からどれだけ離れているか (m)。 */
  horizontalOffset: number;
  hasUv: boolean;
  hasNormals: boolean;
  meshes: number;
}

export interface InspectResult {
  /** 販売データとして使えるか (issues が空)。 */
  ok: boolean;
  issues: InspectIssue[];
  metrics: InspectMetrics;
}

const io = new NodeIO();

/** GLB のバイト列を検査する。 */
export async function inspectGlb(
  glb: Uint8Array,
  thresholds: InspectThresholds = PROP_THRESHOLDS,
): Promise<InspectResult> {
  const doc = await io.readBinary(glb);
  return inspectDocument(doc, glb.byteLength, thresholds);
}

/** 既に読み込んだ Document を検査する (テストと、生成直後の検査で使い回す)。 */
export function inspectDocument(
  doc: Document,
  byteSize: number,
  thresholds: InspectThresholds = PROP_THRESHOLDS,
): InspectResult {
  const root = doc.getRoot();
  const meshes = root.listMeshes();
  const issues: InspectIssue[] = [];

  let triangles = 0;
  let hasUv = meshes.length > 0;
  let hasNormals = meshes.length > 0;
  for (const mesh of meshes) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      const position = prim.getAttribute('POSITION');
      const count = indices ? indices.getCount() : (position?.getCount() ?? 0);
      // MODE 4 = TRIANGLES。それ以外 (線・点) は面として数えない。
      if (prim.getMode() === 4) triangles += Math.floor(count / 3);
      if (!prim.getAttribute('TEXCOORD_0')) hasUv = false;
      if (!prim.getAttribute('NORMAL')) hasNormals = false;
    }
  }

  const textures = root.listTextures();
  let maxTextureSize = 0;
  for (const tex of textures) {
    const size = tex.getSize();
    if (size) maxTextureSize = Math.max(maxTextureSize, size[0], size[1]);
  }

  const bounds = computeBounds(root.listScenes().flatMap((s) => s.listChildren()));
  const sizeMeters = bounds
    ? {
        x: bounds.max[0] - bounds.min[0],
        y: bounds.max[1] - bounds.min[1],
        z: bounds.max[2] - bounds.min[2],
      }
    : { x: 0, y: 0, z: 0 };
  const minY = bounds ? bounds.min[1] : 0;
  const horizontalOffset = bounds
    ? Math.hypot((bounds.min[0] + bounds.max[0]) / 2, (bounds.min[2] + bounds.max[2]) / 2)
    : 0;

  const metrics: InspectMetrics = {
    triangles,
    materials: root.listMaterials().length,
    textures: textures.length,
    maxTextureSize,
    byteSize,
    sizeMeters,
    minY,
    horizontalOffset,
    hasUv,
    hasNormals,
    meshes: meshes.length,
  };

  // --- 判定 ---
  if (meshes.length === 0 || triangles === 0) {
    issues.push({
      code: 'no_mesh',
      message: 'メッシュが含まれていません。生成が失敗しています。',
      actual: triangles,
      expected: '> 0',
    });
    // メッシュが無い場合、以降の寸法判定は意味を持たないので打ち切る。
    return { ok: false, issues, metrics };
  }

  if (triangles > thresholds.maxTriangles) {
    issues.push({
      code: 'too_many_triangles',
      message: `三角形が多すぎます (${triangles.toLocaleString('ja-JP')})。軽量化しないと VRChat/Quest で使えません。`,
      actual: triangles,
      expected: `<= ${thresholds.maxTriangles}`,
    });
  }

  if (maxTextureSize > thresholds.maxTextureSize) {
    issues.push({
      code: 'texture_too_large',
      message: `テクスチャが大きすぎます (${maxTextureSize}px)。VRAM を無駄に食う商品は使われません。`,
      actual: maxTextureSize,
      expected: `<= ${thresholds.maxTextureSize}px`,
    });
  }

  if (textures.length > thresholds.maxTextureCount) {
    issues.push({
      code: 'too_many_textures',
      message: `テクスチャ枚数が多すぎます (${textures.length} 枚)。`,
      actual: textures.length,
      expected: `<= ${thresholds.maxTextureCount}`,
    });
  }

  if (metrics.materials > thresholds.maxMaterials) {
    issues.push({
      code: 'too_many_materials',
      message: `マテリアルが多すぎます (${metrics.materials})。Draw Call が増えます。`,
      actual: metrics.materials,
      expected: `<= ${thresholds.maxMaterials}`,
    });
  }

  if (!hasUv) {
    issues.push({
      code: 'missing_uv',
      message: 'UV (TEXCOORD_0) が無いプリミティブがあります。テクスチャが貼れません。',
      actual: 'missing',
      expected: 'present',
    });
  }

  if (!hasNormals) {
    issues.push({
      code: 'missing_normals',
      message: '法線 (NORMAL) が無いプリミティブがあります。陰影が崩れます。',
      actual: 'missing',
      expected: 'present',
    });
  }

  const longest = Math.max(sizeMeters.x, sizeMeters.y, sizeMeters.z);
  if (longest <= 0) {
    issues.push({
      code: 'degenerate_bounds',
      message: '寸法が 0 です。頂点が 1 点に潰れている可能性があります。',
      actual: longest,
      expected: '> 0',
    });
  } else if (longest < thresholds.minSizeMeters) {
    issues.push({
      code: 'scale_too_small',
      message: `小さすぎます (最大辺 ${longest.toFixed(3)}m)。glTF は 1 unit = 1m です。スケールを直してください。`,
      actual: Number(longest.toFixed(4)),
      expected: `>= ${thresholds.minSizeMeters}m`,
    });
  } else if (longest > thresholds.maxSizeMeters) {
    issues.push({
      code: 'scale_too_large',
      message: `大きすぎます (最大辺 ${longest.toFixed(2)}m)。glTF は 1 unit = 1m です。スケールを直してください。`,
      actual: Number(longest.toFixed(2)),
      expected: `<= ${thresholds.maxSizeMeters}m`,
    });
  }

  if (thresholds.requireGroundedOrigin) {
    if (Math.abs(minY) > thresholds.originToleranceMeters) {
      issues.push({
        code: 'origin_not_grounded',
        message: `底面が原点にありません (Y=${minY.toFixed(3)}m)。床置きの配置ができません。`,
        actual: Number(minY.toFixed(4)),
        expected: `|Y| <= ${thresholds.originToleranceMeters}m`,
      });
    }
    // 水平方向のずれは「最大辺の半分」を超えたら中心が外れていると見る。
    if (horizontalOffset > Math.max(longest / 2, thresholds.originToleranceMeters)) {
      issues.push({
        code: 'origin_far_from_center',
        message: `水平方向の中心が原点から離れています (${horizontalOffset.toFixed(3)}m)。配置時に基準が狂います。`,
        actual: Number(horizontalOffset.toFixed(4)),
        expected: `<= ${Math.max(longest / 2, thresholds.originToleranceMeters).toFixed(3)}m`,
      });
    }
  }

  if (byteSize > thresholds.maxByteSize) {
    issues.push({
      code: 'file_too_large',
      message: `ファイルが大きすぎます (${(byteSize / 1024 / 1024).toFixed(1)}MB)。`,
      actual: byteSize,
      expected: `<= ${thresholds.maxByteSize}`,
    });
  }

  return { ok: issues.length === 0, issues, metrics };
}

interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

/**
 * ノード階層を辿ってワールド空間のバウンディングボックスを出す。
 *
 * `node.getWorldMatrix()` ではなく自前で辿るのは、**スケール付きの親ノードを
 * 無視すると「データ上は 1m だが Unity では 40m」を見逃す**ため。
 * AI 生成の GLB は親ノードに 0.01 や 100 のスケールが入っていることが実際にある。
 */
function computeBounds(nodes: GltfNode[]): Bounds | null {
  let min: [number, number, number] = [Infinity, Infinity, Infinity];
  let max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let found = false;

  const walk = (node: GltfNode, parent: number[]): void => {
    const world = multiply(parent, trsMatrix(node));
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        const el = [0, 0, 0];
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, el);
          const p = transform(world, el as [number, number, number]);
          for (let a = 0; a < 3; a++) {
            if (p[a]! < min[a]!) min[a] = p[a]!;
            if (p[a]! > max[a]!) max[a] = p[a]!;
          }
          found = true;
        }
      }
    }
    for (const child of node.listChildren()) walk(child, world);
  };

  for (const n of nodes) walk(n, identity());
  return found ? { min, max } : null;
}

function identity(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** ノードの T/R/S から 4x4 (column-major) を作る。 */
function trsMatrix(node: GltfNode): number[] {
  const t = node.getTranslation();
  const r = node.getRotation(); // quaternion [x,y,z,w]
  const s = node.getScale();
  const [x, y, z, w] = r;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0]!, (xy + wz) * s[0]!, (xz - wy) * s[0]!, 0,
    (xy - wz) * s[1]!, (1 - (xx + zz)) * s[1]!, (yz + wx) * s[1]!, 0,
    (xz + wy) * s[2]!, (yz - wx) * s[2]!, (1 - (xx + yy)) * s[2]!, 0,
    t[0]!, t[1]!, t[2]!, 1,
  ];
}

function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function transform(m: number[], v: [number, number, number]): [number, number, number] {
  return [
    m[0]! * v[0] + m[4]! * v[1] + m[8]! * v[2] + m[12]!,
    m[1]! * v[0] + m[5]! * v[1] + m[9]! * v[2] + m[13]!,
    m[2]! * v[0] + m[6]! * v[1] + m[10]! * v[2] + m[14]!,
  ];
}
