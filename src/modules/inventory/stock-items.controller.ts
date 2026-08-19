import { Router, Response } from 'express';
import { authMiddleware, requireRole, type AuthRequest } from '../../middleware/auth.js';
import { StockItemsService } from './stock-items.service.js';

export const stockItemsRouter = Router();
const stockItemsService = new StockItemsService();

stockItemsRouter.use(authMiddleware);

// GET /api/stock-items?branchId=...&search=flour&unitType=KG&lowStockOnly=true
stockItemsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const search = req.query.search as string | undefined;
  const unitType = req.query.unitType as string | undefined;
  const lowStockOnly = req.query.lowStockOnly === 'true';
  const result = await stockItemsService.getStockItems(branchId, search, unitType, lowStockOnly);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

stockItemsRouter.get('/alerts/low-stock', async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const result = await stockItemsService.getLowStockAlerts(branchId);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

stockItemsRouter.get('/:id/history', async (req: AuthRequest, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
  const result = await stockItemsService.getItemHistory(req.params.id, limit);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

stockItemsRouter.get('/:id', async (req, res: Response) => {
  const result = await stockItemsService.getStockItemById(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

stockItemsRouter.post('/', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const result = await stockItemsService.createStockItem(req.body, req.user!.id, req.user?.branchId);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(201).json(result.data);
});

stockItemsRouter.post('/:id/add', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const { quantity, reason } = req.body;
  const result = await stockItemsService.addStockItem(req.params.id, req.user!.id, quantity, reason);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

stockItemsRouter.post('/:id/reduce', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const { quantity, reason } = req.body;
  const result = await stockItemsService.reduceStockItem(req.params.id, req.user!.id, quantity, reason);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

stockItemsRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const result = await stockItemsService.updateStockItem(req.params.id, req.user!.id, req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

stockItemsRouter.delete('/:id', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await stockItemsService.deleteStockItem(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});
