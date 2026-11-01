import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AddressInfo } from 'node:net';
import { createApp } from './server.js';
import { JsonFileStorage } from './storage.js';

describe('Investment 101 Survey API & Export Tests', () => {
  let tmpDir: string;
  let storage: JsonFileStorage;
  let baseUrl: string;
  let server: ReturnType<ReturnType<typeof createApp>['listen']>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'inv101-test-'));
    storage = new JsonFileStorage(path.join(tmpDir, 'submissions.json'));
    await storage.init();

    const app = createApp({ adminKey: 'secret123', storage });
    server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('GET /health returns 200 ok with storageMode', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { status: string; storageMode: string };
    assert.equal(data.status, 'ok');
    assert.equal(data.storageMode, 'json-file');
  });

  test('POST /api/submit validates required fields and persists submission', async () => {
    const badRes = await fetch(`${baseUrl}/api/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cashLocation: 'HYSA' }),
    });
    assert.equal(badRes.status, 400);

    const validPayload = {
      nickname: 'Alex',
      cashLocation: 'High-Yield Savings / Money Market / CDs',
      confidenceLevel: 3,
      accountsUsed: ['401(k) / 403(b) Employer Plan', 'Roth IRA / Traditional IRA / Backdoor Roth'],
      topGoal: 'Buying a Home / Condo Down Payment',
      biggestBlocker: 'Need Liquidity (Keeping cash for a big purchase)',
      topicsRequested: ['Rent vs. Buy Math & Saving for a Down Payment', 'Simple 3-Fund / ETF Portfolio Construction'],
      openQuestion: 'Should my house down payment be in SGOV or HYSA?',
    };

    const goodRes = await fetch(`${baseUrl}/api/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validPayload),
    });
    assert.equal(goodRes.status, 201);
    const body = (await goodRes.json()) as {
      ok: boolean;
      aggregates: { totalResponses: number; averageConfidence: number };
    };
    assert.equal(body.ok, true);
    assert.equal(body.aggregates.totalResponses, 1);
    assert.equal(body.aggregates.averageConfidence, 3);
  });

  test('Admin endpoints enforce key and return full submissions, CSV, and JSON exports', async () => {
    // Seed a response
    await fetch(`${baseUrl}/api/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: 'Sam',
        cashLocation: 'Checking / Standard Bank Savings',
        confidenceLevel: 2,
        accountsUsed: ['401(k) / 403(b) Employer Plan'],
        topGoal: 'Long-Term Wealth / Work Optionality (FI)',
        biggestBlocker: "Analysis Paralysis (Don't know which funds/accounts)",
        topicsRequested: ['Order of Operations (Where each dollar goes first)'],
        openQuestion: 'How does Backdoor Roth work if I have a Rollover IRA?',
      }),
    });

    // Unauthorized check
    const unauthRes = await fetch(`${baseUrl}/api/admin/submissions?key=wrong`);
    assert.equal(unauthRes.status, 401);

    // Authorized check
    const adminRes = await fetch(`${baseUrl}/api/admin/submissions?key=secret123`);
    assert.equal(adminRes.status, 200);
    const adminData = (await adminRes.json()) as {
      submissions: Array<{ nickname: string; openQuestion: string }>;
    };
    assert.equal(adminData.submissions.length, 1);
    assert.equal(adminData.submissions[0].nickname, 'Sam');
    assert.match(adminData.submissions[0].openQuestion, /Backdoor Roth/);

    // CSV export check
    const csvRes = await fetch(`${baseUrl}/api/admin/export.csv?key=secret123`);
    assert.equal(csvRes.status, 200);
    assert.match(csvRes.headers.get('content-type') || '', /text\/csv/);
    const csvText = await csvRes.text();
    assert.match(csvText, /id,createdAt,nickname,cashLocation/);
    assert.match(csvText, /"Sam"/);
    assert.match(csvText, /"How does Backdoor Roth work if I have a Rollover IRA\?"/);

    // JSON export check
    const jsonRes = await fetch(`${baseUrl}/api/admin/export.json?key=secret123`);
    assert.equal(jsonRes.status, 200);
    const exportedArr = (await jsonRes.json()) as Array<{ nickname: string }>;
    assert.equal(exportedArr.length, 1);
    assert.equal(exportedArr[0].nickname, 'Sam');
  });
});
