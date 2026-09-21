import { describe, expect, it } from 'vitest';

import { envKeyFor, providerTestRequest } from '../settings-core';

describe('providerTestRequest / envKeyFor', () => {
  it('疎通テストのリクエストを組み立てる', () => {
    expect(providerTestRequest('anthropic', 'k').headers['x-api-key']).toBe('k');
    expect(providerTestRequest('google', 'k').url).toContain('key=k');
    expect(providerTestRequest('openai', 'k').headers.Authorization).toBe('Bearer k');
  });
  it('環境変数のキーを provider 名で引く (空/未設定は null)', () => {
    expect(envKeyFor('anthropic', { ANTHROPIC_API_KEY: ' sk-ant-x ' })).toBe('sk-ant-x');
    expect(envKeyFor('openai', { OPENAI_API_KEY: '' })).toBeNull();
    expect(envKeyFor('tavily', {})).toBeNull();
    expect(envKeyFor('google', { GOOGLE_GENERATIVE_AI_API_KEY: 'AIza' })).toBe('AIza');
  });
});
