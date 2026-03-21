import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { parseExpenseType, isValidExpenseTypeForPatch } from '../lib/expenseType.js';
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js';

function decimalToNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return 0;
}

async function validateExpenseFinancialCategory(financialCategoryId: string | null | undefined) {
  if (financialCategoryId == null || financialCategoryId === '') return null;
  const fc = await prisma.financialCategory.findUnique({ where: { id: financialCategoryId } });
  if (!fc) return 'financialCategoryId: category not found';
  if (fc.type !== 'EXPENSE') return 'financialCategoryId must reference an EXPENSE financial category';
  return null;
}

const expenseInclude = {
  user: { select: { id: true, fullName: true } as const },
  financialCategory: { select: { id: true, name: true, type: true } },
};

export const expensesRouter = Router();
expensesRouter.use(authMiddleware);

expensesRouter.get('/', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const from = req.query.from as string;
  const to = req.query.to as string;
  const category = req.query.category as string | undefined;
  if (!branchId) return res.status(400).json({ error: 'branchId required' });
  const where: Record<string, unknown> = { branchId };
  if (category) where.category = category;
  if (from || to) {
    where.date = {};
    if (from) (where.date as Record<string, Date>).gte = new Date(from);
    if (to) (where.date as Record<string, Date>).lte = new Date(to);
  }
  const list = await prisma.expense.findMany({
    where,
    include: expenseInclude,
    orderBy: { date: 'desc' },
  });
  res.json(list);
});

expensesRouter.post('/', requireRole('OWNER', 'ADMIN', 'CASHIER', 'BAKER'), async (req: AuthRequest, res) => {
  const { branchId, type, amount, category, description, date, financialCategoryId } = req.body as {
    branchId?: string;
    type?: string;
    amount: number | string;
    category: string;
    description?: string;
    date?: string;
    financialCategoryId?: string;
  };
  const bid = branchId || req.user?.branchId;
  const expenseType = parseExpenseType(type);
  if (!bid || amount == null || !category?.trim()) return res.status(400).json({ error: 'branchId, amount, category required' });
  const fcErr = await validateExpenseFinancialCategory(financialCategoryId);
  if (fcErr) return res.status(400).json({ error: fcErr });
  const d = date ? new Date(date) : new Date();
  d.setHours(0, 0, 0, 0);
  const expense = await prisma.expense.create({
    data: {
      branchId: bid,
      userId: req.user!.id,
      type: expenseType,
      financialCategoryId:
        financialCategoryId != null && String(financialCategoryId).trim() !== ''
          ? String(financialCategoryId)
          : null,
      amount: decimalToNum(amount),
      category: category.trim(),
      description: description?.trim() || null,
      date: d,
    },
    include: expenseInclude,
  });
  res.status(201).json(expense);
});

expensesRouter.get('/:id', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const expense = await prisma.expense.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { id: true, fullName: true, phone: true } },
      financialCategory: { select: { id: true, name: true, type: true } },
    },
  });
  if (!expense) return res.status(404).json({ error: 'Expense not found' });
  res.json(expense);
});

expensesRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { type, amount, category, description, date, financialCategoryId } = req.body as {
    type?: string;
    amount?: number | string;
    category?: string;
    description?: string;
    date?: string;
    financialCategoryId?: string | null;
  };
  const data: Record<string, unknown> = {};
  if (type !== undefined) {
    if (!isValidExpenseTypeForPatch(type)) {
      return res.status(400).json({ error: 'type must be COMPANY, OWNER, or legacy OPERATIONAL/PERSONAL' });
    }
    data.type = parseExpenseType(type);
  }
  if (amount != null) data.amount = decimalToNum(amount);
  if (category !== undefined) data.category = category?.trim() ?? null;
  if (description !== undefined) data.description = description?.trim() || null;
  if (date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    data.date = d;
  }
  if (financialCategoryId !== undefined) {
    const fcErr = await validateExpenseFinancialCategory(
      financialCategoryId === null || financialCategoryId === '' ? null : String(financialCategoryId)
    );
    if (fcErr) return res.status(400).json({ error: fcErr });
    data.financialCategoryId =
      financialCategoryId === null || financialCategoryId === '' ? null : String(financialCategoryId);
  }
  const expense = await prisma.expense.update({
    where: { id: req.params.id },
    data: data as any,
    include: expenseInclude,
  });
  res.json(expense);
});
