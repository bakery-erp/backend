import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

export class BranchesService {
  private static branchesCache: { timestamp: number; data: any[] } | null = null;
  private static readonly CACHE_TTL_MS = 60 * 1000; // 60 seconds

  public static clearCache() {
    BranchesService.branchesCache = null;
  }

  async getBranches(user?: { role: string; branchId?: string | null }): ServiceResult {
    const isOwner = !user || user.role === 'OWNER';
    if (isOwner && BranchesService.branchesCache && (Date.now() - BranchesService.branchesCache.timestamp) < BranchesService.CACHE_TTL_MS) {
      return { data: BranchesService.branchesCache.data };
    }

    if (isOwner) {
      const list = await prisma.branch.findMany({ orderBy: { name: 'asc' } });
      
      // Ensure the main branch always appears first
      list.sort((a, b) => {
        const aIsMain = a.name.toLowerCase().includes('main');
        const bIsMain = b.name.toLowerCase().includes('main');
        if (aIsMain && !bIsMain) return -1;
        if (!aIsMain && bIsMain) return 1;
        return 0;
      });

      BranchesService.branchesCache = { timestamp: Date.now(), data: list };
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
    const trimmedName = name.trim();
    const existing = await prisma.branch.findFirst({
      where: {
        companyId,
        name: { equals: trimmedName, mode: 'insensitive' },
      },
    });
    if (existing) {
      return { error: `Branch with name "${trimmedName}" already exists`, status: 400 };
    }

    const branch = await prisma.branch.create({
      data: { name: trimmedName, address: address?.trim() || null, companyId },
    });
    BranchesService.clearCache();
    return { data: branch };
  }

  async updateBranch(id: string, body: { name?: string; address?: string; isActive?: boolean }): ServiceResult {
    const { name, address, isActive } = body;
    const current = await prisma.branch.findUnique({ where: { id } });
    if (!current) {
      return { error: 'Branch not found', status: 404 };
    }

    if (name !== undefined) {
      const trimmedName = name.trim();
      if (!trimmedName) {
        return { error: 'Name required', status: 400 };
      }
      const existing = await prisma.branch.findFirst({
        where: {
          companyId: current.companyId,
          id: { not: id },
          name: { equals: trimmedName, mode: 'insensitive' },
        },
      });
      if (existing) {
        return { error: `Branch with name "${trimmedName}" already exists`, status: 400 };
      }
    }

    const branch = await prisma.branch.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(address !== undefined && { address: address?.trim() || null }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    // When a branch is enabled or disabled, synchronize the active status of all non-owner staff assigned to this branch
    if (typeof isActive === 'boolean') {
      await prisma.user.updateMany({
        where: {
          branchId: id,
          role: { not: 'OWNER' },
        },
        data: {
          isActive: isActive,
        },
      });
    }

    BranchesService.clearCache();
    return { data: branch };
  }

  async deleteBranch(id: string, userId?: string, password?: string): ServiceResult {
    if (!password || !password.trim()) {
      return { error: 'Password is required to confirm branch deletion', status: 400 };
    }

    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { passwordHash: true },
      });
      if (!user) {
        return { error: 'User not found', status: 404 };
      }
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        return { error: 'Incorrect password. Branch deletion cancelled.', status: 403 };
      }
    }

    const branch = await prisma.branch.findUnique({ where: { id } });
    if (!branch) {
      return { error: 'Branch not found', status: 404 };
    }

    // Safety checks:
    // 1. Prevent deleting if it is the only branch remaining
    const totalBranches = await prisma.branch.count({ where: { companyId: branch.companyId } });
    if (totalBranches <= 1) {
      return { error: 'Cannot delete the only remaining branch in the system', status: 400 };
    }

    // 2. Prevent deleting if it is the Main branch
    if (branch.name.toLowerCase().includes('main')) {
      return { error: 'The Main Bakery branch cannot be deleted', status: 400 };
    }

    // Delete the branch (cascades to child operational records)
    await prisma.branch.delete({
      where: { id },
    });

    BranchesService.clearCache();
    return { data: { success: true } };
  }
}
