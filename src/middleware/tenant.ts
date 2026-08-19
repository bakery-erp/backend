import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { type AuthRequest } from './auth.js';

/**
 * Tenant context middleware
 * Automatically adds companyId to the request context based on the user's branch
 * This enables automatic tenant isolation through the existing Branch relationships
 */
export async function tenantContext(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Skip tenant context if user is not authenticated or has no branch
    if (!req.user || !req.user.branchId) {
      return next();
    }

    // Fetch the branch with its company to get the companyId
    // Use any type to handle both pre-migration and post-migration schemas
    const branch = await prisma.branch.findUnique({
      where: { id: req.user.branchId },
      select: { companyId: true } as any,
    }) as any;

    if (branch && branch.companyId) {
      req.tenantId = branch.companyId;
    }

    next();
  } catch (error) {
    console.error('Tenant context middleware error:', error);
    return res.status(500).json({ error: 'Failed to establish tenant context' });
  }
}

/**
 * Extend the AuthRequest type to include tenantId
 */
declare module 'express' {
  interface Request {
    tenantId?: string;
  }
}
