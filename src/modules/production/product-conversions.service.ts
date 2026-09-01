import { prisma } from '../../lib/prisma.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

export class ProductConversionsService {
  async getProductConversions(
    branchId?: string | null,
    limit: number = 50,
    from?: string,
    to?: string
  ): ServiceResult {
    const where: any = branchId ? { branchId } : {};

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setUTCHours(23, 59, 59, 999);
        where.createdAt.lte = toDate;
      }
    }

    const list = await prisma.productConversion.findMany({
      where,
      include: {
        fromProduct: { select: { id: true, name: true, flavor: true, unitType: true } },
        toProduct: { select: { id: true, name: true, flavor: true, unitType: true } },
        user: { select: { id: true, fullName: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return { data: list };
  }

  async getProductConversionById(id: string): ServiceResult {
    const conversion = await prisma.productConversion.findUnique({
      where: { id },
      include: {
        fromProduct: { select: { id: true, name: true, flavor: true, unitType: true, basePrice: true } },
        toProduct: { select: { id: true, name: true, flavor: true, unitType: true, basePrice: true } },
        user: { select: { id: true, fullName: true, role: true } },
      },
    });
    if (!conversion) {
      return { error: 'Conversion not found', status: 404 };
    }
    return { data: conversion };
  }

  async createProductConversion(body: any, userId: string, userBranchId?: string | null): ServiceResult {
    const fromProductId = body?.fromProductId || body?.sourceProductId;
    const toProductId = body?.toProductId || body?.targetProductId;
    const fromQuantity = body?.fromQuantity ?? body?.sourceQuantity;
    const toQuantity = body?.toQuantity ?? body?.targetQuantity;
    const { branchId } = body || {};

    let bid = branchId || userBranchId;
    if (!bid) {
      const defaultBranch = await prisma.branch.findFirst({ where: { isActive: true } });
      bid = defaultBranch?.id || null;
    }

    if (!bid || !fromProductId || !toProductId || fromQuantity == null || toQuantity == null) {
      return {
        error: 'branchId, fromProductId, toProductId, fromQuantity, toQuantity required',
        status: 400
      };
    }

    if (fromProductId === toProductId) {
      return { error: 'Source and target products must be different', status: 400 };
    }

    // Check active session status for branch
    const activeSession = await prisma.dailySession.findFirst({
      where: {
        branchId: bid,
        status: { in: ['OPEN', 'PAUSED', 'CLOSE_PENDING', 'CLOSED'] },
      },
      orderBy: { date: 'desc' },
    });

    if (!activeSession || activeSession.status !== 'OPEN') {
      const statusLabel = activeSession ? activeSession.status : 'CLOSED';
      return {
        error: `Daily session is currently ${statusLabel}. Product conversions are disabled when a session is paused or closed.`,
        status: 400,
      };
    }

    const fromQ = typeof fromQuantity === 'number' ? fromQuantity : parseInt(String(fromQuantity), 10);
    const toQ = typeof toQuantity === 'number' ? toQuantity : parseInt(String(toQuantity), 10);

    if (!Number.isFinite(fromQ) || !Number.isFinite(toQ) || fromQ < 1 || toQ < 1 || !Number.isInteger(fromQ) || !Number.isInteger(toQ)) {
      return { error: 'Quantities must be positive whole numbers (e.g. 1 source unit = 10 target units)', status: 400 };
    }

    // Verify source and target products exist
    const [fromProduct, toProduct] = await Promise.all([
      prisma.product.findUnique({ where: { id: fromProductId } }),
      prisma.product.findUnique({ where: { id: toProductId } }),
    ]);

    if (!fromProduct) {
      return { error: `Source product not found: ${fromProductId}`, status: 404 };
    }
    if (!toProduct) {
      return { error: `Target product not found: ${toProductId}`, status: 404 };
    }

    // Validate available shop stock for fromProduct
    const [sessionBatches, sessionSales, sessionDeliveries, previousConversions] = await Promise.all([
      prisma.productionBatch.findMany({
        where: { branchId: bid, date: activeSession.date },
        include: { items: true },
      }),
      prisma.sale.findMany({
        where: { sessionId: activeSession.id },
        include: { items: true },
      }),
      prisma.supplierDelivery.findMany({
        where: { sessionId: activeSession.id },
      }),
      prisma.productConversion.findMany({
        where: { branchId: bid, createdAt: { gte: activeSession.date } },
      }),
    ]);

    let prodQty = 0;
    for (const b of sessionBatches) {
      for (const item of b.items) {
        if (item.productId === fromProductId) prodQty += item.quantityProduced;
      }
    }

    let delivQty = 0;
    for (const d of sessionDeliveries) {
      if (d.productId === fromProductId) delivQty += d.quantityReceived;
    }

    let soldQty = 0;
    for (const s of sessionSales) {
      for (const item of s.items) {
        if (item.productId === fromProductId) soldQty += item.quantity;
      }
    }

    let convertedOut = 0;
    let convertedIn = 0;
    for (const c of previousConversions) {
      if (c.fromProductId === fromProductId) convertedOut += c.fromQuantity;
      if (c.toProductId === fromProductId) convertedIn += c.toQuantity;
    }

    const maxAvailable = Math.max(0, prodQty + delivQty + convertedIn - soldQty - convertedOut);

    if (fromQ > maxAvailable) {
      return {
        error: `Source conversion quantity (${fromQ}) exceeds available shop stock (${maxAvailable} ${fromProduct.unitType}) for "${fromProduct.name}". Maximum convert allowed currently is ${maxAvailable}.`,
        status: 400,
      };
    }

    const conversion = await prisma.productConversion.create({
      data: {
        branchId: bid,
        userId,
        fromProductId,
        toProductId,
        fromQuantity: fromQ,
        toQuantity: toQ,
      },
      include: {
        fromProduct: { select: { id: true, name: true, flavor: true, unitType: true } },
        toProduct: { select: { id: true, name: true, flavor: true, unitType: true } },
        user: { select: { id: true, fullName: true, role: true } },
      },
    });
    return { data: conversion };
  }

  async updateProductConversion(id: string, body: any): ServiceResult {
    const existing = await prisma.productConversion.findUnique({ where: { id } });
    if (!existing) {
      return { error: 'Product conversion not found', status: 404 };
    }

    const fromProductId = body?.fromProductId || body?.sourceProductId || existing.fromProductId;
    const toProductId = body?.toProductId || body?.targetProductId || existing.toProductId;
    const fromQuantityRaw = body?.fromQuantity ?? body?.sourceQuantity ?? existing.fromQuantity;
    const toQuantityRaw = body?.toQuantity ?? body?.targetQuantity ?? existing.toQuantity;

    if (fromProductId === toProductId) {
      return { error: 'Source and target products must be different', status: 400 };
    }

    const fromQ = typeof fromQuantityRaw === 'number' ? fromQuantityRaw : parseInt(String(fromQuantityRaw), 10);
    const toQ = typeof toQuantityRaw === 'number' ? toQuantityRaw : parseInt(String(toQuantityRaw), 10);

    if (!Number.isFinite(fromQ) || !Number.isFinite(toQ) || fromQ < 1 || toQ < 1 || !Number.isInteger(fromQ) || !Number.isInteger(toQ)) {
      return { error: 'Quantities must be positive whole numbers', status: 400 };
    }

    const updated = await prisma.productConversion.update({
      where: { id },
      data: {
        fromProductId,
        toProductId,
        fromQuantity: fromQ,
        toQuantity: toQ,
      },
      include: {
        fromProduct: { select: { id: true, name: true, flavor: true, unitType: true } },
        toProduct: { select: { id: true, name: true, flavor: true, unitType: true } },
        user: { select: { id: true, fullName: true, role: true } },
      },
    });

    return { data: updated };
  }

  async deleteProductConversion(id: string): ServiceResult {
    try {
      await prisma.productConversion.delete({ where: { id } });
      return { data: { message: 'Conversion record deleted successfully' } };
    } catch (e) {
      return { error: 'Conversion record not found', status: 404 };
    }
  }
}

