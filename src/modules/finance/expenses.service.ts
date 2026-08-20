import { prisma } from '../../lib/prisma.js';
import { parseExpenseType, isValidExpenseTypeForPatch } from '../../lib/expenseType.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

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

export class ExpensesService {
  async getExpenses(branchId?: string | null, from?: string, to?: string, category?: string): ServiceResult {
    const where: Record<string, unknown> = {};
    if (branchId) where.branchId = branchId;
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
    return { data: list };
  }

  async getExpenseById(id: string, userRole: string, userBranchId?: string | null): ServiceResult {
    const expense = await prisma.expense.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, fullName: true, phone: true } },
        financialCategory: { select: { id: true, name: true, type: true } },
      },
    });
    if (!expense) {
      return { error: 'Expense not found', status: 404 };
    }
    const admin = userRole === 'OWNER' || userRole === 'ADMIN';
    if (!admin && expense.branchId !== userBranchId) {
      return { error: 'Forbidden', status: 403 };
    }
    return { data: expense };
  }

  async createExpense(body: any, userId: string, userRole: string, userBranchId?: string | null): ServiceResult {
    const { branchId, type, amount, category, description, date, financialCategoryId } = body;
    const bid = branchId || userBranchId;
    const admin = userRole === 'OWNER' || userRole === 'ADMIN';

    if (!admin && bid && bid !== userBranchId) {
      return { error: 'Can only create expenses for your branch', status: 403 };
    }

    if (!bid || amount == null || !category?.trim()) {
      return { error: 'branchId, amount, and category required', status: 400 };
    }

    // Mandatory Open Daily Session Check
    const activeSession = await prisma.dailySession.findFirst({
      where: { branchId: bid, status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
    });

    if (!activeSession) {
      return {
        error: 'No active open daily session found for this branch. Expenses can only be recorded during an active open session.',
        status: 400,
      };
    }

    // Role-based Expense Type Enforcement (Cashiers/Non-admins only get COMPANY)
    let expenseType = parseExpenseType(type);
    if (!admin) {
      expenseType = 'COMPANY';
    }

    const fcErr = await validateExpenseFinancialCategory(financialCategoryId);
    if (fcErr) {
      return { error: fcErr, status: 400 };
    }

    let finalCategory = category.trim();
    const fCatId = financialCategoryId != null && String(financialCategoryId).trim() !== ''
      ? String(financialCategoryId)
      : null;

    if (fCatId) {
      const fc = await prisma.financialCategory.findUnique({ where: { id: fCatId } });
      if (fc) {
        finalCategory = fc.name;
      }
    }

    const d = date ? new Date(date) : new Date();
    d.setHours(0, 0, 0, 0);

    const expense = await prisma.expense.create({
      data: {
        branchId: bid,
        userId,
        type: expenseType,
        financialCategoryId: fCatId,
        sessionId: activeSession.id,
        amount: decimalToNum(amount),
        category: finalCategory,
        description: description?.trim() || null,
        date: d,
      },
      include: expenseInclude,
    });
    return { data: expense };
  }

  async updateExpense(id: string, body: any): ServiceResult {
    const { type, amount, category, description, date, financialCategoryId } = body;
    const data: Record<string, unknown> = {};

    if (type !== undefined) {
      if (!isValidExpenseTypeForPatch(type)) {
        return { error: 'type must be COMPANY, OWNER, or legacy OPERATIONAL/PERSONAL', status: 400 };
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
      if (fcErr) {
        return { error: fcErr, status: 400 };
      }
      data.financialCategoryId =
        financialCategoryId === null || financialCategoryId === '' ? null : String(financialCategoryId);
    }

    const expense = await prisma.expense.update({
      where: { id },
      data: data as any,
      include: expenseInclude,
    });
    return { data: expense };
  }

  async deleteExpense(id: string): ServiceResult {
    await prisma.expense.delete({ where: { id } });
    return { data: undefined };
  }
}
