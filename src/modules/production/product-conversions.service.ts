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
    const { branchId, fromProductId, toProductId, fromQuantity, toQuantity } = body || {};
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

  async deleteProductConversion(id: string): ServiceResult {
    try {
      await prisma.productConversion.delete({ where: { id } });
      return { data: { message: 'Conversion record deleted successfully' } };
    } catch (e) {
      return { error: 'Conversion record not found', status: 404 };
    }
  }
}

