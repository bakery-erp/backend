import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js';

function decimalToNum(v: unknown) {
  if (v == null) return undefined;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return undefined;
}

export const stockItemsRouter = Router();
stockItemsRouter.use(authMiddleware);

stockItemsRouter.get('/', async (req: AuthRequest, res) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  if (!branchId) return res.status(400).json({ error: 'branchId required' });
  const list = await prisma.stockItem.findMany({
    where: { branchId },
    orderBy: { name: 'asc' },
  });
  res.json(list);
});

stockItemsRouter.get('/:id', async (req, res) => {
  const item = await prisma.stockItem.findUnique({
    where: { id: req.params.id },
    include: { branch: { select: { id: true, name: true } } },
  });
  if (!item) return res.status(404).json({ error: 'Stock item not found' });
  res.json(item);
});

stockItemsRouter.post('/', requireRole('OWNER', 'ADMIN', 'BAKER', 'SAMBUSA_WORKER'), async (req: AuthRequest, res) => {
  const { branchId, name, unitType, currentQuantity, minStockLevel } = req.body as Record<string, unknown>;
  const bid = (branchId as string) || req.user?.branchId;
  if (!bid || !name || !unitType) return res.status(400).json({ error: 'branchId, name, unitType required' });
  const item = await prisma.stockItem.create({
    data: {
      branchId: bid,
      name: String(name).trim(),
      unitType: unitType as any,
      currentQuantity: decimalToNum(currentQuantity) ?? 0,
      minStockLevel: minStockLevel != null ? decimalToNum(minStockLevel) : null,
    },
  });
  res.status(201).json(item);
});

stockItemsRouter.patch('/:id', requireRole('OWNER', 'ADMIN', 'BAKER', 'SAMBUSA_WORKER'), async (req, res) => {
  const { name, unitType, currentQuantity, minStockLevel } = req.body as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (name != null) data.name = String(name).trim();
  if (unitType != null) data.unitType = unitType;
  if (currentQuantity != null) data.currentQuantity = decimalToNum(currentQuantity);
  if (minStockLevel !== undefined) data.minStockLevel = minStockLevel != null ? decimalToNum(minStockLevel) : null;
  const item = await prisma.stockItem.update({
    where: { id: req.params.id },
    data: data as any,
  });
  res.json(item);
});
