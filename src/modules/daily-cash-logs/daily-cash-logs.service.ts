import { prisma } from '../../lib/prisma.js';
import { businessDateUtcNoon, parseYmd } from '../../lib/businessDate.js';
import { decimalToNum } from '../../lib/decimal.js';
import { buildPaginatedResponse } from '../../lib/pagination.js';
import type { ServiceResult } from '../../types/service-response.js';

export class DailyCashLogsService {
  async getDailyCashLogs(params: {
    branchId?: string | null;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }): ServiceResult {
    const { branchId, from, to, page, limit } = params;
    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    const isPaginated = page != null && limit != null;
    const skip = isPaginated ? (page - 1) * limit : undefined;
    const take = isPaginated ? limit : undefined;

    const [total, list, allInRange] = await Promise.all([
      prisma.dailyCashLog.count({ where }),
      prisma.dailyCashLog.findMany({
        where,
        include: {
          branch: { select: { id: true, name: true } },
          recordedBy: { select: { id: true, fullName: true, role: true } },
        },
        orderBy: { date: 'desc' },
        ...(isPaginated ? { skip, take } : {}),
      }),
      prisma.dailyCashLog.findMany({
        where,
        select: {
          cashInDrawer: true,
          cbeTransfer: true,
          telebirr: true,
          tomorrowFloat: true,
        },
      }),
    ]);

    // Aggregate summary metrics for the filter period
    const totalCashInDrawer = allInRange.reduce((s, r) => s + decimalToNum(r.cashInDrawer), 0);
    const totalCbe = allInRange.reduce((s, r) => s + decimalToNum(r.cbeTransfer), 0);
    const totalTelebirr = allInRange.reduce((s, r) => s + decimalToNum(r.telebirr), 0);
    const totalTomorrowFloat = allInRange.reduce((s, r) => s + decimalToNum(r.tomorrowFloat), 0);
    const totalCollected = totalCashInDrawer + totalCbe + totalTelebirr;

    const summary = {
      totalCashInDrawer: Math.round(totalCashInDrawer * 100) / 100,
      totalCbe: Math.round(totalCbe * 100) / 100,
      totalTelebirr: Math.round(totalTelebirr * 100) / 100,
      totalTomorrowFloat: Math.round(totalTomorrowFloat * 100) / 100,
      totalCollected: Math.round(totalCollected * 100) / 100,
    };

    if (isPaginated) {
      const paginated = buildPaginatedResponse(list, total, page, limit);
      return { data: { ...paginated, summary } };
    }

    return { data: { data: list, total, summary } };
  }

  async getDailyCashLogById(id: string): ServiceResult {
    const log = await prisma.dailyCashLog.findUnique({
      where: { id },
      include: {
        branch: { select: { id: true, name: true } },
        recordedBy: { select: { id: true, fullName: true, role: true } },
      },
    });
    if (!log) {
      return { error: 'Daily cash log not found', status: 404 };
    }
    return { data: log };
  }

  async createOrUpsertDailyCashLog(body: any, userId: string): ServiceResult {
    const { branchId, date, cashInDrawer, cbeTransfer, telebirr, tomorrowFloat, notes } = body;
    if (!branchId || !date) {
      return { error: 'branchId and date are required', status: 400 };
    }

    const parts = parseYmd(date);
    if (!parts) {
      return { error: 'Invalid date format (YYYY-MM-DD)', status: 400 };
    }
    const d = businessDateUtcNoon(parts.y, parts.mo, parts.day);

    const cash = cashInDrawer != null && cashInDrawer !== '' ? decimalToNum(cashInDrawer) : 0;
    const cbe = cbeTransfer != null && cbeTransfer !== '' ? decimalToNum(cbeTransfer) : 0;
    const tb = telebirr != null && telebirr !== '' ? decimalToNum(telebirr) : 0;
    const floatVal = tomorrowFloat != null && tomorrowFloat !== '' ? decimalToNum(tomorrowFloat) : 0;
    const safeNotes = notes ? String(notes).trim() : null;

    const log = await prisma.dailyCashLog.upsert({
      where: {
        branchId_date: { branchId, date: d },
      },
      create: {
        branchId,
        date: d,
        cashInDrawer: cash,
        cbeTransfer: cbe,
        telebirr: tb,
        tomorrowFloat: floatVal,
        notes: safeNotes,
        recordedById: userId,
      },
      update: {
        cashInDrawer: cash,
        cbeTransfer: cbe,
        telebirr: tb,
        tomorrowFloat: floatVal,
        notes: safeNotes,
        recordedById: userId,
      },
      include: {
        branch: { select: { id: true, name: true } },
        recordedBy: { select: { id: true, fullName: true, role: true } },
      },
    });

    return { data: log };
  }

  async updateDailyCashLog(id: string, body: any): ServiceResult {
    const existing = await prisma.dailyCashLog.findUnique({ where: { id } });
    if (!existing) {
      return { error: 'Daily cash log not found', status: 404 };
    }

    const data: any = {};
    if (body.cashInDrawer !== undefined) data.cashInDrawer = decimalToNum(body.cashInDrawer);
    if (body.cbeTransfer !== undefined) data.cbeTransfer = decimalToNum(body.cbeTransfer);
    if (body.telebirr !== undefined) data.telebirr = decimalToNum(body.telebirr);
    if (body.tomorrowFloat !== undefined) data.tomorrowFloat = decimalToNum(body.tomorrowFloat);
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes).trim() : null;

    const updated = await prisma.dailyCashLog.update({
      where: { id },
      data,
      include: {
        branch: { select: { id: true, name: true } },
        recordedBy: { select: { id: true, fullName: true, role: true } },
      },
    });

    return { data: updated };
  }

  async deleteDailyCashLog(id: string): ServiceResult {
    const existing = await prisma.dailyCashLog.findUnique({ where: { id } });
    if (!existing) {
      return { error: 'Daily cash log not found', status: 404 };
    }
    await prisma.dailyCashLog.delete({ where: { id } });
    return { data: { success: true, message: 'Daily cash log deleted successfully' } };
  }
}
