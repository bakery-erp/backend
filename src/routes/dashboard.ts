import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js';

export const dashboardRouter = Router();
dashboardRouter.use(authMiddleware);

/**
 * GET /api/dashboard
 * Summary stats: open sessions, today's sales, unpaid deliveries, out-of-stock. OWNER/ADMIN only (confidential).
 */
dashboardRouter.get('/', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const sessionWhere = branchId ? { branchId, status: 'OPEN' as const } : { status: 'OPEN' as const };
  const [openSessionsCount, todaySalesAgg, unpaidDeliveriesAgg, outOfStockCount] = await Promise.all([
    prisma.dailySession.count({ where: sessionWhere }),
    prisma.sale.aggregate({
      where: {
        createdAt: { gte: todayStart, lt: todayEnd },
        ...(branchId ? { session: { branchId } } : {}),
      },
      _sum: { totalAmount: true },
    }),
    prisma.supplierDelivery.aggregate({
      where: { isPaid: false, ...(branchId ? { supplier: { branchId } } : {}) },
      _count: { id: true },
    }),
    prisma.stockItem.count({
      where: {
        ...(branchId ? { branchId } : {}),
        currentQuantity: { lte: 0 },
      },
    }),
  ]);

  res.json({
    openSessionsCount,
    todaySalesTotal: Number(todaySalesAgg._sum.totalAmount ?? 0),
    unpaidDeliveriesCount: unpaidDeliveriesAgg._count.id,
    outOfStockCount,
  });
});
