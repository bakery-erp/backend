import { prisma } from '../../lib/prisma.js';
import { businessDateFromYmdString } from '../../lib/businessDate.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

function decimalToNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return 0;
}

export class LoansService {
  async getMyLoans(userId?: string): ServiceResult {
    if (!userId) {
      return { error: 'Unauthorized', status: 401 };
    }
    const list = await prisma.loan.findMany({
      where: { userId },
      include: { user: { select: { id: true, fullName: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { data: list };
  }

  async getLoans(branchId?: string | null, type?: string, status?: string, from?: string, to?: string): ServiceResult {
    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (type) {
      if (type === 'EMPLOYEE' || type === 'STAFF') {
        where.type = { in: ['EMPLOYEE', 'STAFF_LOAN', 'SALARY_ADVANCE'] };
      } else {
        where.type = type;
      }
    }
    if (status) where.status = status;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = businessDateFromYmdString(from);
      if (to) where.date.lte = businessDateFromYmdString(to);
    }
    const list = await prisma.loan.findMany({
      where,
      include: { user: { select: { id: true, fullName: true, phone: true, role: true } }, payments: true },
      orderBy: { createdAt: 'desc' },
    });
    return { data: list };
  }

  async getLoanById(id: string): ServiceResult {
    const loan = await prisma.loan.findUnique({
      where: { id },
      include: { user: { select: { id: true, fullName: true, phone: true, role: true } }, payments: true },
    });
    if (!loan) {
      return { error: 'Loan not found', status: 404 };
    }
    return { data: loan };
  }

  async createLoan(body: any, userBranchId?: string | null): ServiceResult {
    const { branchId, type, entityId, userId, totalAmount, date } = body;
    let bid = branchId || userBranchId;
    if (!bid && userId) {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { branchId: true } });
      if (u?.branchId) bid = u.branchId;
    }
    if (!bid) {
      const firstBranch = await prisma.branch.findFirst();
      if (firstBranch) bid = firstBranch.id;
    }

    if (!type || totalAmount == null) {
      return { error: 'type and totalAmount required', status: 400 };
    }
    if ((type === 'EMPLOYEE' || type === 'SALARY_ADVANCE' || type === 'STAFF_LOAN') && !userId) {
      return { error: 'userId required for employee loan or salary advance', status: 400 };
    }
    if (type === 'CUSTOMER' && !entityId) {
      return { error: 'entityId (customer name/phone) required for CUSTOMER loan', status: 400 };
    }

    const amount = decimalToNum(totalAmount);
    const loan = await prisma.loan.create({
      data: {
        branchId: bid!,
        type: type as any,
        entityId: type === 'CUSTOMER' ? entityId ?? '' : null,
        userId: type !== 'CUSTOMER' ? userId ?? undefined : null,
        totalAmount: amount,
        remainingBalance: amount,
        date: date ? businessDateFromYmdString(date) ?? undefined : undefined,
        status: 'OPEN',
      },
      include: { user: { select: { id: true, fullName: true, phone: true } }, payments: true },
    });
    return { data: loan };
  }

  async payLoan(id: string, body: { amountPaid: number | string; date?: string }): ServiceResult {
    const { amountPaid, date } = body;
    if (amountPaid == null) {
      return { error: 'amountPaid required', status: 400 };
    }

    const paid = decimalToNum(amountPaid);
    const loan = await prisma.loan.findUnique({ where: { id } });
    if (!loan) {
      return { error: 'Loan not found', status: 404 };
    }

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
    return { data: updated };
  }

  async deleteLoan(id: string): ServiceResult {
    await prisma.loanPayment.deleteMany({ where: { loanId: id } });
    await prisma.loan.delete({ where: { id } });
    return { data: undefined };
  }

  async updateLoan(id: string, body: any): ServiceResult {
    const { totalAmount, remainingBalance, status, date } = body;
    const loan = await prisma.loan.findUnique({ where: { id } });
    if (!loan) {
      return { error: 'Loan not found', status: 404 };
    }

    const data: any = {};
    if (totalAmount !== undefined) data.totalAmount = decimalToNum(totalAmount);
    if (remainingBalance !== undefined) {
      const rem = decimalToNum(remainingBalance);
      data.remainingBalance = rem;
      if (status === undefined) {
        data.status = rem <= 0 ? 'PAID' : 'OPEN';
      }
    }
    if (status !== undefined) data.status = status;
    if (date !== undefined) data.date = date ? new Date(date) : loan.date;

    const updated = await prisma.loan.update({
      where: { id },
      data,
      include: { user: { select: { id: true, fullName: true, phone: true } }, payments: true },
    });
    return { data: updated };
  }
}
