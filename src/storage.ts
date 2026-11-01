import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;

export interface SurveySubmission {
  id: string;
  createdAt: string;
  nickname?: string;
  cashLocation: string;
  confidenceLevel: number;
  accountsUsed: string[];
  topGoal: string;
  biggestBlocker: string;
  topicsRequested: string[];
  openQuestion?: string;
}

export interface SurveyAggregates {
  totalResponses: number;
  averageConfidence: number;
  cashLocationCounts: Record<string, number>;
  confidenceDistribution: Record<string, number>;
  accountsUsedCounts: Record<string, number>;
  topGoalCounts: Record<string, number>;
  biggestBlockerCounts: Record<string, number>;
  topicsRequestedCounts: Record<string, number>;
}

export interface StorageProvider {
  init(): Promise<void>;
  save(submission: SurveySubmission): Promise<SurveySubmission>;
  getAll(): Promise<SurveySubmission[]>;
  clearAll(): Promise<void>;
  mode: 'postgres' | 'json-file';
}

export class JsonFileStorage implements StorageProvider {
  public mode: 'postgres' | 'json-file' = 'json-file';
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  async init(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    try {
      await fs.access(this.filePath);
    } catch {
      await fs.writeFile(this.filePath, JSON.stringify([], null, 2), 'utf8');
    }
  }

  async save(submission: SurveySubmission): Promise<SurveySubmission> {
    const existing = await this.getAll();
    existing.unshift(submission);
    await fs.writeFile(this.filePath, JSON.stringify(existing, null, 2), 'utf8');
    return submission;
  }

  async getAll(): Promise<SurveySubmission[]> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async clearAll(): Promise<void> {
    await fs.writeFile(this.filePath, JSON.stringify([], null, 2), 'utf8');
  }
}

export class PostgresStorage implements StorageProvider {
  public mode: 'postgres' | 'json-file' = 'postgres';
  private pool: pg.Pool;

  constructor(connectionString: string) {
    const isLocal =
      connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
    const sanitizedUrl = connectionString.replace(/[?&]sslmode=[^&]+/g, '');
    this.pool = new Pool({
      connectionString: sanitizedUrl,
      ssl: isLocal ? false : { rejectUnauthorized: false },
    });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS survey_submissions (
        id TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL,
        payload JSONB NOT NULL
      );
    `);
  }

  async save(submission: SurveySubmission): Promise<SurveySubmission> {
    await this.pool.query(
      `INSERT INTO survey_submissions (id, created_at, payload) VALUES ($1, $2, $3)`,
      [submission.id, submission.createdAt, JSON.stringify(submission)]
    );
    return submission;
  }

  async getAll(): Promise<SurveySubmission[]> {
    const result = await this.pool.query(
      `SELECT payload FROM survey_submissions ORDER BY created_at DESC`
    );
    return result.rows.map((row) => row.payload as SurveySubmission);
  }

  async clearAll(): Promise<void> {
    await this.pool.query(`TRUNCATE TABLE survey_submissions`);
  }
}

export function computeAggregates(submissions: SurveySubmission[]): SurveyAggregates {
  const cashLocationCounts: Record<string, number> = {};
  const confidenceDistribution: Record<string, number> = {
    '1': 0,
    '2': 0,
    '3': 0,
    '4': 0,
    '5': 0,
  };
  const accountsUsedCounts: Record<string, number> = {};
  const topGoalCounts: Record<string, number> = {};
  const biggestBlockerCounts: Record<string, number> = {};
  const topicsRequestedCounts: Record<string, number> = {};

  let confidenceSum = 0;

  for (const sub of submissions) {
    if (sub.cashLocation) {
      cashLocationCounts[sub.cashLocation] = (cashLocationCounts[sub.cashLocation] || 0) + 1;
    }

    const conf = Math.min(5, Math.max(1, Number(sub.confidenceLevel) || 1));
    confidenceSum += conf;
    confidenceDistribution[String(conf)] = (confidenceDistribution[String(conf)] || 0) + 1;

    for (const acc of sub.accountsUsed || []) {
      accountsUsedCounts[acc] = (accountsUsedCounts[acc] || 0) + 1;
    }

    if (sub.topGoal) {
      topGoalCounts[sub.topGoal] = (topGoalCounts[sub.topGoal] || 0) + 1;
    }

    if (sub.biggestBlocker) {
      biggestBlockerCounts[sub.biggestBlocker] = (biggestBlockerCounts[sub.biggestBlocker] || 0) + 1;
    }

    for (const topic of sub.topicsRequested || []) {
      topicsRequestedCounts[topic] = (topicsRequestedCounts[topic] || 0) + 1;
    }
  }

  const totalResponses = submissions.length;
  const averageConfidence =
    totalResponses > 0 ? Number((confidenceSum / totalResponses).toFixed(2)) : 0;

  return {
    totalResponses,
    averageConfidence,
    cashLocationCounts,
    confidenceDistribution,
    accountsUsedCounts,
    topGoalCounts,
    biggestBlockerCounts,
    topicsRequestedCounts,
  };
}

export function submissionsToCsv(submissions: SurveySubmission[]): string {
  const headers = [
    'id',
    'createdAt',
    'nickname',
    'cashLocation',
    'confidenceLevel',
    'accountsUsed',
    'topGoal',
    'biggestBlocker',
    'topicsRequested',
    'openQuestion',
  ];

  const escapeCsvCell = (val: unknown): string => {
    if (val === null || val === undefined) return '""';
    const str = Array.isArray(val) ? val.join('; ') : String(val);
    const escaped = str.replace(/"/g, '""');
    return `"${escaped}"`;
  };

  const rows = submissions.map((s) =>
    [
      s.id,
      s.createdAt,
      s.nickname || '',
      s.cashLocation,
      s.confidenceLevel,
      s.accountsUsed,
      s.topGoal,
      s.biggestBlocker,
      s.topicsRequested,
      s.openQuestion || '',
    ]
      .map(escapeCsvCell)
      .join(',')
  );

  return [headers.join(','), ...rows].join(String.fromCharCode(10));
}
