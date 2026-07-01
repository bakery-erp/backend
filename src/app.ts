import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger.js';
import { authRouter } from './modules/auth/index.js';
import { branchesRouter, usersRouter } from './modules/admin/index.js';
import { productCategoriesRouter, productsRouter } from './modules/catalog/index.js';
import { stockItemsRouter, stockMovementsRouter } from './modules/inventory/index.js';
import { productionBatchesRouter, productConversionsRouter } from './modules/production/index.js';
import { dailySessionsRouter, leftoverRecordsRouter, salesRouter } from './modules/sessions/index.js';
import { suppliersRouter, supplierDeliveriesRouter } from './modules/procurement/index.js';
import { expensesRouter, financialCategoriesRouter, loansRouter, penaltiesRouter, payrollRouter } from './modules/finance/index.js';
import { analyticsRouter, dashboardRouter, financialReportsRouter } from './modules/reporting/index.js';

export const app = express();

app.use('/uploads', express.static('uploads'));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

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
app.use('/api/penalties', penaltiesRouter);
app.use('/api/payroll', payrollRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/reports', financialReportsRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  const message = err instanceof Error ? err.message : 'Internal server error';
  res.status(500).json({ error: message });
});
