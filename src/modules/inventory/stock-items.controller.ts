import { Router, Response } from 'express';
import { Role } from '@prisma/client';
import { authMiddleware, requireRole, type AuthRequest } from '../../middleware/auth.js';
import { StockItemsService } from './stock-items.service.js';
import { parsePagination } from '../../lib/pagination.js';

export const stockItemsRouter = Router();
const stockItemsService = new StockItemsService();

stockItemsRouter.use(authMiddleware);

// GET /api/stock-items?branchId=...&search=flour&unitType=KG&lowStockOnly=true&category=...&forProduction=true
stockItemsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const search = req.query.search as string | undefined;
  const unitType = req.query.unitType as string | undefined;
  const category = req.query.category as string | undefined;
  const lowStockOnly = req.query.lowStockOnly === 'true';
  const forProduction = req.query.forProduction === 'true';

  let forRole: Role | undefined = undefined;
  if (forProduction && req.user?.role && req.user.role !== 'OWNER') {
    forRole = req.user.role as Role;
  } else if (req.query.forRole) {
    forRole = req.query.forRole as Role;
  }

  const result = await stockItemsService.getStockItems(branchId, search, unitType, lowStockOnly, category, forRole);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

// GET /api/stock-items/role-materials — OWNER ONLY
stockItemsRouter.get('/role-materials', requireRole('OWNER'), async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const result = await stockItemsService.getRoleMaterials(branchId);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

// PUT /api/stock-items/role-materials — OWNER ONLY
stockItemsRouter.put('/role-materials', requireRole('OWNER'), async (req: AuthRequest, res: Response) => {
  const branchId = (req.body.branchId as string) || req.user?.branchId;
  const { role, stockItemIds } = req.body;
  if (!branchId) {
    return res.status(400).json({ error: 'branchId required' });
  }
  if (!role || !Array.isArray(stockItemIds)) {
    return res.status(400).json({ error: 'role and stockItemIds array required' });
  }
  const result = await stockItemsService.updateRoleMaterials(branchId, role as Role, stockItemIds);
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
  const { page, limit } = parsePagination(req.query, 20, 100);
  const type = req.query.type as string | undefined;
  const date = (req.query.date || req.query.from) as string | undefined;
  const result = await stockItemsService.getItemHistory(req.params.id, page, limit, type, date);
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
  const { quantity, reason, loanInfo, unitPrice, autoConfirm, date } = req.body;
  const isOwner = req.user?.role === 'OWNER';
  const effectiveAutoConfirm = isOwner ? Boolean(autoConfirm) : false;
  const result = await stockItemsService.addStockItem(req.params.id, req.user!.id, quantity, reason, loanInfo, unitPrice, effectiveAutoConfirm, date);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

stockItemsRouter.post('/:id/reduce', requireRole('OWNER', 'ADMIN', 'STOCK_KEEPER'), async (req: AuthRequest, res: Response) => {
  const { quantity, reason, receivedBy } = req.body;
  const result = await stockItemsService.reduceStockItem(req.params.id, req.user!.id, quantity, reason, receivedBy);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

stockItemsRouter.patch('/:id', requireRole('OWNER'), async (req: AuthRequest, res: Response) => {
  const result = await stockItemsService.updateStockItem(req.params.id, req.user!.id, req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

stockItemsRouter.delete('/:id', requireRole('OWNER'), async (req, res: Response) => {
  const result = await stockItemsService.deleteStockItem(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});
