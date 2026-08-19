import { Router, Response } from 'express';
import { authMiddleware, requireRole, type AuthRequest } from '../../middleware/auth.js';
import { StockMovementsService } from './stock-movements.service.js';

export const stockMovementsRouter = Router();
const stockMovementsService = new StockMovementsService();

stockMovementsRouter.use(authMiddleware);

// GET /api/stock-movements?branchId=...&stockItemId=...&type=IN&from=YYYY-MM-DD&to=YYYY-MM-DD&limit=50
stockMovementsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const stockItemId = req.query.stockItemId as string | undefined;
  const type = req.query.type as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const result = await stockMovementsService.getStockMovements(branchId, stockItemId, limit, type, from, to);
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

// GET /api/stock-movements/:stockItemId/history — full ledger for a single item
stockMovementsRouter.get('/:stockItemId/history', async (req: AuthRequest, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const result = await stockMovementsService.getMovementsByStockItem(req.params.stockItemId, limit);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

stockMovementsRouter.get('/:id', async (req, res: Response) => {
  const result = await stockMovementsService.getStockMovementById(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

// POST /api/stock-movements — manual IN / OUT / ADJUSTMENT entry by admin/owner
stockMovementsRouter.post('/', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const result = await stockMovementsService.createStockMovement(req.body, req.user!.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(201).json(result.data);
});

