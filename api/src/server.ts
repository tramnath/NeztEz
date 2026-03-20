import express from 'express';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { internalRouter } from './routes/internal.js';
import { zohoRouter, zohoWebhookHandler } from './routes/zoho.js';

const app = express();

app.post('/zoho/webhooks/sign', express.raw({ type: '*/*', limit: '2mb' }), zohoWebhookHandler);
app.use(express.json({ limit: '10mb' }));

app.get('/', (_req, res) => {
  res.status(200).json({
    service: 'NeztEz Zoho Sign API',
    status: 'running',
  });
});

app.use('/health', healthRouter);
app.use('/internal', internalRouter);
app.use('/zoho', zohoRouter);

app.listen(config.port, () => {
  console.log(`API listening on port ${config.port}`);
});
