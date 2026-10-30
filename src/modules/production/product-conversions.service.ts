import { prisma } from '../../lib/prisma.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';
import { ProductsService } from '../catalog/products.service.js';

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

    // Optional active session lookup (conversions are no longer blocked if session is closed)
    const activeSession = await prisma.dailySession.findFirst({
      where: { branchId: bid },
      orderBy: { date: 'desc' },
    });

    const targetDate = activeSession ? activeSession.date : new Date();

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

    // Validate live shop stock for fromProduct
    const productsService = new ProductsService();
    const stockMap = await productsService.calculateHouseStockMap(bid);
    const currentStock = stockMap.get(fromProductId) ?? 0;

    if (currentStock <= 0) {
      return {
        error: `Cannot convert: No units of "${fromProduct.name}" are currently available in the shop (0 ${fromProduct.unitType} in stock). Products cannot be converted without available pieces in the shop.`,
        status: 400,
      };
    }

    if (fromQ > currentStock) {
      return {
        error: `Source conversion quantity (${fromQ}) exceeds current available shop stock (${currentStock} ${fromProduct.unitType}) for "${fromProduct.name}". Maximum convertible currently is ${currentStock}.`,
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

    ProductsService.clearCache();
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

    // Check available stock (restoring existing fromQuantity if fromProductId is unchanged)
    const productsService = new ProductsService();
    const stockMap = await productsService.calculateHouseStockMap(existing.branchId);
    let currentStock = stockMap.get(fromProductId) ?? 0;
    if (existing.fromProductId === fromProductId) {
      currentStock += existing.fromQuantity;
    }

    if (currentStock <= 0) {
      return {
        error: `Cannot convert: No units currently available in the shop for this product.`,
        status: 400,
      };
    }

    if (fromQ > currentStock) {
      return {
        error: `Source conversion quantity (${fromQ}) exceeds current available shop stock (${currentStock}).`,
        status: 400,
      };
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

    ProductsService.clearCache();
    return { data: updated };
  }

  async deleteProductConversion(id: string): ServiceResult {
    try {
      await prisma.productConversion.delete({ where: { id } });
      ProductsService.clearCache();
      return { data: { message: 'Conversion record deleted successfully' } };
    } catch (e) {
      return { error: 'Conversion record not found', status: 404 };
    }
  }
}

