import { prisma } from '../../lib/prisma.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

export class ProductCategoriesService {
  private static categoriesCache = new Map<string, { timestamp: number; data: any }>();
  private static readonly CACHE_TTL_MS = 60 * 1000; // 60 seconds

  public static clearCache() {
    ProductCategoriesService.categoriesCache.clear();
  }

  async getCategories(tree?: boolean, role?: string): ServiceResult {
    const cacheKey = `${tree ? '1' : '0'}_${role || 'ALL'}`;
    const cached = ProductCategoriesService.categoriesCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < ProductCategoriesService.CACHE_TTL_MS) {
      return { data: cached.data };
    }

    const where: any = {};
    if (role && role !== 'OWNER' && role !== 'ADMIN') {
      where.OR = [
        { productionRole: role as any },
        { productionRole: null },
      ];
    }

    const list = await prisma.productCategory.findMany({
      where,
      orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
      include: {
        parent: { select: { id: true, name: true, type: true } },
        _count: { select: { products: true, children: true } },
      },
    });

    if (tree) {
      const map = new Map<string, any>();
      for (const item of list) {
        map.set(item.id, { ...item, children: [] });
      }
      const roots: any[] = [];
      for (const item of list) {
        const mapped = map.get(item.id);
        if (item.parentId && map.has(item.parentId)) {
          map.get(item.parentId).children.push(mapped);
        } else {
          roots.push(mapped);
        }
      }
      ProductCategoriesService.categoriesCache.set(cacheKey, { timestamp: Date.now(), data: roots });
      return { data: roots };
    }

    ProductCategoriesService.categoriesCache.set(cacheKey, { timestamp: Date.now(), data: list });
    return { data: list };
  }

  async getCategoryById(id: string): ServiceResult {
    const cat = await prisma.productCategory.findUnique({
      where: { id },
      include: {
        parent: { select: { id: true, name: true, type: true } },
        children: { include: { _count: { select: { products: true } } }, orderBy: { name: 'asc' } },
        products: true,
      },
    });
    if (!cat) {
      return { error: 'Category not found', status: 404 };
    }
    return { data: cat };
  }

  async createCategory(body: { name: string; type: string; parentId?: string | null; productionRole?: any }): ServiceResult {
    const { name, type, parentId, productionRole } = body;
    if (!name?.trim() || !type) {
      return { error: 'name and type (PRODUCED|RESELL) required', status: 400 };
    }

    const trimmedName = name.trim();
    const existingName = await prisma.productCategory.findFirst({
      where: { name: { equals: trimmedName, mode: 'insensitive' } },
    });
    if (existingName) {
      return { error: `Category with name "${trimmedName}" already exists`, status: 400 };
    }

    const parent = await this.resolveParentCategory(parentId);
    if (typeof parent === 'string') {
      return { error: parent, status: 400 };
    }
    if (parent && parent.type !== type) {
      return { error: 'parent category must have the same type', status: 400 };
    }

    try {
      const category = await prisma.productCategory.create({
        data: {
          name: trimmedName,
          type: type as any,
          parentId: parent ? parent.id : null,
          productionRole: productionRole ? (productionRole as any) : null,
        },
        include: {
          parent: { select: { id: true, name: true, type: true } },
          _count: { select: { products: true, children: true } },
        },
      });
      ProductCategoriesService.clearCache();
      return { data: category };
    } catch (err: any) {
      if (err.code === 'P2002') {
        return { error: `Category with name "${trimmedName}" already exists`, status: 400 };
      }
      throw err;
    }
  }

  async updateCategory(id: string, body: { name?: string; type?: string; parentId?: string | null; productionRole?: any }): ServiceResult {
    const existing = await prisma.productCategory.findUnique({ where: { id } });
    if (!existing) {
      return { error: 'Category not found', status: 404 };
    }

    const { name, type, parentId, productionRole } = body;
    const trimmedName = name !== undefined ? name.trim() : undefined;

    if (trimmedName && trimmedName.toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = await prisma.productCategory.findFirst({
        where: {
          id: { not: id },
          name: { equals: trimmedName, mode: 'insensitive' },
        },
      });
      if (duplicate) {
        return { error: `Category with name "${trimmedName}" already exists`, status: 400 };
      }
    }

    const resolvedType = type !== undefined ? type : existing.type;
    const resolvedParentId = parentId !== undefined ? parentId : existing.parentId;

    const parent = await this.resolveParentCategory(resolvedParentId, id);
    if (typeof parent === 'string') {
      return { error: parent, status: 400 };
    }
    if (parent && parent.type !== resolvedType) {
      return { error: 'parent category must have the same type', status: 400 };
    }

    try {
      const category = await prisma.productCategory.update({
        where: { id },
        data: {
          ...(trimmedName !== undefined && { name: trimmedName }),
          ...(type !== undefined && { type: type as any }),
          ...(parentId !== undefined && { parentId: parent ? parent.id : null }),
          ...(productionRole !== undefined && { productionRole: productionRole ? (productionRole as any) : null }),
        },
        include: {
          parent: { select: { id: true, name: true, type: true } },
          _count: { select: { products: true, children: true } },
        },
      });
      ProductCategoriesService.clearCache();
      return { data: category };
    } catch (err: any) {
      if (err.code === 'P2002') {
        return { error: `Category with name "${trimmedName}" already exists`, status: 400 };
      }
      throw err;
    }
  }

  async deleteCategory(id: string): ServiceResult {
    const category = await prisma.productCategory.findUnique({
      where: { id },
      include: { _count: { select: { products: true, children: true } } },
    });
    if (!category) {
      return { error: 'Category not found', status: 404 };
    }
    if (category._count.products > 0) {
      return { error: 'Cannot delete a category that still has products', status: 400 };
    }
    if (category._count.children > 0) {
      return { error: 'Cannot delete a category that has subcategories', status: 400 };
    }
    await prisma.productCategory.delete({ where: { id } });
    ProductCategoriesService.clearCache();
    return { data: undefined };
  }

  private async resolveParentCategory(parentId: string | null | undefined, childId?: string) {
    if (parentId == null || parentId === '') return null;

    const parent = await prisma.productCategory.findUnique({
      where: { id: parentId },
      select: { id: true, type: true, parentId: true },
    });

    if (!parent) return 'parentId: category not found';
    if (childId) {
      if (parent.id === childId) return 'parentId cannot reference itself';
      let currentParent: any = parent;
      while (currentParent.parentId) {
        if (currentParent.parentId === childId) {
          return 'parentId cannot reference a category that is a descendant of this category';
        }
        currentParent = await prisma.productCategory.findUnique({
          where: { id: currentParent.parentId },
          select: { id: true, parentId: true },
        });
        if (!currentParent) break;
      }
    }

    return parent;
  }
}
