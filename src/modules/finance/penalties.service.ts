import { prisma } from '../../lib/prisma.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

function decimalToNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return 0;
}

export class PenaltiesService {
  async getMyPenalties(userId?: string): ServiceResult {
    if (!userId) {
      return { error: 'Unauthorized', status: 401 };
    }
    const list = await prisma.penalty.findMany({
      where: { userId },
      include: { user: { select: { id: true, fullName: true, phone: true } } },
      orderBy: { date: 'desc' },
    });
    return { data: list };
  }

  async getPenalties(userId?: string, isDeducted?: string): ServiceResult {
    const where: any = {};
    if (userId) where.userId = userId;
    if (isDeducted !== undefined) where.isDeducted = isDeducted === 'true';
    const list = await prisma.penalty.findMany({
      where,
      include: { user: { select: { id: true, fullName: true, phone: true, role: true } } },
      orderBy: { date: 'desc' },
    });
    return { data: list };
  }

  async createPenalty(body: any): ServiceResult {
    const { userId, amount, reason, date } = body;
    if (!userId || amount == null || !reason?.trim()) {
      return { error: 'userId, amount, reason required', status: 400 };
    }
    const d = date ? new Date(date) : new Date();
    d.setHours(0, 0, 0, 0);
    const penalty = await prisma.penalty.create({
      data: {
        userId,
        amount: decimalToNum(amount),
        reason: reason.trim(),
        date: d,
      },
      include: { user: { select: { id: true, fullName: true, phone: true } } },
    });
    return { data: penalty };
  }

  async updatePenalty(id: string, body: any): ServiceResult {
    const { isDeducted, amount, reason, date, userId } = body;
    const data: any = {};
    if (isDeducted !== undefined) data.isDeducted = Boolean(isDeducted);
    if (amount !== undefined) data.amount = decimalToNum(amount);
    if (reason !== undefined) data.reason = String(reason).trim();
    if (date !== undefined) {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      data.date = d;
    }
    if (userId !== undefined) data.userId = userId;

    const penalty = await prisma.penalty.update({
      where: { id },
      data,
      include: { user: { select: { id: true, fullName: true, phone: true } } },
    });
    return { data: penalty };
  }

  async approvePenalty(id: string, userId: string): ServiceResult {
    const penalty = await prisma.penalty.findUnique({ where: { id } });
    if (!penalty) return { error: 'Penalty not found', status: 404 };
    if (penalty.userId !== userId) return { error: 'Unauthorized to approve this penalty', status: 403 };

    const updated = await prisma.penalty.update({
      where: { id },
      data: { status: 'APPROVED' },
      include: { user: { select: { id: true, fullName: true, phone: true } } },
    });
    return { data: updated };
  }

  async rejectPenalty(id: string, userId: string): ServiceResult {
    const penalty = await prisma.penalty.findUnique({ where: { id } });
    if (!penalty) return { error: 'Penalty not found', status: 404 };
    if (penalty.userId !== userId) return { error: 'Unauthorized to reject this penalty', status: 403 };

    const updated = await prisma.penalty.update({
      where: { id },
      data: { status: 'REJECTED' },
      include: { user: { select: { id: true, fullName: true, phone: true } } },
    });
    return { data: updated };
  }
}
