import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Request, Response, NextFunction } from 'express';
import {
  JsonFileStorage,
  PostgresStorage,
  StorageProvider,
  SurveySubmission,
  computeAggregates,
  submissionsToCsv,
} from './storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AppConfig {
  adminKey: string;
  storage: StorageProvider;
}

export function createApp(config: AppConfig) {
  const app = express();
  const { adminKey, storage } = config;

  app.use(express.json({ limit: '256kb' }));

  const publicDir = path.resolve(__dirname, '../public');
  app.use(express.static(publicDir));

  // Health check endpoint required by DigitalOcean App Platform
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      storageMode: storage.mode,
      timestamp: new Date().toISOString(),
    });
  });

  // Submit survey response
  app.post('/api/submit', async (req: Request, res: Response) => {
    try {
      const body = req.body || {};

      const cashLocation = String(body.cashLocation || '').trim();
      const confidenceLevel = Number(body.confidenceLevel);
      const topGoal = String(body.topGoal || '').trim();
      const biggestBlocker = String(body.biggestBlocker || '').trim();

      if (
        !cashLocation ||
        !topGoal ||
        !biggestBlocker ||
        Number.isNaN(confidenceLevel) ||
        confidenceLevel < 1 ||
        confidenceLevel > 5
      ) {
        res.status(400).json({
          error: 'Please complete all required multiple-choice questions before submitting.',
        });
        return;
      }

      const accountsUsed = Array.isArray(body.accountsUsed)
        ? body.accountsUsed.map((x: unknown) => String(x).trim()).filter(Boolean)
        : [];

      const topicsRequested = Array.isArray(body.topicsRequested)
        ? body.topicsRequested.map((x: unknown) => String(x).trim()).filter(Boolean)
        : [];

      const nickname = body.nickname ? String(body.nickname).trim().slice(0, 60) : undefined;
      const openQuestion = body.openQuestion
        ? String(body.openQuestion).trim().slice(0, 1000)
        : undefined;

      const submission: SurveySubmission = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        nickname,
        cashLocation,
        confidenceLevel,
        accountsUsed,
        topGoal,
        biggestBlocker,
        topicsRequested,
        openQuestion,
      };

      await storage.save(submission);
      const all = await storage.getAll();
      const aggregates = computeAggregates(all);

      res.status(201).json({
        ok: true,
        submissionId: submission.id,
        aggregates,
      });
    } catch (err) {
      console.error('Error saving survey submission:', err);
      res.status(500).json({ error: 'Failed to save submission.' });
    }
  });

  // Public anonymized pulse summary (no individual rows or open-text questions exposed)
  app.get('/api/summary', async (_req: Request, res: Response) => {
    try {
      const all = await storage.getAll();
      res.json(computeAggregates(all));
    } catch (err) {
      console.error('Error computing summary:', err);
      res.status(500).json({ error: 'Failed to load summary.' });
    }
  });

  // Admin authentication middleware for speaker dashboard & raw data export
  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    const providedKey =
      (req.headers['x-admin-key'] as string) || (req.query.key as string) || '';
    if (!adminKey || providedKey === adminKey) {
      next();
      return;
    }
    res.status(401).json({
      error: 'Unauthorized. Provide a valid admin key via ?key=YOUR_KEY or x-admin-key header.',
    });
  };

  // Full speaker dashboard data (aggregates + all individual submissions & open questions)
  app.get('/api/admin/submissions', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const submissions = await storage.getAll();
      const aggregates = computeAggregates(submissions);
      res.json({
        storageMode: storage.mode,
        aggregates,
        submissions,
      });
    } catch (err) {
      console.error('Error fetching admin submissions:', err);
      res.status(500).json({ error: 'Failed to fetch submissions.' });
    }
  });

  // Download raw JSON export
  app.get('/api/admin/export.json', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const submissions = await storage.getAll();
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="investment-101-responses-${new Date().toISOString().slice(0, 10)}.json"`
      );
      res.send(JSON.stringify(submissions, null, 2));
    } catch (err) {
      console.error('Error exporting JSON:', err);
      res.status(500).json({ error: 'Failed to export JSON.' });
    }
  });

  // Download CSV export (for Excel / Google Sheets / Polars)
  app.get('/api/admin/export.csv', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const submissions = await storage.getAll();
      const csv = submissionsToCsv(submissions);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="investment-101-responses-${new Date().toISOString().slice(0, 10)}.csv"`
      );
      res.send(csv);
    } catch (err) {
      console.error('Error exporting CSV:', err);
      res.status(500).json({ error: 'Failed to export CSV.' });
    }
  });

  // Speaker Dashboard route
  app.get('/results', (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, 'results.html'));
  });

  return app;
}

async function startServer() {
  const port = Number(process.env.PORT) || 8080;
  const adminKey = process.env.ADMIN_KEY || 'weekend101';
  const databaseUrl = process.env.DATABASE_URL;
  const dataFile = process.env.DATA_FILE || './data/submissions.json';

  const storage: StorageProvider = databaseUrl
    ? new PostgresStorage(databaseUrl)
    : new JsonFileStorage(dataFile);

  await storage.init();

  const app = createApp({ adminKey, storage });
  app.listen(port, '0.0.0.0', () => {
    console.log(
      `Investment 101 Survey running on http://0.0.0.0:${port} (storage=${storage.mode})`
    );
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
