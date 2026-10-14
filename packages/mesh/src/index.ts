/**
 * `@a2p/mesh` — 3DP の 3D アセット検査・最適化 (docs/12-3dp-design.md §4.3)。
 *
 * 生成 API (Meshy 等) の出力をそのまま売らず、**「使えるデータか」を機械的に判定**し、
 * 配布用に軽量化してから商品にする。ここが 3DP の付加価値。
 */
export {
  inspectGlb,
  inspectDocument,
  PROP_THRESHOLDS,
  ACCESSORY_THRESHOLDS,
  type InspectThresholds,
  type InspectResult,
  type InspectIssue,
  type InspectIssueCode,
  type InspectMetrics,
} from './inspect.js';
export { optimizeGlb, type OptimizeOptions, type OptimizeResult } from './optimize.js';
export {
  MeshyClient,
  MeshyError,
  PROP_NEGATIVE_PROMPT,
  buildPropPromptSuffix,
  type MeshyClientOptions,
  type MeshyTask,
  type MeshyTaskStatus,
  type MeshyTextTo3dArgs,
} from './meshy.js';
