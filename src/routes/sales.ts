import { Router } from 'express';
import { PaymentMethod, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js';
import { asyncHandler } from '../lib/routeUtils.js';

function decimalToNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') return parseFloat(v) || 0;
  return 0;
}

/** Prisma enum is strict; invalid strings caused 500s. */
function parsePaymentMethod(v: unknown): PaymentMethod {
  const s = String(v ?? 'CASH')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
  if (s === 'MOBILE_BANKING') return PaymentMethod.MOBILE_BANKING;
  return PaymentMethod.CASH;
}

function moneyDecimal(n: number): Prisma.Decimal {
  const x = Math.round(n * 100) / 100;
  return new Prisma.Decimal(x.toFixed(2));
}

export const salesRouter = Router();
salesRouter.use(authMiddleware);

salesRouter.get('/', requireRole('OWNER', 'ADMIN', 'CASHIER'), async (req: AuthRequest, res) => {
  const sessionId = req.query.sessionId as string | undefined;
  const branchId = req.query.branchId as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const where: Record<string, unknown> = {};
  if (sessionId) where.sessionId = sessionId;
  if (branchId) where.session = { branchId };
  const list = await prisma.sale.findMany({
    where,
    include: {
      session: { select: { id: true, date: true, branchId: true } },
      user: { select: { id: true, fullName: true } },
      items: { include: { product: { select: { id: true, name: true, flavor: true, unitType: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  res.json(list);
});

salesRouter.get('/:id', requireRole('OWNER', 'ADMIN', 'CASHIER'), async (req, res) => {
  const sale = await prisma.sale.findUnique({
    where: { id: req.params.id },
    include: {
      session: { select: { id: true, date: true, branchId: true, status: true } },
      user: { select: { id: true, fullName: true, phone: true } },
      items: { include: { product: true } },
    },
  });
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  res.json(sale);
});

salesRouter.post(
  '/',
  requireRole('OWNER', 'ADMIN', 'CASHIER'),
  asyncHandler(async (req: AuthRequest, res) => {
    const { sessionId, totalAmount, paymentMethod, items } = req.body as {
      sessionId: string;
      totalAmount?: number | string;
      paymentMethod?: string;
      items?: { productId: string; quantity: number; unitPrice?: number | string }[];
    };
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId required' });
      return;
    }
    const session = await prisma.dailySession.findUnique({ where: { id: sessionId } });
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.status === 'CLOSED') {
      res.status(400).json({ error: 'Session is closed' });
      return;
    }

    let total = decimalToNum(totalAmount);
    const rawItems = Array.isArray(items) ? items : [];
    const saleItems = rawItems
      .filter((i) => i?.productId)
      .map((i) => {
        const qty =
          typeof i.quantity === 'number' ? i.quantity : parseInt(String(i.quantity ?? 0), 10);
        const up = i.unitPrice != null ? decimalToNum(i.unitPrice) : undefined;
        return { productId: String(i.productId), quantity: qty, unitPrice: up };
      })
      .filter((i) => Number.isFinite(i.quantity) && i.quantity > 0);

    let itemsWithPrice: { productId: string; quantity: number; unitPrice: number; subtotal: number }[] = [];
    if (saleItems.length > 0) {
      const productIds = saleItems.map((s) => s.productId);
      const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
      const productMap = new Map(products.map((p) => [p.id, p]));
      itemsWithPrice = saleItems.map((s) => {
        const p = productMap.get(s.productId);
        const unitPrice = s.unitPrice ?? (p ? Number(p.basePrice) : 0);
        const subtotal = unitPrice * s.quantity;
        return { ...s, unitPrice, subtotal };
      });
      if (total <= 0) total = itemsWithPrice.reduce((sum, i) => sum + i.subtotal, 0);
    }

    if (total <= 0 || !Number.isFinite(total)) {
      res.status(400).json({ error: 'totalAmount required (enter a positive total in BRR)' });
      return;
    }

    const pm = parsePaymentMethod(paymentMethod);

    const sale = await prisma.sale.create({
      data: {
        sessionId,
        userId: req.user!.id,
        totalAmount: moneyDecimal(total),
        paymentMethod: pm,
        items:
          itemsWithPrice.length > 0
            ? {
                create: itemsWithPrice.map((i) => ({
                  productId: i.productId,
                  quantity: Math.floor(i.quantity),
                  unitPrice: moneyDecimal(i.unitPrice),
                  subtotal: moneyDecimal(i.subtotal),
                })),
              }
            : undefined,
      },
      include: {
        session: true,
        user: { select: { id: true, fullName: true } },
        items: { include: { product: true } },
      },
    });
    res.status(201).json(sale);
  })
);
