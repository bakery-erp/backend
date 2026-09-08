import { prisma } from '../../lib/prisma.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

function decimalToNum(v: unknown) {
  if (v == null) return undefined;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return undefined;
}

export class ProductsService {
  async getProducts(
    categoryId?: string,
    includeSubcategories?: boolean,
    search?: string,
    type?: string,
    isActive?: boolean,
    branchId?: string
  ): ServiceResult {
    let categoryIds: string[] | undefined;

    if (categoryId) {
      if (includeSubcategories) {
        const allCategories = await prisma.productCategory.findMany({
          select: { id: true, parentId: true },
        });
        const findDescendants = (parentId: string): string[] => {
          const children = allCategories.filter((c) => c.parentId === parentId);
          return [parentId, ...children.flatMap((c) => findDescendants(c.id))];
        };
        categoryIds = findDescendants(categoryId);
      } else {
        categoryIds = [categoryId];
      }
    }

    // Build type-based category filter if no explicit categoryId given
    let typeCategoryIds: string[] | undefined;
    if (type && !categoryId) {
      const cats = await prisma.productCategory.findMany({
        where: { type: type as any },
        select: { id: true },
      });
      typeCategoryIds = cats.map((c) => c.id);
    }

    const effectiveCategoryIds = categoryIds ?? typeCategoryIds;

    const where: any = {};
    if (effectiveCategoryIds) where.categoryId = { in: effectiveCategoryIds };
    if (typeof isActive === 'boolean') where.isActive = isActive;
    if (search?.trim()) {
      where.OR = [
        { name: { contains: search.trim() } },
        { flavor: { contains: search.trim() } },
      ];
    }

    const list = await prisma.product.findMany({
      where,
      include: {
        category: {
          select: {
            id: true,
            name: true,
            type: true,
            parentId: true,
            parent: { select: { id: true, name: true, type: true } },
          },
        },
        financialCategory: { select: { id: true, name: true, type: true } },
        _count: { select: { saleItems: true, productionItems: true } },
      },
      orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
    });

    const stockMap = await this.calculateHouseStockMap(branchId);

    // Compute cumulative metrics (produced, delivered, sold, damaged) for reference
    const [producedAgg, deliveredAgg, conversionsToAgg, conversionsFromAgg, salesAgg, damagedAgg] = await Promise.all([
      prisma.productionItem.groupBy({
        by: ['productId'],
        _sum: { quantityProduced: true },
        where: {
          batch: {
            status: { in: ['COMPLETED', 'STARTED'] },
            ...(branchId ? { branchId } : {}),
          },
        },
      }),
      prisma.supplierDelivery.groupBy({
        by: ['productId'],
        _sum: { quantityReceived: true, returnedQuantity: true },
        where: branchId ? { supplier: { branchId } } : {},
      }),
      prisma.productConversion.groupBy({
        by: ['toProductId'],
        _sum: { toQuantity: true },
        where: branchId ? { branchId } : {},
      }),
      prisma.productConversion.groupBy({
        by: ['fromProductId'],
        _sum: { fromQuantity: true },
        where: branchId ? { branchId } : {},
      }),
      prisma.saleItem.groupBy({
        by: ['productId'],
        _sum: { quantity: true },
        where: branchId ? { sale: { session: { branchId } } } : {},
      }),
      prisma.leftoverRecord.groupBy({
        by: ['productId'],
        _sum: { damagedQuantity: true },
        where: branchId ? { session: { branchId } } : {},
      }),
    ]);

    const producedMap = new Map(producedAgg.map(a => [a.productId, a._sum.quantityProduced || 0]));
    const deliveredMap = new Map(
      deliveredAgg.map(a => [
        a.productId,
        Math.max(0, (a._sum.quantityReceived || 0) - (a._sum.returnedQuantity || 0)),
      ])
    );
    const convToMap = new Map(conversionsToAgg.map(a => [a.toProductId, a._sum.toQuantity || 0]));
    const convFromMap = new Map(conversionsFromAgg.map(a => [a.fromProductId, a._sum.fromQuantity || 0]));
    const salesMap = new Map(salesAgg.map(a => [a.productId, a._sum.quantity || 0]));
    const damagedMap = new Map(damagedAgg.map(a => [a.productId, a._sum.damagedQuantity || 0]));

    const enrichedList = list.map((p) => {
      const totalProduced = producedMap.get(p.id) || 0;
      const totalDelivered = deliveredMap.get(p.id) || 0;
      const totalConvertedIn = convToMap.get(p.id) || 0;
      const totalSold = salesMap.get(p.id) || 0;
      const totalConvertedOut = convFromMap.get(p.id) || 0;
      const totalDamaged = damagedMap.get(p.id) || 0;
      const currentHouseStock = stockMap.get(p.id) ?? 0;

      return {
        ...p,
        currentHouseStock,
        totalProduced,
        totalDelivered,
        totalConvertedIn,
        totalConvertedOut,
        totalSold,
        totalDamaged,
      };
    });

    return { data: enrichedList };
  }

  /**
   * Calculates real-time house stock anchored to daily session leftovers:
   * 1. If latest session is CLOSED or CLOSE_PENDING:
   *    Stock IS the leftover quantity remaining recorded at session close.
   * 2. If latest session is OPEN or PAUSED:
   *    Stock = (previous closed leftover) + (produced today) + (delivered today) + (converted in) - (sold today) - (converted out) - (damaged today).
   * 3. If no session exists:
   *    Fallback to lifetime produced + delivered - sold.
   */
  private async calculateHouseStockMap(branchId?: string): Promise<Map<string, number>> {
    const stockMap = new Map<string, number>();

    const branches = branchId
      ? [{ id: branchId }]
      : await prisma.branch.findMany({ where: { isActive: true }, select: { id: true } });

    for (const b of branches) {
      const latestSession = await prisma.dailySession.findFirst({
        where: { branchId: b.id },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        include: { leftoverRecords: true },
      });

      if (!latestSession) {
        // Fallback for brand new branch with no session yet
        const [producedAgg, deliveredAgg, convToAgg, convFromAgg, salesAgg, damagedAgg] = await Promise.all([
          prisma.productionItem.groupBy({
            by: ['productId'],
            _sum: { quantityProduced: true },
            where: { batch: { branchId: b.id, status: { in: ['COMPLETED', 'STARTED'] } } },
          }),
          prisma.supplierDelivery.groupBy({
            by: ['productId'],
            _sum: { quantityReceived: true, returnedQuantity: true },
            where: { supplier: { branchId: b.id } },
          }),
          prisma.productConversion.groupBy({
            by: ['toProductId'],
            _sum: { toQuantity: true },
            where: { branchId: b.id },
          }),
          prisma.productConversion.groupBy({
            by: ['fromProductId'],
            _sum: { fromQuantity: true },
            where: { branchId: b.id },
          }),
          prisma.saleItem.groupBy({
            by: ['productId'],
            _sum: { quantity: true },
            where: { sale: { session: { branchId: b.id } } },
          }),
          prisma.leftoverRecord.groupBy({
            by: ['productId'],
            _sum: { damagedQuantity: true },
            where: { session: { branchId: b.id } },
          }),
        ]);

        const pMap = new Map(producedAgg.map(a => [a.productId, a._sum.quantityProduced || 0]));
        const dMap = new Map(deliveredAgg.map(a => [a.productId, Math.max(0, (a._sum.quantityReceived || 0) - (a._sum.returnedQuantity || 0))]));
        const toMap = new Map(convToAgg.map(a => [a.toProductId, a._sum.toQuantity || 0]));
        const fromMap = new Map(convFromAgg.map(a => [a.fromProductId, a._sum.fromQuantity || 0]));
        const sMap = new Map(salesAgg.map(a => [a.productId, a._sum.quantity || 0]));
        const damMap = new Map(damagedAgg.map(a => [a.productId, a._sum.damagedQuantity || 0]));

        const allProds = await prisma.product.findMany({ select: { id: true } });
        for (const p of allProds) {
          const qty = Math.max(
            0,
            (pMap.get(p.id) || 0) + (dMap.get(p.id) || 0) + (toMap.get(p.id) || 0) -
            (sMap.get(p.id) || 0) - (fromMap.get(p.id) || 0) - (damMap.get(p.id) || 0)
          );
          stockMap.set(p.id, (stockMap.get(p.id) || 0) + qty);
        }
      } else if (latestSession.status === 'CLOSED' || latestSession.status === 'CLOSE_PENDING') {
        // When session is CLOSED (or CLOSE_PENDING), the product count IS strictly the leftover recorded!
        for (const r of latestSession.leftoverRecords) {
          stockMap.set(r.productId, (stockMap.get(r.productId) || 0) + (r.quantityRemaining || 0));
        }
      } else {
        // Session is OPEN or PAUSED:
        // Baseline is previous closed session's leftover (or seeded leftovers)
        const prevClosed = await prisma.dailySession.findFirst({
          where: {
            branchId: b.id,
            status: 'CLOSED',
            date: { lt: latestSession.date },
          },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          include: { leftoverRecords: true },
        });

        const openingMap: Record<string, number> = {};
        if (latestSession.leftoverRecords && latestSession.leftoverRecords.length > 0) {
          for (const r of latestSession.leftoverRecords) {
            openingMap[r.productId] = r.quantityRemaining || 0;
          }
        } else if (prevClosed?.leftoverRecords) {
          for (const r of prevClosed.leftoverRecords) {
            openingMap[r.productId] = r.quantityRemaining || 0;
          }
        }

        const [actProdAgg, actDelivAgg, actConvToAgg, actConvFromAgg, actSaleAgg, actDamAgg] = await Promise.all([
          prisma.productionItem.groupBy({
            by: ['productId'],
            _sum: { quantityProduced: true },
            where: {
              batch: {
                branchId: b.id,
                status: { in: ['COMPLETED', 'STARTED'] },
                OR: [{ sessionId: latestSession.id }, { date: latestSession.date }],
              },
            },
          }),
          prisma.supplierDelivery.groupBy({
            by: ['productId'],
            _sum: { quantityReceived: true, returnedQuantity: true },
            where: {
              OR: [
                { sessionId: latestSession.id },
                { supplier: { branchId: b.id }, createdAt: { gte: latestSession.date } },
              ],
            },
          }),
          prisma.productConversion.groupBy({
            by: ['toProductId'],
            _sum: { toQuantity: true },
            where: { branchId: b.id, createdAt: { gte: latestSession.date } },
          }),
          prisma.productConversion.groupBy({
            by: ['fromProductId'],
            _sum: { fromQuantity: true },
            where: { branchId: b.id, createdAt: { gte: latestSession.date } },
          }),
          prisma.saleItem.groupBy({
            by: ['productId'],
            _sum: { quantity: true },
            where: { sale: { sessionId: latestSession.id } },
          }),
          prisma.leftoverRecord.groupBy({
            by: ['productId'],
            _sum: { damagedQuantity: true },
            where: { sessionId: latestSession.id },
          }),
        ]);

        const actProd = new Map(actProdAgg.map(a => [a.productId, a._sum.quantityProduced || 0]));
        const actDeliv = new Map(actDelivAgg.map(a => [a.productId, Math.max(0, (a._sum.quantityReceived || 0) - (a._sum.returnedQuantity || 0))]));
        const actConvTo = new Map(actConvToAgg.map(a => [a.toProductId, a._sum.toQuantity || 0]));
        const actConvFrom = new Map(actConvFromAgg.map(a => [a.fromProductId, a._sum.fromQuantity || 0]));
        const actSale = new Map(actSaleAgg.map(a => [a.productId, a._sum.quantity || 0]));
        const actDam = new Map(actDamAgg.map(a => [a.productId, a._sum.damagedQuantity || 0]));

        const allProdIds = new Set([
          ...Object.keys(openingMap),
          ...actProd.keys(),
          ...actDeliv.keys(),
          ...actConvTo.keys(),
          ...actConvFrom.keys(),
          ...actSale.keys(),
        ]);

        for (const pid of allProdIds) {
          const opening = openingMap[pid] || 0;
          const prod = actProd.get(pid) || 0;
          const deliv = actDeliv.get(pid) || 0;
          const convIn = actConvTo.get(pid) || 0;
          const sold = actSale.get(pid) || 0;
          const convOut = actConvFrom.get(pid) || 0;
          const dam = actDam.get(pid) || 0;

          const qty = Math.max(0, (opening + prod + deliv + convIn) - (sold + convOut + dam));
          stockMap.set(pid, (stockMap.get(pid) || 0) + qty);
        }
      }
    }

    return stockMap;
  }

  async getProductById(id: string, branchId?: string): ServiceResult {
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        category: {
          include: {
            parent: { select: { id: true, name: true, type: true } },
          },
        },
        financialCategory: true,
      },
    });
    if (!product) {
      return { error: 'Product not found', status: 404 };
    }

    const stockMap = await this.calculateHouseStockMap(branchId);
    const currentHouseStock = stockMap.get(id) ?? 0;

    const [producedAgg, deliveredAgg, convToAgg, convFromAgg, salesAgg, damagedAgg] = await Promise.all([
      prisma.productionItem.aggregate({
        where: {
          productId: id,
          batch: {
            status: { in: ['COMPLETED', 'STARTED'] },
            ...(branchId ? { branchId } : {}),
          },
        },
        _sum: { quantityProduced: true },
      }),
      prisma.supplierDelivery.aggregate({
        where: {
          productId: id,
          ...(branchId ? { supplier: { branchId } } : {}),
        },
        _sum: { quantityReceived: true, returnedQuantity: true },
      }),
      prisma.productConversion.aggregate({
        where: {
          toProductId: id,
          ...(branchId ? { branchId } : {}),
        },
        _sum: { toQuantity: true },
      }),
      prisma.productConversion.aggregate({
        where: {
          fromProductId: id,
          ...(branchId ? { branchId } : {}),
        },
        _sum: { fromQuantity: true },
      }),
      prisma.saleItem.aggregate({
        where: {
          productId: id,
          ...(branchId ? { sale: { session: { branchId } } } : {}),
        },
        _sum: { quantity: true },
      }),
      prisma.leftoverRecord.aggregate({
        where: {
          productId: id,
          ...(branchId ? { session: { branchId } } : {}),
        },
        _sum: { damagedQuantity: true },
      }),
    ]);

    const totalProduced = producedAgg._sum.quantityProduced || 0;
    const totalDelivered = Math.max(
      0,
      (deliveredAgg._sum.quantityReceived || 0) - (deliveredAgg._sum.returnedQuantity || 0)
    );
    const totalConvertedIn = convToAgg._sum.toQuantity || 0;
    const totalConvertedOut = convFromAgg._sum.fromQuantity || 0;
    const totalSold = salesAgg._sum.quantity || 0;
    const totalDamaged = damagedAgg._sum.damagedQuantity || 0;

    return {
      data: {
        ...product,
        currentHouseStock,
        totalProduced,
        totalDelivered,
        totalConvertedIn,
        totalConvertedOut,
        totalSold,
        totalDamaged,
      },
    };
  }

  async createProduct(body: Record<string, unknown>): ServiceResult {
    const { categoryId, name, flavor, unitType, basePrice, buyPrice, imageUrl, financialCategoryId } = body;
    
    if (!categoryId || !name || !unitType || basePrice == null) {
      return { error: 'categoryId, name, unitType, basePrice required', status: 400 };
    }

    const fcErr = await this.validateProductFinancialCategory(financialCategoryId as string | undefined);
    if (fcErr) {
      return { error: fcErr, status: 400 };
    }

    const product = await prisma.product.create({
      data: {
        categoryId: categoryId as string,
        financialCategoryId:
          financialCategoryId != null && String(financialCategoryId).trim() !== ''
            ? String(financialCategoryId)
            : null,
        name: String(name).trim(),
        flavor: flavor ? String(flavor).trim() : null,
        unitType: unitType as any,
        basePrice: decimalToNum(basePrice) ?? 0,
        buyPrice: buyPrice != null ? decimalToNum(buyPrice) ?? null : null,
        imageUrl: imageUrl ? String(imageUrl).trim() : null,
      },
      include: { category: true, financialCategory: true },
    });
    return { data: product };
  }

  async updateProduct(id: string, body: Record<string, unknown>): ServiceResult {
    const { categoryId, name, flavor, unitType, basePrice, buyPrice, imageUrl, isActive, financialCategoryId } = body;
    
    if (financialCategoryId !== undefined) {
      const fcErr = await this.validateProductFinancialCategory(
        financialCategoryId === null || financialCategoryId === '' ? null : String(financialCategoryId)
      );
      if (fcErr) {
        return { error: fcErr, status: 400 };
      }
    }

    const data: Record<string, unknown> = {};
    if (categoryId != null) data.categoryId = categoryId;
    if (name != null) data.name = String(name).trim();
    if (flavor !== undefined) data.flavor = flavor ? String(flavor).trim() : null;
    if (unitType != null) data.unitType = unitType;
    if (basePrice != null) data.basePrice = decimalToNum(basePrice);
    if (buyPrice !== undefined) data.buyPrice = buyPrice != null ? decimalToNum(buyPrice) : null;
    if (imageUrl !== undefined) data.imageUrl = imageUrl ? String(imageUrl).trim() : null;
    if (typeof isActive === 'boolean') data.isActive = isActive;
    if (financialCategoryId !== undefined) {
      data.financialCategoryId =
        financialCategoryId === null || financialCategoryId === '' ? null : String(financialCategoryId);
    }

    const product = await prisma.product.update({
      where: { id },
      data: data as any,
      include: { category: true, financialCategory: true },
    });
    return { data: product };
  }

  async deleteProduct(id: string): ServiceResult {
    const product = await prisma.product.findUnique({
      where: { id },
      include: { _count: { select: { saleItems: true, productionItems: true, leftoverRecords: true, supplierDeliveries: true } } },
    });
    if (!product) return { error: 'Product not found', status: 404 };

    const usageCount =
      product._count.saleItems +
      product._count.productionItems +
      product._count.leftoverRecords +
      product._count.supplierDeliveries;

    if (usageCount > 0) {
      // Soft-delete: mark inactive instead of hard delete
      await prisma.product.update({ where: { id }, data: { isActive: false } });
      return { data: { message: 'Product deactivated (has existing records; hard delete blocked)', deactivated: true } };
    }

    await prisma.product.delete({ where: { id } });
    return { data: { message: 'Product deleted successfully', deactivated: false } };
  }

  private async validateProductFinancialCategory(financialCategoryId: string | null | undefined): Promise<string | null> {
    if (financialCategoryId == null || financialCategoryId === '') return null;
    const fc = await prisma.financialCategory.findUnique({ where: { id: financialCategoryId } });
    if (!fc) return 'financialCategoryId: category not found';
    if (fc.type !== 'REVENUE') return 'financialCategoryId must reference a REVENUE financial category';
    return null;
  }
}
