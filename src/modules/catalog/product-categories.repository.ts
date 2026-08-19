import { prisma } from '../../lib/prisma.js';
import type { CategoryType } from '@prisma/client';

export class ProductCategoriesRepository {
  async findMany() {
    return prisma.productCategory.findMany({
      orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
      include: {
        parent: { select: { id: true, name: true, type: true } },
        _count: { select: { products: true, children: true } },
      },
    });
  }

  async findById(id: string) {
    return prisma.productCategory.findUnique({
      where: { id },
      include: {
        parent: { select: { id: true, name: true, type: true } },
        children: { include: { _count: { select: { products: true } } }, orderBy: { name: 'asc' } },
        products: true,
      },
    });
  }

  async findByIdWithCount(id: string) {
    return prisma.productCategory.findUnique({
      where: { id },
      include: { _count: { select: { products: true, children: true } } },
    });
  }

  async create(data: { name: string; type: CategoryType; parentId?: string | null }) {
    return prisma.productCategory.create({
      data: {
        name: data.name,
        type: data.type,
        parentId: data.parentId ?? null,
      },
      include: {
        parent: { select: { id: true, name: true, type: true } },
        _count: { select: { products: true, children: true } },
      },
    });
  }

  async update(id: string, data: { name?: string; type?: CategoryType; parentId?: string | null }) {
    return prisma.productCategory.update({
      where: { id },
      data: {
        name: data.name,
        type: data.type,
        parentId: data.parentId,
      },
      include: {
        parent: { select: { id: true, name: true, type: true } },
        _count: { select: { products: true, children: true } },
      },
    });
  }

  async delete(id: string) {
    return prisma.productCategory.delete({ where: { id } });
  }

  async findParentById(id: string) {
    return prisma.productCategory.findUnique({
      where: { id },
      select: { id: true, type: true, parentId: true },
    });
  }
}
