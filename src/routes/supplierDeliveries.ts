import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { utcDayRangeInclusive } from '../lib/businessDate.js';
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js';

function decimalToNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return 0;
}

export const supplierDeliveriesRouter = Router();
supplierDeliveriesRouter.use(authMiddleware);

supplierDeliveriesRouter.get('/', async (req: AuthRequest, res) => {
  const supplierId = req.query.supplierId as string | undefined;
  const branchId = req.query.branchId as string | undefined;
  const isPaid = req.query.isPaid as string | undefined;
  const dateYmd = (req.query.date as string | undefined)?.trim();
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const where: any = {};
  if (supplierId) where.supplierId = supplierId;
  if (branchId) where.supplier = { branchId };
  if (isPaid !== undefined) where.isPaid = isPaid === 'true';
  if (dateYmd) {
    const range = utcDayRangeInclusive(dateYmd);
    if (range) {
      where.createdAt = { gte: range.start, lte: range.end };
    }
  }
  const list = await prisma.supplierDelivery.findMany({
    where,
    include: { supplier: true, product: true, stockItem: true },
    orderBy: { createdAt: 'desc' },
    take: dateYmd ? 500 : limit,
  });
  res.json(list);
});

supplierDeliveriesRouter.get('/:id', async (req, res) => {
  const delivery = await prisma.supplierDelivery.findUnique({
    where: { id: req.params.id },
    include: { supplier: true, product: true, stockItem: true },
  });
  if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
  res.json(delivery);
});

supplierDeliveriesRouter.post('/', requireRole('OWNER', 'ADMIN', 'SAMBUSA_WORKER'), async (req: AuthRequest, res) => {
  const { supplierId, productId, stockItemId, quantityReceived, unitBuyPrice, unitSellPrice, isPaid, returnedQuantity } = req.body as Record<string, unknown>;
  if (!supplierId || !productId || quantityReceived == null || unitBuyPrice == null || unitSellPrice == null) {
    return res.status(400).json({ error: 'supplierId, productId, quantityReceived, unitBuyPrice, unitSellPrice required' });
  }
  const qty = typeof quantityReceived === 'number' ? quantityReceived : parseInt(String(quantityReceived), 10);
  const delivery = await prisma.supplierDelivery.create({
    data: {
      supplierId: supplierId as string,
      productId: productId as string,
      stockItemId: (stockItemId as string) || null,
      quantityReceived: qty,
      unitBuyPrice: decimalToNum(unitBuyPrice),
      unitSellPrice: decimalToNum(unitSellPrice),
      isPaid: Boolean(isPaid),
      returnedQuantity: returnedQuantity != null ? parseInt(String(returnedQuantity), 10) : 0,
    },
    include: { supplier: true, product: true, stockItem: true },
  });
  if (stockItemId && typeof stockItemId === 'string') {
    const item = await prisma.stockItem.findUnique({ where: { id: stockItemId } });
    if (item) {
      const netQty = qty - (delivery.returnedQuantity ?? 0);
      await prisma.stockItem.update({
        where: { id: stockItemId },
        data: { currentQuantity: Number(item.currentQuantity) + netQty },
      });
      await prisma.stockMovement.create({
        data: {
          stockItemId,
          userId: req.user!.id,
          quantity: netQty,
          type: 'IN',
          reason: `Supplier delivery ${delivery.id}`,
        },
      });
    }
  }
  res.status(201).json(delivery);
});

supplierDeliveriesRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { isPaid, returnedQuantity } = req.body as { isPaid?: boolean; returnedQuantity?: number };
  const delivery = await prisma.supplierDelivery.update({
    where: { id: req.params.id },
    data: {
      ...(isPaid !== undefined && { isPaid }),
      ...(returnedQuantity !== undefined && { returnedQuantity }),
    },
    include: { supplier: true, product: true },
  });
  res.json(delivery);
});
