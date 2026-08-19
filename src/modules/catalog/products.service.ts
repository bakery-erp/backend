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
    isActive?: boolean
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
    return { data: list };
  }

  async getProductById(id: string): ServiceResult {
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
    return { data: product };
  }

  async createProduct(body: Record<string, unknown>): ServiceResult {
    const { categoryId, name, flavor, unitType, basePrice, buyPrice, financialCategoryId } = body;
    
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
      },
      include: { category: true, financialCategory: true },
    });
    return { data: product };
  }

  async updateProduct(id: string, body: Record<string, unknown>): ServiceResult {
    const { categoryId, name, flavor, unitType, basePrice, buyPrice, isActive, financialCategoryId } = body;
    
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
