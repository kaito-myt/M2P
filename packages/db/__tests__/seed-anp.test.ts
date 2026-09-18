/**
 * seed-anp.ts のユニットテスト。実 DB なしで挙動を検証する。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ANP_PROMPT_ROLES,
  buildAnpPromptSeeds,
  buildAnpModelAssignmentSeeds,
  runSeedAnp,
} from '../seed-anp.js';

type Row = Record<string, unknown> & { id: string };

interface MockTable {
  rows: Row[];
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
}

function makeTable(): MockTable {
  const rows: Row[] = [];
  let idCounter = 0;
  const nextId = () => `mock_${++idCounter}`;

  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const row = { id: nextId(), ...data } as Row;
    rows.push(row);
    return row;
  });

  const update = vi.fn(
    async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const found = rows.find((r) => r.id === where.id);
      if (!found) throw new Error(`row not found: ${where.id}`);
      Object.assign(found, data);
      return found;
    },
  );

  const findFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    return rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) ?? null;
  });

  return { rows, create, update, findFirst };
}

function makePrismaMock() {
  return { prompt: makeTable(), modelAssignment: makeTable() };
}

const silentLogger = { info: () => undefined, warn: () => undefined };

describe('buildAnpPromptSeeds', () => {
  it('7 role すべてに genre=null v1 active 行を1本ずつ生成する', () => {
    const seeds = buildAnpPromptSeeds();
    expect(seeds).toHaveLength(7);
    expect(seeds.map((s) => s.role).sort()).toEqual([...ANP_PROMPT_ROLES].sort());
    for (const s of seeds) {
      expect(s.genre).toBeNull();
      expect(s.version).toBe(1);
      expect(s.status).toBe('active');
      expect(s.body.length).toBeGreaterThan(50);
    }
  });
});

describe('buildAnpModelAssignmentSeeds', () => {
  it('7 role すべてに anthropic モデルを割当てる', () => {
    const seeds = buildAnpModelAssignmentSeeds();
    expect(seeds).toHaveLength(7);
    for (const s of seeds) {
      expect(s.provider).toBe('anthropic');
      expect(s.status).toBe('active');
    }
  });
});

describe('runSeedAnp', () => {
  it('prompt / modelAssignment を upsert し、2 回実行しても追加 create が発生しない (idempotent)', async () => {
    const prisma = makePrismaMock();
    const first = await runSeedAnp(prisma as never, silentLogger);
    expect(first.prompts).toBe(7);
    expect(first.modelAssignments).toBe(7);
    expect(prisma.prompt.create).toHaveBeenCalledTimes(7);
    expect(prisma.modelAssignment.create).toHaveBeenCalledTimes(7);

    await runSeedAnp(prisma as never, silentLogger);
    expect(prisma.prompt.create).toHaveBeenCalledTimes(7);
    expect(prisma.modelAssignment.create).toHaveBeenCalledTimes(7);
    expect(prisma.prompt.update).toHaveBeenCalledTimes(7);
    expect(prisma.modelAssignment.update).toHaveBeenCalledTimes(7);
  });
});
