import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js';

function decimalToNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return 0;
}

export const stockMovementsRouter = Router();
stockMovementsRouter.use(authMiddleware);

stockMovementsRouter.get('/', async (req: AuthRequest, res) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const stockItemId = req.query.stockItemId as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const stockWhere = branchId ? { branchId } : {};
  const where: any = { user: { isActive: true } };
  if (stockItemId) where.stockItemId = stockItemId;
  else where.stockItem = stockWhere;
  const list = await prisma.stockMovement.findMany({
    where,
    include: { stockItem: { select: { id: true, name: true, unitType: true } }, user: { select: { id: true, fullName: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  res.json(list);
});

stockMovementsRouter.get('/:id', async (req, res) => {
  const movement = await prisma.stockMovement.findUnique({
    where: { id: req.params.id },
    include: { stockItem: true, user: { select: { id: true, fullName: true, phone: true } } },
  });
  if (!movement) return res.status(404).json({ error: 'Stock movement not found' });
  res.json(movement);
});

stockMovementsRouter.post('/', requireRole('OWNER', 'ADMIN', 'BAKER'), async (req: AuthRequest, res) => {
  const { stockItemId, quantity, type, reason } = req.body as {
    stockItemId: string;
    quantity: number | string;
    type: string;
    reason?: string;
  };
  if (!stockItemId || quantity == null || !type) {
    return res.status(400).json({ error: 'stockItemId, quantity, type (IN|OUT|ADJUSTMENT|PRODUCTION_USAGE) required' });
  }
  const qty = decimalToNum(quantity);
  const stockItem = await prisma.stockItem.findUnique({ where: { id: stockItemId } });
  if (!stockItem) return res.status(404).json({ error: 'Stock item not found' });
  const current = Number(stockItem.currentQuantity);
  if (type === 'OUT' || type === 'ADJUSTMENT' || type === 'PRODUCTION_USAGE') {
    if (qty > current) return res.status(400).json({ error: 'Insufficient stock' });
  }
  const newQty = type === 'IN' ? current + qty : current - qty;
  if (type === 'ADJUSTMENT') {
    const adjQty = decimalToNum(req.body.adjustTo);
    if (adjQty != null && !Number.isNaN(adjQty)) {
      await prisma.stockItem.update({ where: { id: stockItemId }, data: { currentQuantity: adjQty } });
      const movement = await prisma.stockMovement.create({
        data: {
          stockItemId,
          userId: req.user!.id,
          quantity: Math.abs(adjQty - current),
          type: 'ADJUSTMENT',
          reason: reason || `Adjusted to ${adjQty}`,
        },
        include: { stockItem: true, user: { select: { id: true, fullName: true } } },
      });
      return res.status(201).json(movement);
    }
  }
  await prisma.stockItem.update({ where: { id: stockItemId }, data: { currentQuantity: newQty } });
  const movement = await prisma.stockMovement.create({
    data: {
      stockItemId,
      userId: req.user!.id,
      quantity: qty,
      type: type as any,
      reason: reason || null,
    },
    include: { stockItem: true, user: { select: { id: true, fullName: true } } },
  });
  res.status(201).json(movement);
});
