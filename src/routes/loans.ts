import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js';

function decimalToNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return 0;
}

export const loansRouter = Router();
loansRouter.use(authMiddleware);

loansRouter.get('/', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const type = req.query.type as string | undefined;
  const status = req.query.status as string | undefined;
  if (!branchId) return res.status(400).json({ error: 'branchId required' });
  const where: any = { branchId };
  if (type) where.type = type;
  if (status) where.status = status;
  const list = await prisma.loan.findMany({
    where,
    include: { user: { select: { id: true, fullName: true, phone: true, role: true } }, payments: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(list);
});

loansRouter.get('/:id', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const loan = await prisma.loan.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { id: true, fullName: true, phone: true, role: true } }, payments: true },
  });
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  res.json(loan);
});

loansRouter.post('/', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res) => {
  const { branchId, type, entityId, userId, totalAmount } = req.body as {
    branchId?: string;
    type: string;
    entityId?: string;
    userId?: string;
    totalAmount: number | string;
  };
  const bid = branchId || req.user?.branchId;
  if (!bid || !type || totalAmount == null) return res.status(400).json({ error: 'branchId, type, totalAmount required' });
  if (type === 'EMPLOYEE' && !userId) return res.status(400).json({ error: 'userId required for EMPLOYEE loan' });
  if (type === 'CUSTOMER' && !entityId) return res.status(400).json({ error: 'entityId (customer name/phone) required for CUSTOMER loan' });
  const amount = decimalToNum(totalAmount);
  const loan = await prisma.loan.create({
    data: {
      branchId: bid,
      type: type as any,
      entityId: type === 'CUSTOMER' ? entityId ?? '' : null,
      userId: type === 'EMPLOYEE' ? userId ?? undefined : null,
      totalAmount: amount,
      remainingBalance: amount,
      status: 'OPEN',
    },
    include: { user: { select: { id: true, fullName: true, phone: true } }, payments: true },
  });
  res.status(201).json(loan);
});

loansRouter.post('/:id/pay', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { amountPaid, date } = req.body as { amountPaid: number | string; date?: string };
  if (amountPaid == null) return res.status(400).json({ error: 'amountPaid required' });
  const paid = decimalToNum(amountPaid);
  const loan = await prisma.loan.findUnique({ where: { id: req.params.id } });
  if (!loan) return res.status(404).json({ error: 'Loan not found' });
  const remaining = Number(loan.remainingBalance) - paid;
  const payDate = date ? new Date(date) : new Date();
  payDate.setHours(0, 0, 0, 0);
  await prisma.loanPayment.create({
    data: { loanId: loan.id, amountPaid: paid, date: payDate },
  });
  const updated = await prisma.loan.update({
    where: { id: loan.id },
    data: {
      remainingBalance: Math.max(0, remaining),
      status: remaining <= 0 ? 'PAID' : 'OPEN',
    },
    include: { payments: true, user: { select: { id: true, fullName: true, phone: true } } },
  });
  res.json(updated);
});
