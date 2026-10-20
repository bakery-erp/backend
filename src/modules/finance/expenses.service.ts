import { prisma } from '../../lib/prisma.js';
import { parseExpenseType, isValidExpenseTypeForPatch } from '../../lib/expenseType.js';
import { buildPaginatedResponse } from '../../lib/pagination.js';
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

function parseLocalDate(dateInput?: string | Date | null): Date {
  if (!dateInput) {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0));
  }
  if (typeof dateInput === 'string' && dateInput.includes('-')) {
    const parts = dateInput.slice(0, 10).split('-').map(Number);
    if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
    }
  }
  const d = new Date(dateInput);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0));
}

const expenseInclude = {
  user: { select: { id: true, fullName: true } as const },
  financialCategory: { select: { id: true, name: true, type: true } },
};

export class ExpensesService {
  async getExpenses(
    branchId?: string | null,
    from?: string,
    to?: string,
    category?: string,
    type?: string,
    page: number = 1,
    limit: number = 20,
    search?: string
  ): ServiceResult {
    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (category) where.category = category;
    if (type && type !== 'ALL') {
      where.type = parseExpenseType(type);
    }
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setUTCHours(23, 59, 59, 999);
        where.date.lte = toDate;
      }
    }
    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { description: { contains: q, mode: 'insensitive' } },
        { category: { contains: q, mode: 'insensitive' } },
        { user: { fullName: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const skip = (page - 1) * limit;

    const [total, list, statsAggregate, byTypeGroups] = await Promise.all([
      prisma.expense.count({ where }),
      prisma.expense.findMany({
        where,
        include: expenseInclude,
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
      prisma.expense.aggregate({
        where,
        _sum: { amount: true },
        _count: true,
      }),
      prisma.expense.groupBy({
        by: ['type'],
        where,
        _sum: { amount: true },
      }),
    ]);

    let companyTotal = 0;
    let ownerTotal = 0;
    for (const g of byTypeGroups) {
      const amt = Number(g._sum.amount || 0);
      if (g.type === 'COMPANY') companyTotal += amt;
      else if (g.type === 'OWNER') ownerTotal += amt;
    }

    const paginated = buildPaginatedResponse(list, total, page, limit);
    return {
      data: {
        ...paginated,
        stats: {
          totalAmount: Number(statsAggregate._sum.amount || 0),
          companyTotal,
          ownerTotal,
          count: statsAggregate._count,
        },
      },
    };
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

    // Optional Daily Session link (does not block if session is not open)
    const activeSession = await prisma.dailySession.findFirst({
      where: { branchId: bid },
      orderBy: { date: 'desc' },
    });

    // Allow selecting COMPANY or OWNER expense, default to COMPANY if not specified
    const expenseType = parseExpenseType(type) || 'COMPANY';

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

    const d = parseLocalDate(date);

    const expense = await prisma.expense.create({
      data: {
        branchId: bid,
        userId,
        type: expenseType,
        financialCategoryId: fCatId,
        sessionId: activeSession?.id || null,
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
      data.date = parseLocalDate(date);
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
