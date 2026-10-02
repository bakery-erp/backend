import express from 'express';
import cors from 'cors';
import compression from 'compression';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger.js';
import { authRouter } from './modules/auth/auth.controller.js';
import { branchesRouter, usersRouter } from './modules/admin/index.js';
import { productCategoriesRouter } from './modules/catalog/product-categories.controller.js';
import { productsRouter } from './modules/catalog/products.controller.js';
import { stockItemsRouter } from './modules/inventory/stock-items.controller.js';
import { stockMovementsRouter } from './modules/inventory/stock-movements.controller.js';
import { productionBatchesRouter } from './modules/production/production-batches.controller.js';
import { productConversionsRouter } from './modules/production/product-conversions.controller.js';
import { dailySessionsRouter, leftoverRecordsRouter, salesRouter, DailySessionsService } from './modules/sessions/index.js';
import { suppliersRouter, supplierDeliveriesRouter } from './modules/procurement/index.js';
import { financialCategoriesRouter, expensesRouter, loansRouter, penaltiesRouter, payrollRouter } from './modules/finance/index.js';
import { analyticsRouter, dashboardRouter, financialReportsRouter } from './modules/reporting/index.js';
import { customersRouter } from './modules/customers/customers.controller.js';
import { prisma } from './lib/prisma.js';
import path from 'path';
import fs from 'fs';

export const app = express();

// Midnight Session Auto-Closer Scheduled Job (runs on startup & every 60 seconds)
try {
  DailySessionsService.autoCloseExpiredSessions().catch(() => {});
} catch {
  // ignore
}
const autoCloseInterval = setInterval(() => {
  DailySessionsService.autoCloseExpiredSessions().catch(() => {});
}, 60 * 1000);
if (autoCloseInterval && typeof autoCloseInterval.unref === 'function') {
  autoCloseInterval.unref();
}

const uploadsDir = process.env.VERCEL ? path.join('/tmp', 'uploads') : path.join(process.cwd(), 'uploads');
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch (e) {
  console.warn('[Uploads Directory]', e);
}

// Serve uploaded media / documents statically and fallback to DB for serverless
app.use('/uploads', express.static(uploadsDir));

app.get(['/uploads/:filename', '/api/uploads/:filename'], async (req, res) => {
  const { filename } = req.params;
  const localPath = path.join(uploadsDir, filename);
  if (fs.existsSync(localPath)) {
    return res.sendFile(localPath);
  }
  try {
    const fileRecord = await prisma.uploadedFile.findUnique({
      where: { filename },
    });
    if (fileRecord) {
      try {
        if (!fs.existsSync(localPath)) {
          fs.writeFileSync(localPath, fileRecord.data);
        }
      } catch {}
      res.setHeader('Content-Type', fileRecord.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.end(fileRecord.data);
    }
  } catch (err) {
    console.error('[Uploads Serve Error]', err);
  }
  return res.status(404).send('Cannot GET ' + req.originalUrl);
});

// Universal CORS & Preflight handler (guarantees preflight always succeeds with 200)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-branch-id, x-tenant-id');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(
  cors({
    origin: (_origin, callback) => {
      // Allow any requesting origin (including local dev, mobile web, production domains, and curl)
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Origin', 'Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'x-branch-id', 'x-tenant-id'],
    optionsSuccessStatus: 200,
  })
);

// Respond to preflight OPTIONS requests across all routes
app.options('*', cors());

app.use(compression());
app.use(express.json());

app.get('/', (_req, res) => res.json({ ok: true, service: 'Koket Bakery ERP Backend API' }));
app.get('/api', (_req, res) => res.json({ ok: true, service: 'Koket Bakery ERP Backend API' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api-docs.json', (_req, res) => res.json(swaggerSpec));

app.use('/api/auth', authRouter);
app.use('/api/branches', branchesRouter);
app.use('/api/users', usersRouter);
app.use('/api/product-categories', productCategoriesRouter);
app.use('/api/products', productsRouter);
app.use('/api/stock-items', stockItemsRouter);
app.use('/api/stock-movements', stockMovementsRouter);
app.use('/api/production-batches', productionBatchesRouter);
app.use('/api/product-conversions', productConversionsRouter);
app.use('/api/daily-sessions', dailySessionsRouter);
app.use('/api/sales', salesRouter);
app.use('/api/leftover-records', leftoverRecordsRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/supplier-deliveries', supplierDeliveriesRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/financial-categories', financialCategoriesRouter);
app.use('/api/loans', loansRouter);
app.use('/api/customers', customersRouter);
app.use('/api/penalties', penaltiesRouter);
app.use('/api/payroll', payrollRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/reports', financialReportsRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  res.status(500).json({ error: message });
});

export default app;

