import express from 'express';
import path from 'node:path';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { internalRouter } from './routes/internal.js';
import { adminRouter, publicChecklistRouter } from './routes/admin.js';
import { zohoRouter, zohoWebhookHandler } from './routes/zoho.js';
import { ensureDbExists } from './routes/adminStore.js';

const app = express();

app.post('/zoho/webhooks/sign', express.raw({ type: '*/*', limit: '2mb' }), zohoWebhookHandler);
app.use(express.json({ limit: '10mb' }));

app.get('/', (_req, res) => {
  res.status(200).json({
    service: 'NeztEz API',
    status: 'running',
  });
});

app.use('/health', healthRouter);
app.use('/internal', internalRouter);
app.use('/admin', adminRouter);
app.use('/public/checklists', publicChecklistRouter);
app.use('/zoho', zohoRouter);

const publicDir = path.resolve(process.cwd(), 'public');
app.use('/static', express.static(publicDir));

app.get('/admin-app', (_req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

app.get('/checklist/:token', (_req, res) => {
  res.sendFile(path.join(publicDir, 'checklist.html'));
});

app.listen(config.port, () => {
  console.log(`API listening on port ${config.port}`);
});

ensureDbExists().catch((err) => {
  console.error('Failed to initialize data store:', err);
  process.exit(1);
});
