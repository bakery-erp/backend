import { Router, Response } from 'express';
import { authMiddleware, requireRole, type AuthRequest } from '../../middleware/auth.js';
import { StockMovementsService } from './stock-movements.service.js';
import { parsePagination } from '../../lib/pagination.js';

export const stockMovementsRouter = Router();
const stockMovementsService = new StockMovementsService();

stockMovementsRouter.use(authMiddleware);

// GET /api/stock-movements?branchId=...&stockItemId=...&type=IN&status=PENDING_CONFIRMATION&from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&limit=20&search=...
stockMovementsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const stockItemId = req.query.stockItemId as string | undefined;
  const type = req.query.type as string | undefined;
  const status = req.query.status as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const search = req.query.search as string | undefined;
  const { page, limit } = parsePagination(req.query, 20, 100);

  const result = await stockMovementsService.getStockMovements(
    branchId,
    stockItemId,
    page,
    limit,
    type,
    from,
    to,
    status,
    search
  );
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

// GET /api/stock-movements/summary?branchId=... — inventory health dashboard widget
stockMovementsRouter.get('/summary', async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const result = await stockMovementsService.getStockSummary(branchId);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

// GET /api/stock-movements/loans/list — MUST be defined BEFORE /:id or /:stockItemId/history routes
stockMovementsRouter.get('/loans/list', async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const status = req.query.status as string | undefined;
  const search = req.query.search as string | undefined;
  const { page, limit } = parsePagination(req.query, 20, 100);

  const result = await stockMovementsService.getStockPurchaseLoans(branchId, status, page, limit, search);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

// POST /api/stock-movements/loans/:id/pay
stockMovementsRouter.post('/loans/:id/pay', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const { amount, note } = req.body;
  const result = await stockMovementsService.recordLoanPayment(req.params.id, req.user!.id, amount, note);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

// GET /api/stock-movements/:stockItemId/history — full ledger for a single item
stockMovementsRouter.get('/:stockItemId/history', async (req: AuthRequest, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const result = await stockMovementsService.getMovementsByStockItem(req.params.stockItemId, limit);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

// POST /api/stock-movements/:id/confirm — approve pending inward stock intake
stockMovementsRouter.post('/:id/confirm', requireRole('OWNER', 'ADMIN', 'STOCK_KEEPER'), async (req: AuthRequest, res: Response) => {
  const result = await stockMovementsService.confirmStockMovement(req.params.id, req.user!.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

// POST /api/stock-movements/:id/reject — reject pending inward stock intake
stockMovementsRouter.post('/:id/reject', requireRole('OWNER', 'ADMIN', 'STOCK_KEEPER'), async (req: AuthRequest, res: Response) => {
  const { reason } = req.body;
  const result = await stockMovementsService.rejectStockMovement(req.params.id, req.user!.id, reason);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

// GET /api/stock-movements/:id
stockMovementsRouter.get('/:id', async (req, res: Response) => {
  const result = await stockMovementsService.getStockMovementById(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

// POST /api/stock-movements — manual IN / OUT / ADJUSTMENT entry
stockMovementsRouter.post('/', requireRole('OWNER', 'ADMIN', 'STOCK_KEEPER'), async (req: AuthRequest, res: Response) => {
  if (req.user?.role === 'STOCK_KEEPER' && req.body?.type === 'IN') {
    return res.status(403).json({ error: 'Stock Keepers are not permitted to add stock' });
  }
  const result = await stockMovementsService.createStockMovement(req.body, req.user!.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(201).json(result.data);
});
