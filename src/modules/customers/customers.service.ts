import { prisma } from '../../lib/prisma.js';
import { Role } from '@prisma/client';
import { businessDateFromYmdString } from '../../lib/businessDate.js';
import { parsePagination, buildPaginatedResponse } from '../../lib/pagination.js';
import type { ServiceResult } from '../../types/service-response.js';
import { ProductsService } from '../catalog/products.service.js';
import { notificationsService } from '../notifications/notifications.service.js';

function decimalToNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const parsed = parseFloat(v);
    return isNaN(parsed) ? 0 : parsed;
  }
  if (typeof v === 'object' && v !== null) {
    if ('toNumber' in v && typeof (v as any).toNumber === 'function') {
      return (v as any).toNumber();
    }
    const parsed = parseFloat(String(v));
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

export class CustomersService {
  async getCustomers(params: {
    companyId?: string | null;
    branchId?: string | null;
    search?: string;
    page?: number;
    limit?: number;
  }): ServiceResult {
    const { companyId, branchId, search, page, limit } = params;
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

    const isPaginated = page != null && limit != null;
    const skip = isPaginated ? (page - 1) * limit : undefined;
    const take = isPaginated ? limit : undefined;

    const [total, customers] = await Promise.all([
      isPaginated ? prisma.customer.count({ where }) : Promise.resolve(0),
      prisma.customer.findMany({
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
        ...(isPaginated ? { skip, take } : {}),
      }),
    ]);

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

    if (isPaginated) {
      return { data: buildPaginatedResponse(enriched, total, page, limit) };
    }

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

    const reconciledCredits = customer.credits.map((c) => {
      const totalPaid = (c.payments || []).reduce((sum, p) => sum + decimalToNum(p.amount), 0);
      const totalAmt = decimalToNum(c.amount);
      const computedRemaining = Math.max(0, totalAmt - totalPaid);
      return {
        ...c,
        amount: totalAmt,
        paidAmount: totalPaid,
        remainingBalance: computedRemaining,
        status: computedRemaining <= 0.001 ? ('PAID' as const) : ('OPEN' as const),
      };
    });

    const totalCredits = reconciledCredits.length;
    const totalBorrowed = reconciledCredits.reduce((sum, cr) => sum + cr.amount, 0);
    const totalPaid = reconciledCredits.reduce((sum, cr) => sum + cr.paidAmount, 0);
    const totalRemaining = reconciledCredits.reduce((sum, cr) => sum + cr.remainingBalance, 0);

    return {
      data: {
        ...customer,
        credits: reconciledCredits,
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
    page?: number;
    limit?: number;
  }): ServiceResult {
    const { branchId, customerId, status, search, from, to, page, limit } = params;
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
    const dateCondition: any = {};
    if (from || to) {
      if (from) {
        const fromDate = businessDateFromYmdString(from);
        if (fromDate) dateCondition.gte = fromDate;
      }
      if (to) {
        const toDate = businessDateFromYmdString(to);
        if (toDate) dateCondition.lte = toDate;
      }
      if (Object.keys(dateCondition).length > 0) {
        where.date = dateCondition;
      }
    }

    const baseWhere: any = {};
    if (branchId) baseWhere.branchId = branchId;
    if (customerId) baseWhere.customerId = customerId;
    const baseWithDateWhere: any = { ...baseWhere };
    if (Object.keys(dateCondition).length > 0) {
      baseWithDateWhere.date = dateCondition;
    }

    const isPaginated = page != null && limit != null;
    const skip = isPaginated ? (page - 1) * limit : undefined;
    const take = isPaginated ? limit : undefined;

    const [statsAgg, countAll, countOpen, countPaid, total, credits] = await Promise.all([
      prisma.customerCredit.aggregate({
        where: baseWhere,
        _sum: {
          amount: true,
          paidAmount: true,
          remainingBalance: true,
        },
      }),
      prisma.customerCredit.count({ where: baseWithDateWhere }),
      prisma.customerCredit.count({ where: { ...baseWithDateWhere, remainingBalance: { gt: 0 } } }),
      prisma.customerCredit.count({ where: { ...baseWithDateWhere, remainingBalance: { lte: 0 } } }),
      isPaginated ? prisma.customerCredit.count({ where }) : Promise.resolve(0),
      prisma.customerCredit.findMany({
        where,
        include: {
          customer: true,
          branch: { select: { id: true, name: true } },
          payments: { orderBy: { createdAt: 'desc' } },
        },
        orderBy: { date: 'desc' },
        ...(isPaginated ? { skip, take } : {}),
      }),
    ]);

    const totalCreditGiven = decimalToNum(statsAgg._sum.amount);
    const totalOutstanding = decimalToNum(statsAgg._sum.remainingBalance);
    const totalRepaid = decimalToNum(statsAgg._sum.paidAmount);

    const stats = {
      totalCreditGiven,
      totalOutstanding,
      totalRepaid,
      counts: {
        all: countAll,
        open: countOpen,
        paid: countPaid,
      },
    };

    const reconciledCredits = credits.map((c) => {
      const totalPaid = (c.payments || []).reduce((sum, p) => sum + decimalToNum(p.amount), 0);
      const totalAmt = decimalToNum(c.amount);
      const computedRemaining = Math.max(0, totalAmt - totalPaid);
      return {
        ...c,
        paidAmount: totalPaid,
        remainingBalance: computedRemaining,
        status: computedRemaining <= 0.001 ? ('PAID' as const) : ('OPEN' as const),
      };
    });

    if (isPaginated) {
      return {
        data: {
          ...buildPaginatedResponse(reconciledCredits, total, page, limit),
          stats,
        },
      };
    }

    return { data: reconciledCredits };
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

    const totalPaid = (credit.payments || []).reduce((sum, p) => sum + decimalToNum(p.amount), 0);
    const totalAmt = decimalToNum(credit.amount);
    const computedRemaining = Math.max(0, totalAmt - totalPaid);

    return {
      data: {
        ...credit,
        paidAmount: totalPaid,
        remainingBalance: computedRemaining,
        status: computedRemaining <= 0.001 ? 'PAID' : 'OPEN',
      },
    };
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

    ProductsService.clearCache();

    notificationsService.notifyBranchRoles(
      bid,
      [Role.OWNER, Role.ADMIN],
      'CUSTOMER_CREDIT_CREATED',
      'notifications.customerCreditCreatedTitle',
      'notifications.customerCreditCreatedBody',
      {
        customerName: credit.customer?.fullName || 'Customer',
        amount: Number(credit.amount).toFixed(2),
        branchName: credit.branch?.name || '',
      },
      `/customer-credits`
    ).catch(err => console.error('[Notification] Customer credit notification error:', err));

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

    const credit = await prisma.customerCredit.findUnique({
      where: { id },
      include: { payments: true },
    });
    if (!credit) return { error: 'Credit transaction not found', status: 404 };

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

    const allPayments = [...(credit.payments || []), payment];
    const totalPaid = allPayments.reduce((sum, p) => sum + decimalToNum(p.amount), 0);
    const totalCreditAmount = decimalToNum(credit.amount);
    const remaining = Math.max(0, totalCreditAmount - totalPaid);
    const newStatus = remaining <= 0.001 ? 'PAID' : 'OPEN';

    const updated = await prisma.customerCredit.update({
      where: { id: credit.id },
      data: {
        paidAmount: totalPaid,
        remainingBalance: remaining,
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

  async updateCredit(
    id: string,
    body: {
      customerId?: string;
      amount?: number | string;
      date?: string;
      dueDate?: string | null;
      description?: string | null;
      items?: Array<{
        productId: string;
        productName?: string;
        quantity: number | string;
        unitPrice: number | string;
      }>;
    }
  ): Promise<ServiceResult> {
    const credit = await prisma.customerCredit.findUnique({
      where: { id },
      include: { payments: true },
    });
    if (!credit) return { error: 'Credit transaction not found', status: 404 };

    const totalPaid = (credit.payments || []).reduce((sum, p) => sum + decimalToNum(p.amount), 0);

    let newAmount = decimalToNum(credit.amount);
    if (body.amount !== undefined) {
      newAmount = decimalToNum(body.amount);
      if (newAmount <= 0) {
        return { error: 'Credit amount must be greater than zero', status: 400 };
      }
      if (newAmount < totalPaid) {
        return {
          error: `Credit amount (${newAmount.toFixed(2)} ETB) cannot be less than already recorded repayments (${totalPaid.toFixed(2)} ETB)`,
          status: 400,
        };
      }
    }

    if (body.customerId) {
      const customerExists = await prisma.customer.findUnique({ where: { id: body.customerId } });
      if (!customerExists) {
        return { error: 'Selected customer not found', status: 404 };
      }
    }

    const newRemaining = Math.max(0, newAmount - totalPaid);
    const newStatus = newRemaining <= 0.001 ? 'PAID' : 'OPEN';

    const updateData: any = {
      amount: newAmount,
      paidAmount: totalPaid,
      remainingBalance: newRemaining,
      status: newStatus,
    };

    if (body.customerId) updateData.customerId = body.customerId;
    if (body.date) {
      const parsedDate = businessDateFromYmdString(body.date);
      if (parsedDate) updateData.date = parsedDate;
    }
    if (body.dueDate !== undefined) {
      updateData.dueDate = body.dueDate ? businessDateFromYmdString(body.dueDate) : null;
    }

    if (Array.isArray(body.items) && body.items.length > 0) {
      const itemSummaries = body.items.map((it) => {
        const lineTot = (Number(it.quantity) * Number(it.unitPrice)).toFixed(2);
        return `${it.quantity}x ${it.productName || 'Item'} @ ${it.unitPrice} ETB (${lineTot} ETB)`;
      });
      const structuredItems = JSON.stringify(body.items);
      const itemsText = `[Products: ${itemSummaries.join(', ')}] [CreditItems: ${structuredItems}]`;
      const baseNote = body.description !== undefined ? body.description : (credit.description || '');
      const cleanDesc = (baseNote || '')
        .replace(/\[Products:\s*.*?\]/gi, '')
        .replace(/\[CreditItems:\s*\[.*?\]\s*\]/gi, '')
        .replace(/^[\s\-–—]+|[\s\-–—]+$/g, '')
        .trim();
      updateData.description = cleanDesc ? `${itemsText} - ${cleanDesc}` : itemsText;
    } else if (body.description !== undefined) {
      updateData.description = body.description?.trim() || null;
    }

    const updated = await prisma.customerCredit.update({
      where: { id },
      data: updateData,
      include: {
        customer: true,
        branch: { select: { id: true, name: true } },
        payments: { orderBy: { createdAt: 'desc' } },
      },
    });

    ProductsService.clearCache();
    return { data: updated };
  }

  async deleteCredit(id: string): Promise<ServiceResult> {
    const credit = await prisma.customerCredit.findUnique({ where: { id } });
    if (!credit) return { error: 'Credit transaction not found', status: 404 };

    await prisma.customerCreditPayment.deleteMany({ where: { creditId: id } });
    await prisma.customerCredit.delete({ where: { id } });
    ProductsService.clearCache();
    return { data: { success: true } };
  }
}
