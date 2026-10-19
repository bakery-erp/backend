import { prisma } from '../../lib/prisma.js';
import { Prisma } from '@prisma/client';
import { PaymentMethod } from '../../lib/paymentMethod.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

function decimalToNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') return parseFloat(v) || 0;
  return 0;
}

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

export class SalesService {
  async getSales(sessionId?: string, branchId?: string, limit: number = 50, from?: string, to?: string): ServiceResult {
    const where: Record<string, unknown> = {};
    if (sessionId) where.sessionId = sessionId;
    if (branchId) where.branchId = branchId;
    if (from || to) {
      where.date = {};
      if (from) (where.date as Record<string, Date>).gte = new Date(from);
      if (to) (where.date as Record<string, Date>).lte = new Date(to);
    }
    const list = await prisma.sale.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true } },
        session: { select: { id: true, date: true, branchId: true } },
        user: { select: { id: true, fullName: true } },
        items: { include: { product: { select: { id: true, name: true, flavor: true, unitType: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return { data: list };
  }

  async getSaleById(id: string): ServiceResult {
    const sale = await prisma.sale.findUnique({
      where: { id },
      include: {
        branch: { select: { id: true, name: true } },
        session: { select: { id: true, date: true, branchId: true, status: true } },
        user: { select: { id: true, fullName: true, phone: true } },
        items: { include: { product: true } },
      },
    });
    if (!sale) {
      return { error: 'Sale not found', status: 404 };
    }
    return { data: sale };
  }

  async createSale(body: any, userId: string): ServiceResult {
    const { sessionId, totalAmount, paymentMethod, items, branchId, date } = body;

    let targetBranchId = branchId;
    let targetSessionId = sessionId || null;
    let targetDate = date ? new Date(date) : new Date();

    if (sessionId) {
      const session = await prisma.dailySession.findUnique({ where: { id: sessionId } });
      if (session) {
        targetBranchId = session.branchId;
        targetDate = session.date;
      }
    }

    if (!targetBranchId) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      targetBranchId = user?.branchId;
    }

    if (!targetBranchId) {
      const defaultBranch = await prisma.branch.findFirst({ where: { isActive: true } });
      targetBranchId = defaultBranch?.id;
    }

    if (!targetBranchId) {
      return { error: 'branchId required to record a sale', status: 400 };
    }

    // If no sessionId was passed, try to attach today's session if one exists
    if (!targetSessionId) {
      const activeSession = await prisma.dailySession.findFirst({
        where: { branchId: targetBranchId },
        orderBy: { date: 'desc' },
      });
      targetSessionId = activeSession?.id || null;
    }

    const pm = parsePaymentMethod(paymentMethod);
    const total = totalAmount != null ? decimalToNum(totalAmount) : undefined;

    const saleItems = Array.isArray(items)
      ? items.map((i: any) => ({
          productId: i.productId,
          quantity: typeof i.quantity === 'number' ? i.quantity : parseInt(String(i.quantity), 10),
          unitPrice: moneyDecimal(decimalToNum(i.unitPrice)),
          subtotal: moneyDecimal(decimalToNum(i.unitPrice) * (typeof i.quantity === 'number' ? i.quantity : parseInt(String(i.quantity), 10))),
        }))
      : [];

    const data: any = {
      branchId: targetBranchId,
      date: targetDate,
      sessionId: targetSessionId,
      userId,
      paymentMethod: pm,
    };
    if (total != null) {
      data.totalAmount = moneyDecimal(total);
    }
    if (saleItems.length > 0) {
      data.items = { create: saleItems };
    }

    const sale = await prisma.sale.create({
      data,
      include: {
        branch: { select: { id: true, name: true } },
        session: { select: { id: true, date: true, branchId: true } },
        user: { select: { id: true, fullName: true } },
        items: { include: { product: true } },
      },
    });
    return { data: sale };
  }
}
