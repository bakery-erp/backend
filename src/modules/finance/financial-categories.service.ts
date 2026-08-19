import { prisma } from '../../lib/prisma.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

export class FinancialCategoriesService {
  async getFinancialCategories(type?: string): ServiceResult {
    const where =
      type === 'REVENUE' || type === 'EXPENSE' ? { type: type as 'REVENUE' | 'EXPENSE' } : {};
    const list = await prisma.financialCategory.findMany({
      where,
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: true, expenses: true } } },
    });
    return { data: list };
  }

  async getFinancialCategoryById(id: string): ServiceResult {
    const row = await prisma.financialCategory.findUnique({
      where: { id },
      include: { _count: { select: { products: true, expenses: true } } },
    });
    if (!row) {
      return { error: 'Financial category not found', status: 404 };
    }
    return { data: row };
  }

  async createFinancialCategory(body: { name?: string; type?: string }): ServiceResult {
    const { name, type } = body;
    const t = type?.toUpperCase();

    if (!name?.trim() || (t !== 'REVENUE' && t !== 'EXPENSE')) {
      return { error: 'name and type (REVENUE|EXPENSE) required', status: 400 };
    }

    try {
      const created = await prisma.financialCategory.create({
        data: { name: name.trim(), type: t },
      });
      return { data: created };
    } catch {
      return { error: 'Category with this name and type may already exist', status: 409 };
    }
  }

  async updateFinancialCategory(id: string, body: { name?: string; type?: string }): ServiceResult {
    const { name, type } = body;
    const t = type?.toUpperCase();
    const data: { name?: string; type?: 'REVENUE' | 'EXPENSE' } = {};

    if (name !== undefined) data.name = name.trim();
    if (type !== undefined) {
      if (t !== 'REVENUE' && t !== 'EXPENSE') {
        return { error: 'type must be REVENUE or EXPENSE', status: 400 };
      }
      data.type = t;
    }

    if (Object.keys(data).length === 0) {
      return { error: 'No fields to update', status: 400 };
    }

    try {
      const updated = await prisma.financialCategory.update({
        where: { id },
        data,
      });
      return { data: updated };
    } catch {
      return { error: 'Financial category not found', status: 404 };
    }
  }

  async deleteFinancialCategory(id: string): ServiceResult {
    try {
      await prisma.financialCategory.delete({ where: { id } });
      return { data: undefined };
    } catch {
      return { error: 'Financial category not found', status: 404 };
    }
  }
}
