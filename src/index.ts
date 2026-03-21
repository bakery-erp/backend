import 'dotenv/config';
import express from 'express';
import { validateEnv } from './lib/env.js';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger.js';
import { authRouter } from './routes/auth.js';
import { branchesRouter } from './routes/branches.js';
import { usersRouter } from './routes/users.js';
import { productCategoriesRouter } from './routes/productCategories.js';
import { productsRouter } from './routes/products.js';
import { stockItemsRouter } from './routes/stockItems.js';
import { stockMovementsRouter } from './routes/stockMovements.js';
import { productionBatchesRouter } from './routes/productionBatches.js';
import { productConversionsRouter } from './routes/productConversions.js';
import { dailySessionsRouter } from './routes/dailySessions.js';
import { salesRouter } from './routes/sales.js';
import { leftoverRecordsRouter } from './routes/leftoverRecords.js';
import { suppliersRouter } from './routes/suppliers.js';
import { supplierDeliveriesRouter } from './routes/supplierDeliveries.js';
import { expensesRouter } from './routes/expenses.js';
import { loansRouter } from './routes/loans.js';
import { penaltiesRouter } from './routes/penalties.js';
import { payrollRouter } from './routes/payroll.js';
import { analyticsRouter } from './routes/analytics.js';
import { dashboardRouter } from './routes/dashboard.js';

const app = express();
const PORT = process.env.PORT ?? 3001;

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
app.use('/api/loans', loansRouter);
app.use('/api/penalties', penaltiesRouter);
app.use('/api/payroll', payrollRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/dashboard', dashboardRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message ?? 'Internal server error' });
});

validateEnv();

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Swagger at http://localhost:${PORT}/api-docs`);
});
