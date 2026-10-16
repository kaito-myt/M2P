import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Server Action のテストが `@/` import を解決できるように tsconfig の paths と揃える。
export default defineConfig({
  test: { environment: 'node', exclude: ['**/node_modules/**', '**/.next/**'] },
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
});
