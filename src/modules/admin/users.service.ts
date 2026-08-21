import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

const userSelect = {
  id: true,
  fullName: true,
  phone: true,
  role: true,
  branchId: true,
  isActive: true,
  createdAt: true,
  salary: true,
  startDate: true,
  lastPaidDate: true,
  shift: true,
  filesUrl: true,
} as const;

function toDecimal(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

export class UsersService {
  async getUsers(branchId?: string): ServiceResult {
    const where = branchId ? { branchId } : {};
    const list = await prisma.user.findMany({
      where,
      select: { ...userSelect, branch: { select: { name: true } } },
      orderBy: { fullName: 'asc' },
    });
    return { data: list };
  }

  async getUserById(id: string): ServiceResult {
    const user = await prisma.user.findUnique({
      where: { id },
      select: { ...userSelect, branch: true },
    });
    if (!user) {
      return { error: 'User not found', status: 404 };
    }
    return { data: user };
  }

  async getEmployeeDashboard(userId: string): ServiceResult {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { ...userSelect, branch: { select: { id: true, name: true } } },
    });
    if (!user) {
      return { error: 'User not found', status: 404 };
    }

    const [payrollRecords, loans, penalties] = await Promise.all([
      prisma.payrollRecord.findMany({
        where: { userId },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      }),
      prisma.loan.findMany({
        where: { userId },
        include: { payments: { orderBy: { createdAt: 'desc' } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.penalty.findMany({
        where: { userId },
        orderBy: { date: 'desc' },
      }),
    ]);

    return {
      data: {
        user,
        payrollRecords,
        loans,
        penalties,
      },
    };
  }

  async createUser(body: any, fileUrl?: string): ServiceResult {
    const {
      fullName,
      phone,
      password,
      role,
      branchId,
      salary,
      startDate,
      lastPaidDate,
      shift,
      filesUrl: bodyFilesUrl,
    } = body;

    const finalFilesUrl = fileUrl || bodyFilesUrl;
    const phoneTrim = phone?.trim();

    if (!fullName?.trim() || !phoneTrim || !password) {
      return { error: 'fullName, phone, password required', status: 400 };
    }

    const existing = await prisma.user.findUnique({ where: { phone: phoneTrim } });
    if (existing) {
      return { error: 'Phone already exists', status: 400 };
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const salaryNum = toDecimal(salary);

    const user = await prisma.user.create({
      data: {
        fullName: fullName.trim(),
        phone: phoneTrim,
        passwordHash,
        role: role as any,
        branchId: branchId || null,
        salary: salaryNum ?? undefined,
        startDate: startDate ? new Date(startDate) : undefined,
        lastPaidDate: lastPaidDate ? new Date(lastPaidDate) : undefined,
        shift: shift === 'DAY' || shift === 'NIGHT' ? shift : undefined,
        filesUrl: finalFilesUrl?.trim() || undefined,
      },
      select: { ...userSelect, branch: { select: { name: true } } },
    });

    return { data: user };
  }

  async updateUser(id: string, body: any, fileUrl?: string): ServiceResult {
    const {
      fullName,
      phone,
      password,
      role,
      branchId,
      isActive,
      salary,
      startDate,
      lastPaidDate,
      shift,
      filesUrl: bodyFilesUrl,
    } = body;

    const finalFilesUrl = fileUrl !== undefined ? fileUrl : bodyFilesUrl;

    const data: Record<string, unknown> = {};

    if (typeof fullName === 'string') data.fullName = fullName.trim();
    if (typeof phone === 'string') data.phone = phone?.trim() || null;
    if (typeof role === 'string') data.role = role;
    if (branchId !== undefined) data.branchId = branchId || null;
    if (typeof isActive === 'boolean') data.isActive = isActive;
    if (salary !== undefined) data.salary = toDecimal(salary);
    if (startDate !== undefined) data.startDate = startDate ? new Date(startDate as string) : null;
    if (lastPaidDate !== undefined) data.lastPaidDate = lastPaidDate ? new Date(lastPaidDate as string) : null;
    if (shift === 'DAY' || shift === 'NIGHT') data.shift = shift;
    else if (shift === null || shift === '') data.shift = null;
    if (finalFilesUrl !== undefined) {
      data.filesUrl = typeof finalFilesUrl === 'string' ? finalFilesUrl.trim() || null : null;
    }

    if (typeof password === 'string' && password) {
      data.passwordHash = await bcrypt.hash(password, 10);
    }

    const user = await prisma.user.update({
      where: { id },
      data: data as any,
      select: { ...userSelect, branch: { select: { name: true } } },
    });

    return { data: user };
  }

  async changePassword(userId: string, currentPass: string, newPass: string): ServiceResult {
    if (!currentPass || !newPass) {
      return { error: 'Current password and new password are required', status: 400 };
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { error: 'User not found', status: 404 };

    const valid = await bcrypt.compare(currentPass, user.passwordHash);
    if (!valid) return { error: 'Incorrect current password', status: 400 };

    const newHash = await bcrypt.hash(newPass, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });
    return { data: { message: 'Password changed successfully' } };
  }

  async updateProfilePicture(userId: string, fileUrl: string): ServiceResult {
    if (!fileUrl) return { error: 'File is required', status: 400 };
    const user = await prisma.user.update({
      where: { id: userId },
      data: { filesUrl: fileUrl },
      select: { ...userSelect, branch: { select: { name: true } } },
    });
    return { data: user };
  }
}
