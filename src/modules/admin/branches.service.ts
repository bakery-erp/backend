import { prisma } from '../../lib/prisma.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

export class BranchesService {
  async getBranches(user?: { role: string; branchId?: string | null }): ServiceResult {
    if (!user || user.role === 'OWNER') {
      const list = await prisma.branch.findMany({ orderBy: { name: 'asc' } });
      
      // Ensure the main branch always appears first
      list.sort((a, b) => {
        const aIsMain = a.name.toLowerCase().includes('main');
        const bIsMain = b.name.toLowerCase().includes('main');
        if (aIsMain && !bIsMain) return -1;
        if (!aIsMain && bIsMain) return 1;
        return 0;
      });

      return { data: list };
    }

    // ADMIN or non-OWNER roles: return ONLY their assigned branch
    if (!user.branchId) {
      return { data: [] };
    }

    const list = await prisma.branch.findMany({
      where: { id: user.branchId },
      orderBy: { name: 'asc' },
    });

    return { data: list };
  }

  async getBranchById(id: string, user?: { role: string; branchId?: string | null }): ServiceResult {
    if (user && user.role !== 'OWNER' && user.branchId !== id) {
      return { error: 'Access denied: You can only view your assigned branch', status: 403 };
    }

    const branch = await prisma.branch.findUnique({
      where: { id },
      include: { users: { select: { id: true, fullName: true, phone: true, role: true } } },
    });
    if (!branch) {
      return { error: 'Branch not found', status: 404 };
    }
    return { data: branch };
  }

  async createBranch(body: { name: string; address?: string }, companyId: string): ServiceResult {
    const { name, address } = body;
    if (!name?.trim()) {
      return { error: 'Name required', status: 400 };
    }
    const branch = await prisma.branch.create({
      data: { name: name.trim(), address: address?.trim() || null, companyId },
    });
    return { data: branch };
  }

  async updateBranch(id: string, body: { name?: string; address?: string; isActive?: boolean }): ServiceResult {
    const { name, address, isActive } = body;
    const branch = await prisma.branch.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(address !== undefined && { address: address?.trim() || null }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    return { data: branch };
  }
}
