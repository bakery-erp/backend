import { prisma } from '../../lib/prisma.js';
import { businessDateFromYmdString } from '../../lib/businessDate.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';
import { DailySessionsService } from '../sessions/daily-sessions.service.js';

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
    const { branchId, type, entityId, userId, totalAmount, date, items } = body;
    let bid = branchId || userBranchId;
    if (!bid && userId) {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { branchId: true } });
      if (u?.branchId) bid = u.branchId;
    }
    if (!bid) {
      const firstBranch = await prisma.branch.findFirst({ where: { isActive: true } });
      if (firstBranch) bid = firstBranch.id;
    }
    if (!bid) {
      return { error: 'branchId required', status: 400 };
    }

    if (!type || totalAmount == null) {
      return { error: 'type and totalAmount required', status: 400 };
    }
    const isCustomerLoan = type === 'CUSTOMER' || type === 'CUSTOMER_CREDIT';
    const finalType = isCustomerLoan ? 'CUSTOMER' : 'EMPLOYEE';

    let activeSessionDate: Date | undefined;
    let availMap = new Map<string, any>();

    if (isCustomerLoan) {
      const dailySessionsService = new DailySessionsService();
      const activeSession = await prisma.dailySession.findFirst({
        where: { branchId: bid, status: { in: ['OPEN', 'PAUSED'] } },
        orderBy: { date: 'desc' },
      });

      if (!activeSession) {
        return {
          error: 'Cannot issue customer credit: No active daily session is open for this branch. Please start or open a daily session first.',
          status: 400,
        };
      }
      activeSessionDate = activeSession.date;

      if (Array.isArray(items) && items.length > 0) {
        const availResult = await dailySessionsService.getInShopAvailableProducts(bid);
        if (availResult.error) {
          return { error: availResult.error, status: availResult.status || 400 };
        }
        const availProducts: any[] = availResult.data?.products || [];
        availMap = new Map<string, any>(availProducts.map((p) => [p.id, p]));

        for (const it of items) {
          const pid = it.productId;
          const requestedQty = typeof it.quantity === 'number' ? it.quantity : parseFloat(String(it.quantity || '0'));
          if (requestedQty <= 0) {
            return { error: 'Quantity must be greater than zero for all credit items', status: 400 };
          }
          const prodInfo = availMap.get(pid);
          if (!prodInfo) {
            return { error: `Product not found or inactive for ID: ${pid}`, status: 400 };
          }
          if (requestedQty > prodInfo.availableStock) {
            return {
              error: `Cannot lend ${requestedQty} ${prodInfo.unitType} of "${prodInfo.name}". Only ${prodInfo.availableStock} ${prodInfo.unitType} currently available in the shop for this session.`,
              status: 400,
            };
          }
        }
      }
    }

    let customerIdentifier = entityId;
    if (isCustomerLoan && !customerIdentifier && body.customerName) {
      const namePart = body.customerName.trim();
      const phonePart = body.customerPhone ? ` (${body.customerPhone.trim()})` : '';
      let prodSummary = '';
      if (Array.isArray(items) && items.length > 0) {
        const itemStrs = items.map((it: any) => {
          const pName = availMap.get(it.productId)?.name || it.productName || 'Product';
          const uPrice = it.unitPrice != null ? Number(it.unitPrice) : (availMap.get(it.productId)?.basePrice || 0);
          const total = (Number(it.quantity) * uPrice).toFixed(2);
          return `${it.quantity}x ${pName} @ ${uPrice} ETB (${total} ETB)`;
        });
        prodSummary = ` - [Products: ${itemStrs.join(', ')}]`;
      }
      const jsonMeta = Array.isArray(items) && items.length > 0
        ? ` [CreditItems:${JSON.stringify(items.map((it: any) => ({
            productId: it.productId,
            productName: availMap.get(it.productId)?.name || it.productName || 'Product',
            quantity: Number(it.quantity),
            unitPrice: it.unitPrice != null ? Number(it.unitPrice) : (availMap.get(it.productId)?.basePrice || 0),
          })))}]`
        : '';
      const notesPart = body.notes ? ` - ${body.notes.trim()}` : '';
      customerIdentifier = `${namePart}${phonePart}${prodSummary}${jsonMeta}${notesPart}`;
    }

    if (isCustomerLoan && !customerIdentifier?.trim()) {
      return { error: 'Customer name / entityId required for customer credit', status: 400 };
    }
    if (!isCustomerLoan && !userId) {
      return { error: 'userId required for employee loan or salary advance', status: 400 };
    }

    const amount = decimalToNum(totalAmount);
    const initialStatus = isCustomerLoan ? 'OPEN' : 'PENDING_APPROVAL';
    const loanDate = date ? businessDateFromYmdString(date) : (activeSessionDate ?? undefined);

    const loan = await prisma.loan.create({
      data: {
        branchId: bid,
        type: finalType as any,
        entityId: isCustomerLoan ? customerIdentifier?.trim() : null,
        userId: !isCustomerLoan ? userId ?? undefined : null,
        totalAmount: amount,
        remainingBalance: amount,
        date: loanDate ?? undefined,
        status: initialStatus,
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

  async approveLoan(id: string, userId: string): ServiceResult {
    const loan = await prisma.loan.findUnique({ where: { id } });
    if (!loan) return { error: 'Loan not found', status: 404 };
    if (loan.userId !== userId) return { error: 'Unauthorized to approve this loan', status: 403 };

    const updated = await prisma.loan.update({
      where: { id },
      data: { status: 'OPEN' },
      include: { user: { select: { id: true, fullName: true, phone: true } }, payments: true },
    });
    return { data: updated };
  }

  async rejectLoan(id: string, userId: string): ServiceResult {
    const loan = await prisma.loan.findUnique({ where: { id } });
    if (!loan) return { error: 'Loan not found', status: 404 };
    if (loan.userId !== userId) return { error: 'Unauthorized to reject this loan', status: 403 };

    const updated = await prisma.loan.update({
      where: { id },
      data: { status: 'REJECTED' },
      include: { user: { select: { id: true, fullName: true, phone: true } }, payments: true },
    });
    return { data: updated };
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
