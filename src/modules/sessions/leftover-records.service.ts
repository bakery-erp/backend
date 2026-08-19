import { prisma } from '../../lib/prisma.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

function normalizeLeftoverRows(
  records: unknown
): { productId: string; quantityRemaining: number; damagedQuantity: number; damageReason?: string }[] | null {
  if (!Array.isArray(records)) return null;
  const map = new Map<string, { quantityRemaining: number; damagedQuantity: number; damageReason?: string }>();
  for (const r of records as { productId?: unknown; quantityRemaining?: unknown; damagedQuantity?: unknown; damageReason?: unknown }[]) {
    const pid = typeof r.productId === 'string' ? r.productId.trim() : '';
    if (!pid) continue;
    const rawRem = r.quantityRemaining;
    const qRem = typeof rawRem === 'number' ? rawRem : parseInt(String(rawRem ?? '0'), 10);
    const qtyRem = Number.isFinite(qRem) ? Math.max(0, Math.floor(qRem)) : 0;

    const rawDam = r.damagedQuantity;
    const qDam = typeof rawDam === 'number' ? rawDam : parseInt(String(rawDam ?? '0'), 10);
    const qtyDam = Number.isFinite(qDam) ? Math.max(0, Math.floor(qDam)) : 0;

    const reason = typeof r.damageReason === 'string' ? r.damageReason.trim() : undefined;

    map.set(pid, { quantityRemaining: qtyRem, damagedQuantity: qtyDam, damageReason: reason });
  }
  return Array.from(map.entries()).map(([productId, val]) => ({
    productId,
    quantityRemaining: val.quantityRemaining,
    damagedQuantity: val.damagedQuantity,
    damageReason: val.damageReason,
  }));
}

export class LeftoverRecordsService {
  async getLeftoverRecords(sessionId?: string): ServiceResult {
    if (!sessionId) {
      return { error: 'sessionId required', status: 400 };
    }
    const list = await prisma.leftoverRecord.findMany({
      where: { sessionId },
      include: { product: { select: { id: true, name: true, unitType: true, basePrice: true } } },
    });
    return { data: list };
  }

  async createLeftoverRecords(body: { sessionId: string; records: any[] }): ServiceResult {
    const { sessionId, records } = body;
    if (!sessionId) {
      return { error: 'sessionId required', status: 400 };
    }

    const normalized = normalizeLeftoverRows(records);
    if (normalized === null || normalized.length === 0) {
      return { error: 'sessionId and non-empty records array required', status: 400 };
    }

    const session = await prisma.dailySession.findUnique({ where: { id: sessionId } });
    if (!session) {
      return { error: 'Session not found', status: 404 };
    }
    if (session.status !== 'OPEN') {
      return { error: 'Session is closed; cannot add leftovers', status: 400 };
    }

    const ids = normalized.map((x) => x.productId);
    const found = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true } });
    const ok = new Set(found.map((p) => p.id));
    const missing = ids.filter((id) => !ok.has(id));
    if (missing.length) {
      return { error: `Unknown productId(s): ${missing.slice(0, 5).join(', ')}`, status: 400 };
    }

    await prisma.leftoverRecord.createMany({
      data: normalized.map((r) => ({
        sessionId,
        productId: r.productId,
        quantityRemaining: r.quantityRemaining,
        damagedQuantity: r.damagedQuantity,
        damageReason: r.damageReason,
      })),
      skipDuplicates: true,
    });

    const list = await prisma.leftoverRecord.findMany({
      where: { sessionId },
      include: { product: true },
    });
    return { data: list };
  }

  async updateLeftoverRecords(sessionId: string, body: { records: any[] }): ServiceResult {
    const normalized = normalizeLeftoverRows(body.records);
    if (normalized === null) {
      return { error: 'records must be an array', status: 400 };
    }
    if (normalized.length === 0) {
      return { error: 'records required (at least one product row)', status: 400 };
    }

    const session = await prisma.dailySession.findUnique({ where: { id: sessionId } });
    if (!session) {
      return { error: 'Session not found', status: 404 };
    }
    if (session.status !== 'OPEN') {
      return { error: 'Session is closed; cannot update leftovers', status: 400 };
    }

    const ids = normalized.map((x) => x.productId);
    const found = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true } });
    const ok = new Set(found.map((p) => p.id));
    const missing = ids.filter((id) => !ok.has(id));
    if (missing.length) {
      return { error: `Unknown productId(s): ${missing.slice(0, 5).join(', ')}`, status: 400 };
    }

    await prisma.$transaction([
      prisma.leftoverRecord.deleteMany({ where: { sessionId } }),
      prisma.leftoverRecord.createMany({
        data: normalized.map((r) => ({
          sessionId,
          productId: r.productId,
          quantityRemaining: r.quantityRemaining,
          damagedQuantity: r.damagedQuantity,
          damageReason: r.damageReason,
        })),
      }),
    ]);

    const list = await prisma.leftoverRecord.findMany({
      where: { sessionId },
      include: { product: true },
    });
    return { data: list };
  }

  async deleteLeftoverRecord(sessionId: string, productId: string): ServiceResult {
    const session = await prisma.dailySession.findUnique({ where: { id: sessionId } });
    if (!session) {
      return { error: 'Session not found', status: 404 };
    }
    if (session.status !== 'OPEN') {
      return { error: 'Session is closed; cannot delete leftovers', status: 400 };
    }
    await prisma.leftoverRecord.delete({
      where: { sessionId_productId: { sessionId, productId } },
    });
    return { data: undefined };
  }
}
