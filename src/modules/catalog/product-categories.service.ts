import { prisma } from '../../lib/prisma.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

export class ProductCategoriesService {
  async getCategories(tree?: boolean): ServiceResult {
    const list = await prisma.productCategory.findMany({
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
      return { data: roots };
    }

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

  async createCategory(body: { name: string; type: string; parentId?: string | null }): ServiceResult {
    const { name, type, parentId } = body;
    if (!name?.trim() || !type) {
      return { error: 'name and type (PRODUCED|RESELL) required', status: 400 };
    }

    const parent = await this.resolveParentCategory(parentId);
    if (typeof parent === 'string') {
      return { error: parent, status: 400 };
    }
    if (parent && parent.type !== type) {
      return { error: 'parent category must have the same type', status: 400 };
    }

    const category = await prisma.productCategory.create({
      data: {
        name: name.trim(),
        type: type as any,
        parentId: parent ? parent.id : null,
      },
      include: {
        parent: { select: { id: true, name: true, type: true } },
        _count: { select: { products: true, children: true } },
      },
    });
    return { data: category };
  }

  async updateCategory(id: string, body: { name?: string; type?: string; parentId?: string | null }): ServiceResult {
    const existing = await prisma.productCategory.findUnique({ where: { id } });
    if (!existing) {
      return { error: 'Category not found', status: 404 };
    }

    const { name, type, parentId } = body;
    const resolvedType = type !== undefined ? type : existing.type;
    const resolvedParentId = parentId !== undefined ? parentId : existing.parentId;

    const parent = await this.resolveParentCategory(resolvedParentId, id);
    if (typeof parent === 'string') {
      return { error: parent, status: 400 };
    }
    if (parent && parent.type !== resolvedType) {
      return { error: 'parent category must have the same type', status: 400 };
    }

    const category = await prisma.productCategory.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(type !== undefined && { type: type as any }),
        ...(parentId !== undefined && { parentId: parent ? parent.id : null }),
      },
      include: {
        parent: { select: { id: true, name: true, type: true } },
        _count: { select: { products: true, children: true } },
      },
    });
    return { data: category };
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
