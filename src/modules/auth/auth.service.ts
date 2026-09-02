import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../lib/prisma.js';
import { toAuthUserDto } from '../../lib/authUser.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';

export class AuthService {
  async changePassword(userId: string, body: { currentPassword?: string; newPassword?: string }): ServiceResult {
    const { currentPassword, newPassword } = body;
    
    if (!currentPassword || !newPassword) {
      return { error: 'Current password and new password are required', status: 400 };
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return { error: 'User not found', status: 404 };
    }

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      return { error: 'Incorrect current password', status: 401 };
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    return { data: { message: 'Password updated successfully' } };
  }

  async login(body: { phone?: string; password?: string }): ServiceResult {
    const { phone, password } = body;
    const phoneTrim = phone?.trim();

    if (!phoneTrim || !password) {
      return { error: 'Phone and password required', status: 400 };
    }

    const user = await prisma.user.findFirst({
      where: { phone: phoneTrim, isActive: true },
      include: { branch: { select: { id: true, name: true, isActive: true } } },
    });

    if (!user) {
      return { error: 'Invalid credentials', status: 401 };
    }

    if (user.branch && !user.branch.isActive) {
      return {
        error: 'Log in denied: Your assigned branch is currently inactive.',
        status: 403,
      };
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return { error: 'Invalid credentials', status: 401 };
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return {
      data: {
        token,
        user: toAuthUserDto(user),
      },
    };
  }

  async getCurrentUser(userId: string): ServiceResult {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        phone: true,
        role: true,
        branchId: true,
        branch: { select: { id: true, name: true } },
        filesUrl: true,
        shift: true,
        salary: true,
        startDate: true,
        isActive: true,
      },
    });

    if (!user) {
      return { error: 'User not found', status: 404 };
    }

    return { data: toAuthUserDto(user) };
  }

  /**
   * Public endpoint method: allows an employee to request a password reset by providing their phone number.
   */
  async requestPasswordReset(body: { phone?: string }): ServiceResult {
    const phoneTrim = body.phone?.trim();
    if (!phoneTrim) {
      return { error: 'Phone number is required', status: 400 };
    }

    const user = await prisma.user.findFirst({
      where: { phone: phoneTrim, isActive: true },
    });

    if (!user) {
      // Return success response to prevent phone number enumeration
      return {
        data: {
          message: 'Password reset request submitted. If your account exists and is active, your Manager/Admin can generate your new password.',
        },
      };
    }

    // Check if there is already a PENDING request for this user
    const existingPending = await prisma.passwordResetRequest.findFirst({
      where: { userId: user.id, status: 'PENDING' },
    });

    if (!existingPending) {
      await prisma.passwordResetRequest.create({
        data: {
          userId: user.id,
          phone: phoneTrim,
          status: 'PENDING',
        },
      });
    }

    return {
      data: {
        message: `Password reset request submitted for ${user.fullName}. Please notify your Manager or Admin to receive your new password.`,
      },
    };
  }

  /**
   * OWNER/ADMIN only: Get list of password reset requests.
   */
  async getPasswordResetRequests(adminUserId: string): ServiceResult {
    const admin = await prisma.user.findUnique({ where: { id: adminUserId } });
    if (!admin || (admin.role !== 'OWNER' && admin.role !== 'ADMIN')) {
      return { error: 'Access denied: Requires OWNER or ADMIN role', status: 403 };
    }

    const requests = await prisma.passwordResetRequest.findMany({
      orderBy: { requestedAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            phone: true,
            role: true,
            branch: { select: { id: true, name: true } },
          },
        },
      },
    });

    return { data: requests };
  }

  /**
   * OWNER/ADMIN only: Generate a new password for a specific employee or resolve a reset request.
   */
  async adminResetEmployeePassword(
    adminUserId: string,
    body: { targetUserId?: string; customPassword?: string; requestId?: string }
  ): ServiceResult {
    const admin = await prisma.user.findUnique({ where: { id: adminUserId } });
    if (!admin || (admin.role !== 'OWNER' && admin.role !== 'ADMIN')) {
      return { error: 'Access denied: Requires OWNER or ADMIN role', status: 403 };
    }

    let targetUserId = body.targetUserId?.trim();
    let requestId = body.requestId?.trim();

    if (requestId) {
      const resetReq = await prisma.passwordResetRequest.findUnique({ where: { id: requestId } });
      if (resetReq) {
        targetUserId = resetReq.userId;
      }
    }

    if (!targetUserId) {
      return { error: 'Target employee ID or valid request ID is required', status: 400 };
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      include: { branch: { select: { id: true, name: true } } },
    });

    if (!targetUser) {
      return { error: 'Target employee user not found', status: 404 };
    }

    // Generate readable random password if customPassword not provided
    let newPassword = body.customPassword?.trim();
    if (!newPassword) {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
      let code = '';
      for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      const digits = Math.floor(1000 + Math.random() * 9000);
      newPassword = `Bakery#${code}${digits}`;
    }

    if (newPassword.length < 6) {
      return { error: 'New password must be at least 6 characters long', status: 400 };
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.$transaction(async (tx) => {
      // Update user password
      await tx.user.update({
        where: { id: targetUserId },
        data: { passwordHash },
      });

      // Resolve pending reset requests for this user
      await tx.passwordResetRequest.updateMany({
        where: { userId: targetUserId, status: 'PENDING' },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          resolvedByUserId: adminUserId,
        },
      });
    });

    return {
      data: {
        message: `New password generated successfully for ${targetUser.fullName}.`,
        tempPassword: newPassword,
        employee: {
          id: targetUser.id,
          fullName: targetUser.fullName,
          phone: targetUser.phone,
          role: targetUser.role,
          branchName: targetUser.branch?.name ?? 'All Branches',
        },
      },
    };
  }

  /**
   * OWNER/ADMIN only: Reject a password reset request.
   */
  async rejectPasswordResetRequest(adminUserId: string, requestId: string): ServiceResult {
    const admin = await prisma.user.findUnique({ where: { id: adminUserId } });
    if (!admin || (admin.role !== 'OWNER' && admin.role !== 'ADMIN')) {
      return { error: 'Access denied: Requires OWNER or ADMIN role', status: 403 };
    }

    const resetReq = await prisma.passwordResetRequest.findUnique({ where: { id: requestId } });
    if (!resetReq) {
      return { error: 'Password reset request not found', status: 404 };
    }

    await prisma.passwordResetRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        resolvedAt: new Date(),
        resolvedByUserId: adminUserId,
      },
    });

    return { data: { message: 'Password reset request rejected successfully' } };
  }
}
