import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js';

export const productConversionsRouter = Router();
productConversionsRouter.use(authMiddleware);

productConversionsRouter.get('/', async (req: AuthRequest, res) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const where = branchId ? { branchId } : {};
  const list = await prisma.productConversion.findMany({
    where,
    include: {
      fromProduct: { select: { id: true, name: true, flavor: true } },
      toProduct: { select: { id: true, name: true, flavor: true } },
      user: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  res.json(list);
});

productConversionsRouter.get('/:id', async (req, res) => {
  const conversion = await prisma.productConversion.findUnique({
    where: { id: req.params.id },
    include: {
      fromProduct: { select: { id: true, name: true, flavor: true } },
      toProduct: { select: { id: true, name: true, flavor: true } },
      user: { select: { id: true, fullName: true } },
    },
  });
  if (!conversion) return res.status(404).json({ error: 'Conversion not found' });
  res.json(conversion);
});

productConversionsRouter.post('/', requireRole('OWNER', 'ADMIN', 'BAKER'), async (req: AuthRequest, res) => {
  const { branchId, fromProductId, toProductId, fromQuantity, toQuantity } = req.body as {
    branchId?: string;
    fromProductId: string;
    toProductId: string;
    fromQuantity: number;
    toQuantity: number;
  };
  const bid = branchId || req.user?.branchId;
  if (!bid || !fromProductId || !toProductId || fromQuantity == null || toQuantity == null) {
    return res.status(400).json({ error: 'branchId, fromProductId, toProductId, fromQuantity, toQuantity required' });
  }
  if (fromProductId === toProductId) {
    return res.status(400).json({ error: 'Source and result products must be different' });
  }
  const fromQ = typeof fromQuantity === 'number' ? fromQuantity : parseInt(String(fromQuantity), 10);
  const toQ = typeof toQuantity === 'number' ? toQuantity : parseInt(String(toQuantity), 10);
  if (!Number.isFinite(fromQ) || !Number.isFinite(toQ) || fromQ < 1 || toQ < 1 || !Number.isInteger(fromQ) || !Number.isInteger(toQ)) {
    return res.status(400).json({ error: 'Quantities must be positive whole numbers (e.g. 1 and 10)' });
  }
  const conversion = await prisma.productConversion.create({
    data: {
      branchId: bid,
      userId: req.user!.id,
      fromProductId,
      toProductId,
      fromQuantity: fromQ,
      toQuantity: toQ,
    },
    include: {
      fromProduct: true,
      toProduct: true,
      user: { select: { id: true, fullName: true } },
    },
  });
  res.status(201).json(conversion);
});

productConversionsRouter.delete('/:id', requireRole('OWNER', 'ADMIN', 'BAKER'), async (req, res) => {
  await prisma.productConversion.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
