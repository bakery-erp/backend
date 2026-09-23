import { prisma } from '../../lib/prisma.js';
import { businessDateFromYmdString } from '../../lib/businessDate.js';
import type { ServiceResult } from '../../types/service-response.js';

function decimalToNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return 0;
}

export class CustomersService {
  async getCustomers(params: {
    companyId?: string | null;
    branchId?: string | null;
    search?: string;
  }): ServiceResult {
    const { companyId, branchId, search } = params;
    const where: any = {};
    if (companyId) where.companyId = companyId;
    if (branchId) where.branchId = branchId;
    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { fullName: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
      ];
    }

    const customers = await prisma.customer.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true } },
        credits: {
          select: {
            id: true,
            amount: true,
            paidAmount: true,
            remainingBalance: true,
            status: true,
            date: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const enriched = customers.map((c) => {
      const totalCredits = c.credits.length;
      const totalBorrowed = c.credits.reduce((sum, cr) => sum + decimalToNum(cr.amount), 0);
      const totalPaid = c.credits.reduce((sum, cr) => sum + decimalToNum(cr.paidAmount), 0);
      const totalRemaining = c.credits.reduce((sum, cr) => sum + decimalToNum(cr.remainingBalance), 0);
      const lastCreditDate = c.credits[0]?.date || null;
      return {
        ...c,
        totalCredits,
        totalBorrowed,
        totalPaid,
        totalRemaining,
        lastCreditDate,
      };
    });

    return { data: enriched };
  }

  async getCustomerById(id: string): ServiceResult {
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        branch: { select: { id: true, name: true } },
        credits: {
          include: {
            payments: { orderBy: { createdAt: 'desc' } },
            branch: { select: { id: true, name: true } },
          },
          orderBy: { date: 'desc' },
        },
      },
    });

    if (!customer) {
      return { error: 'Customer not found', status: 404 };
    }

    const totalCredits = customer.credits.length;
    const totalBorrowed = customer.credits.reduce((sum, cr) => sum + decimalToNum(cr.amount), 0);
    const totalPaid = customer.credits.reduce((sum, cr) => sum + decimalToNum(cr.paidAmount), 0);
    const totalRemaining = customer.credits.reduce((sum, cr) => sum + decimalToNum(cr.remainingBalance), 0);

    return {
      data: {
        ...customer,
        totalCredits,
        totalBorrowed,
        totalPaid,
        totalRemaining,
      },
    };
  }

  async createCustomer(body: {
    fullName: string;
    phone: string;
    address?: string | null;
    notes?: string | null;
    branchId?: string | null;
    companyId?: string | null;
  }): ServiceResult {
    const { fullName, phone, address, notes, branchId } = body;
    if (!fullName?.trim() || !phone?.trim()) {
      return { error: 'Customer full name and phone are required', status: 400 };
    }

    let targetCompanyId = body.companyId;
    if (!targetCompanyId && branchId) {
      const br = await prisma.branch.findUnique({ where: { id: branchId }, select: { companyId: true } });
      targetCompanyId = br?.companyId;
    }
    if (!targetCompanyId) {
      const firstComp = await prisma.company.findFirst();
      targetCompanyId = firstComp?.id;
    }
    if (!targetCompanyId) {
      return { error: 'Company ID required', status: 400 };
    }

    // Check if customer with same phone already exists in this company
    const existing = await prisma.customer.findFirst({
      where: {
        phone: phone.trim(),
        companyId: targetCompanyId,
      },
    });

    if (existing) {
      // Update details if provided
      const updated = await prisma.customer.update({
        where: { id: existing.id },
        data: {
          fullName: fullName.trim(),
          ...(address !== undefined && { address: address?.trim() || null }),
          ...(notes !== undefined && { notes: notes?.trim() || null }),
          ...(branchId && { branchId }),
        },
      });
      return { data: updated };
    }

    const customer = await prisma.customer.create({
      data: {
        companyId: targetCompanyId,
        branchId: branchId || null,
        fullName: fullName.trim(),
        phone: phone.trim(),
        address: address?.trim() || null,
        notes: notes?.trim() || null,
      },
    });

    return { data: customer };
  }

  async updateCustomer(id: string, body: {
    fullName?: string;
    phone?: string;
    address?: string | null;
    notes?: string | null;
    branchId?: string | null;
  }): ServiceResult {
    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) return { error: 'Customer not found', status: 404 };

    const updated = await prisma.customer.update({
      where: { id },
      data: {
        ...(body.fullName && { fullName: body.fullName.trim() }),
        ...(body.phone && { phone: body.phone.trim() }),
        ...(body.address !== undefined && { address: body.address?.trim() || null }),
        ...(body.notes !== undefined && { notes: body.notes?.trim() || null }),
        ...(body.branchId !== undefined && { branchId: body.branchId || null }),
      },
    });

    return { data: updated };
  }

  async deleteCustomer(id: string): ServiceResult {
    const unpaidCredits = await prisma.customerCredit.count({
      where: { customerId: id, remainingBalance: { gt: 0 } },
    });
    if (unpaidCredits > 0) {
      return {
        error: 'Cannot delete customer with active or unpaid credits. Settle all credits first.',
        status: 400,
      };
    }

    await prisma.customer.delete({ where: { id } });
    return { data: { success: true } };
  }

  // ---- CREDIT TRANSACTIONS ----

  async getCredits(params: {
    branchId?: string | null;
    customerId?: string | null;
    status?: string;
    search?: string;
    from?: string;
    to?: string;
  }): ServiceResult {
    const { branchId, customerId, status, search, from, to } = params;
    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (customerId) where.customerId = customerId;
    if (status && status !== 'ALL') where.status = status;
    if (search?.trim()) {
      const q = search.trim();
      where.customer = {
        OR: [
          { fullName: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
        ],
      };
    }
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = businessDateFromYmdString(from);
      if (to) where.date.lte = businessDateFromYmdString(to);
    }

    const credits = await prisma.customerCredit.findMany({
      where,
      include: {
        customer: true,
        branch: { select: { id: true, name: true } },
        payments: { orderBy: { createdAt: 'desc' } },
      },
      orderBy: { date: 'desc' },
    });

    return { data: credits };
  }

  async getCreditById(id: string): ServiceResult {
    const credit = await prisma.customerCredit.findUnique({
      where: { id },
      include: {
        customer: true,
        branch: { select: { id: true, name: true } },
        payments: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!credit) return { error: 'Credit transaction not found', status: 404 };
    return { data: credit };
  }

  async createCredit(
    body: {
      customerId?: string;
      newCustomer?: {
        fullName: string;
        phone: string;
        address?: string;
        notes?: string;
      };
      branchId?: string;
      amount: number | string;
      description?: string;
      dueDate?: string;
      date?: string;
      items?: Array<{
        productId: string;
        productName?: string;
        quantity: number;
        unitPrice: number;
      }>;
    },
    userBranchId?: string | null
  ): ServiceResult {
    const bid = body.branchId || userBranchId;
    if (!bid) return { error: 'branchId required', status: 400 };

    const amountNum = decimalToNum(body.amount);
    if (amountNum <= 0) return { error: 'Amount must be greater than zero', status: 400 };

    let targetCustomerId = body.customerId;

    // If new customer details provided or creating on-the-fly
    if (!targetCustomerId && body.newCustomer) {
      const custRes = await this.createCustomer({
        ...body.newCustomer,
        branchId: bid,
      });
      if (custRes.error || !custRes.data) {
        return { error: custRes.error || 'Failed to create customer', status: custRes.status || 400 };
      }
      targetCustomerId = (custRes.data as any).id;
    }

    if (!targetCustomerId) {
      return { error: 'Customer is required (select existing or provide new customer details)', status: 400 };
    }

    // Verify branch session
    const activeSession = await prisma.dailySession.findFirst({
      where: { branchId: bid, status: 'OPEN' },
    });
    const activeSessionDate = activeSession ? new Date(activeSession.date) : null;
    const creditDate = (body.date ? businessDateFromYmdString(body.date) : (activeSessionDate ?? new Date())) || new Date();

    // Build description from items if provided
    let desc = body.description?.trim() || '';
    if (Array.isArray(body.items) && body.items.length > 0) {
      const itemSummaries = body.items.map((it) => {
        const lineTot = (Number(it.quantity) * Number(it.unitPrice)).toFixed(2);
        return `${it.quantity}x ${it.productName || 'Item'} @ ${it.unitPrice} ETB (${lineTot} ETB)`;
      });
      const structuredItems = JSON.stringify(body.items);
      const itemsText = `[Products: ${itemSummaries.join(', ')}] [CreditItems: ${structuredItems}]`;
      desc = desc ? `${itemsText} - ${desc}` : itemsText;
    }

    const credit = await prisma.customerCredit.create({
      data: {
        customerId: targetCustomerId,
        branchId: bid,
        sessionId: activeSession?.id || null,
        amount: amountNum,
        paidAmount: 0,
        remainingBalance: amountNum,
        status: 'OPEN',
        description: desc || null,
        dueDate: body.dueDate ? businessDateFromYmdString(body.dueDate) : null,
        date: creditDate,
      },
      include: {
        customer: true,
        branch: { select: { id: true, name: true } },
        payments: true,
      },
    });

    return { data: credit };
  }

  async payCredit(
    id: string,
    body: {
      amount: number | string;
      paymentMethod?: string;
      notes?: string;
      date?: string;
    }
  ): ServiceResult {
    const payAmount = decimalToNum(body.amount);
    if (payAmount <= 0) return { error: 'Payment amount must be greater than zero', status: 400 };

    const credit = await prisma.customerCredit.findUnique({ where: { id } });
    if (!credit) return { error: 'Credit transaction not found', status: 404 };

    const remaining = decimalToNum(credit.remainingBalance) - payAmount;
    const newPaidAmount = decimalToNum(credit.paidAmount) + payAmount;
    const paymentDate = (body.date ? businessDateFromYmdString(body.date) : new Date()) || new Date();

    const payment = await prisma.customerCreditPayment.create({
      data: {
        creditId: credit.id,
        amount: payAmount,
        paymentMethod: (body.paymentMethod as any) || 'CASH',
        notes: body.notes?.trim() || null,
        date: paymentDate,
      },
    });

    const newStatus = remaining <= 0 ? 'PAID' : 'OPEN';

    const updated = await prisma.customerCredit.update({
      where: { id: credit.id },
      data: {
        paidAmount: newPaidAmount,
        remainingBalance: Math.max(0, remaining),
        status: newStatus,
      },
      include: {
        customer: true,
        branch: { select: { id: true, name: true } },
        payments: { orderBy: { createdAt: 'desc' } },
      },
    });

    return { data: { credit: updated, payment } };
  }

  async deleteCredit(id: string): Promise<ServiceResult> {
    const credit = await prisma.customerCredit.findUnique({ where: { id } });
    if (!credit) return { error: 'Credit transaction not found', status: 404 };

    await prisma.customerCreditPayment.deleteMany({ where: { creditId: id } });
    await prisma.customerCredit.delete({ where: { id } });

    return { data: { success: true } };
  }
}
