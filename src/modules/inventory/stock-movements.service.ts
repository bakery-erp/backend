import { prisma } from '../../lib/prisma.js';
import { Role } from '@prisma/client';
import { buildPaginatedResponse, parsePagination } from '../../lib/pagination.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';
import { notificationsService } from '../notifications/notifications.service.js';

function decimalToNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return 0;
}

export class StockMovementsService {
  async getStockMovements(
    branchId?: string | null,
    stockItemId?: string,
    page: number = 1,
    limit: number = 20,
    type?: string,
    from?: string,
    to?: string,
    status?: string,
    search?: string
  ): ServiceResult {
    const stockWhere = branchId ? { branchId } : {};
    const where: any = {};
    if (stockItemId) where.stockItemId = stockItemId;
    else if (branchId) where.stockItem = stockWhere;
    if (type && type !== 'ALL') where.type = type;
    if (status && status !== 'ALL') where.status = status;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setUTCHours(23, 59, 59, 999);
        where.createdAt.lte = toDate;
      }
    }
    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { stockItem: { name: { contains: q, mode: 'insensitive' } } },
        { reason: { contains: q, mode: 'insensitive' } },
        { receivedBy: { contains: q, mode: 'insensitive' } },
        { user: { fullName: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const skip = (page - 1) * limit;

    const [total, list] = await Promise.all([
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.findMany({
        where,
        include: {
          stockItem: { select: { id: true, name: true, unitType: true, currentQuantity: true, unitPrice: true } },
          user: { select: { id: true, fullName: true, role: true } },
          confirmedBy: { select: { id: true, fullName: true, role: true } },
          purchaseLoan: {
            include: {
              payments: {
                include: { user: { select: { id: true, fullName: true } } },
                orderBy: { createdAt: 'desc' },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return { data: buildPaginatedResponse(list, total, page, limit) };
  }

  async getStockMovementById(id: string): ServiceResult {
    const movement = await prisma.stockMovement.findUnique({
      where: { id },
      include: { 
        stockItem: true, 
        user: { select: { id: true, fullName: true, phone: true, role: true } },
        confirmedBy: { select: { id: true, fullName: true, role: true } },
        purchaseLoan: {
          include: {
            payments: {
              include: { user: { select: { id: true, fullName: true } } },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });
    if (!movement) {
      return { error: 'Stock movement not found', status: 404 };
    }
    return { data: movement };
  }

  async createStockMovement(body: any, userId: string): ServiceResult {
    const { stockItemId, quantity, type, reason, adjustTo, unitPrice, receivedBy, autoConfirm } = body;
    
    if (!stockItemId || quantity == null || !type) {
      return { 
        error: 'stockItemId, quantity, type (IN|OUT|ADJUSTMENT|PRODUCTION_USAGE) required', 
        status: 400 
      };
    }

    const qty = decimalToNum(quantity);
    if (!Number.isFinite(qty) || qty < 0) {
      return { error: 'Quantity must be a valid positive number', status: 400 };
    }

    const stockItem = await prisma.stockItem.findUnique({ where: { id: stockItemId } });
    if (!stockItem) {
      return { error: 'Stock item not found', status: 404 };
    }

    const current = Number(stockItem.currentQuantity);
    const itemUnitPrice = unitPrice != null ? decimalToNum(unitPrice) : Number(stockItem.unitPrice ?? 0);

    // Guard: OUT cannot bring stock below zero
    if ((type === 'OUT' || type === 'PRODUCTION_USAGE') && qty > current) {
      return {
        error: `Insufficient stock. Current: ${current} ${stockItem.unitType}, requested: ${qty}`,
        status: 400,
      };
    }

    return await prisma.$transaction(async (tx) => {
      // Handle ADJUSTMENT with adjustTo
      if (type === 'ADJUSTMENT') {
        const adjQty = decimalToNum(adjustTo);
        if (adjQty != null && !Number.isNaN(adjQty)) {
          if (adjQty < 0) {
            throw new Error('Stock adjustment quantity cannot be negative');
          }
          await tx.stockItem.update({ 
            where: { id: stockItemId }, 
            data: { currentQuantity: adjQty } 
          });
          const deltaQty = Math.abs(adjQty - current);
          const movement = await tx.stockMovement.create({
            data: {
              stockItemId,
              userId,
              quantity: deltaQty,
              unitPrice: itemUnitPrice,
              totalValue: deltaQty * itemUnitPrice,
              type: 'ADJUSTMENT',
              status: 'CONFIRMED',
              confirmedAt: new Date(),
              confirmedById: userId,
              reason: reason || `Adjusted to ${adjQty}`,
            },
            include: { 
              stockItem: true, 
              user: { select: { id: true, fullName: true, role: true } } 
            },
          });
          return movement;
        }
      }

      const isAuto = autoConfirm === true || type !== 'IN';
      const movementStatus = isAuto ? 'CONFIRMED' : 'PENDING_CONFIRMATION';

      if (isAuto) {
        const newQty = type === 'IN' ? current + qty : current - qty;
        await tx.stockItem.update({ 
          where: { id: stockItemId }, 
          data: { currentQuantity: newQty } 
        });
      }

      const totalVal = qty * itemUnitPrice;
      const movement = await tx.stockMovement.create({
        data: {
          stockItemId,
          userId,
          quantity: qty,
          unitPrice: itemUnitPrice,
          totalValue: totalVal,
          type: type as any,
          status: movementStatus,
          receivedBy: receivedBy?.trim() || null,
          reason: reason?.trim() || (type === 'IN' ? 'Manual Stock Addition' : null),
          ...(isAuto ? { confirmedAt: new Date(), confirmedById: userId } : {}),
        },
        include: {
          stockItem: { select: { id: true, name: true, unitType: true, currentQuantity: true, unitPrice: true } },
          user: { select: { id: true, fullName: true, role: true } },
          confirmedBy: { select: { id: true, fullName: true, role: true } },
          purchaseLoan: {
            include: {
              payments: {
                include: { user: { select: { id: true, fullName: true } } },
                orderBy: { createdAt: 'desc' },
              },
            },
          },
        },
      });

      if (type === 'IN' && body.loanInfo?.isLoan) {
        const loan = body.loanInfo;
        const paidAmount = Math.max(0, Math.min(totalVal, decimalToNum(loan.paidAmount) ?? 0));
        const remainingBalance = totalVal - paidAmount;
        const status = remainingBalance <= 0 ? 'PAID' : (paidAmount > 0 ? 'PARTIAL' : 'UNPAID');

        await tx.stockPurchaseLoan.create({
          data: {
            stockMovementId: movement.id,
            stockItemId,
            branchId: stockItem.branchId,
            supplierName: loan.supplierName ? String(loan.supplierName).trim() : null,
            totalAmount: totalVal,
            paidAmount,
            remainingBalance,
            status,
          },
        });
      }

      return movement;
    })
      .then(async (movement) => {
        if (body.loanInfo?.isLoan) {
          notificationsService.notifyAdminsAndOwners(
            stockItem.branchId,
            'STOCK_PURCHASE_LOAN',
            'notifications.stockPurchaseLoanTitle',
            'notifications.stockPurchaseLoanBody',
            {
              itemName: stockItem.name,
              amount: Number(movement.totalValue),
              supplierName: body.loanInfo.supplierName || 'Supplier',
            },
            '/owner-loans'
          ).catch((err) => console.error('[Notification] stockPurchaseLoan error:', err));
        }

        if (type === 'OUT' || type === 'PRODUCTION_USAGE') {
          const actorName = movement.user?.fullName ? `${movement.user.fullName} (${movement.user.role})` : (receivedBy?.trim() || 'Staff');
          notificationsService.notifyBranchRoles(
            stockItem.branchId,
            [Role.OWNER, Role.ADMIN, Role.STOCK_KEEPER],
            'STOCK_OUTWARD',
            'notifications.stockOutwardTitle',
            'notifications.stockOutwardBody',
            {
              itemName: stockItem.name,
              quantity: qty,
              unit: stockItem.unitType,
              takenBy: actorName,
              reason: reason?.trim() || (type === 'PRODUCTION_USAGE' ? 'Baking / Production usage' : 'Material issuance'),
              remaining: Math.max(0, current - qty),
            },
            '/stock'
          ).catch((err) => console.error('[Notification] stockOutward error:', err));
        }

        if (type === 'IN' && movement.status === 'PENDING_CONFIRMATION') {
          const actorName = movement.user?.fullName ? `${movement.user.fullName} (${movement.user.role})` : 'Management';
          notificationsService.notifyBranchRoles(
            stockItem.branchId,
            [Role.STOCK_KEEPER],
            'STOCK_INWARD_ADDED',
            'notifications.stockInwardTitle',
            'notifications.stockInwardBody',
            {
              itemName: stockItem.name,
              quantity: qty,
              unit: stockItem.unitType,
              addedBy: actorName,
              reason: reason?.trim() || '',
            },
            '/stock-movements'
          ).catch((err) => console.error('[Notification] stockInward error:', err));
        }

        if (type !== 'IN' || type === 'ADJUSTMENT') {
          this.checkAndNotifyStock(stockItemId).catch((err) =>
            console.error('[Notification] checkStock error:', err)
          );
        }

        return { data: movement };
      })
      .catch((err) => {
        return { error: err.message || 'Transaction failed', status: 400 };
      });
  }

  async checkAndNotifyStock(stockItemId: string) {
    try {
      const item = await prisma.stockItem.findUnique({ where: { id: stockItemId } });
      if (!item) return;
      const current = Number(item.currentQuantity);
      const min = Number(item.minStockLevel);

      if (current <= 0) {
        await notificationsService.notifyBranchRoles(
          item.branchId,
          [Role.OWNER, Role.ADMIN, Role.STOCK_KEEPER],
          'OUT_OF_STOCK',
          'notifications.outOfStockTitle',
          'notifications.outOfStockBody',
          {
            itemName: item.name,
            quantity: current,
            unit: item.unitType,
          },
          '/stock'
        );
      } else if (current <= min) {
        await notificationsService.notifyBranchRoles(
          item.branchId,
          [Role.OWNER, Role.ADMIN, Role.STOCK_KEEPER],
          'LOW_STOCK',
          'notifications.lowStockTitle',
          'notifications.lowStockBody',
          {
            itemName: item.name,
            quantity: current,
            minLevel: min,
            unit: item.unitType,
          },
          '/stock'
        );
      }
    } catch (err) {
      console.error('[Notification] checkAndNotifyStock error:', err);
    }
  }

  async confirmStockMovement(id: string, userId: string): ServiceResult {
    const movement = await prisma.stockMovement.findUnique({
      where: { id },
      include: { stockItem: true },
    });
    if (!movement) {
      return { error: 'Stock movement not found', status: 404 };
    }
    if (movement.status === 'CONFIRMED') {
      return { error: 'Stock movement is already confirmed', status: 400 };
    }
    if (movement.status === 'REJECTED') {
      return { error: 'Stock movement was rejected and cannot be confirmed', status: 400 };
    }

    const qty = Number(movement.quantity);
    const updated = await prisma.$transaction(async (tx) => {
      if (movement.type === 'IN') {
        await tx.stockItem.update({
          where: { id: movement.stockItemId },
          data: { currentQuantity: { increment: qty } },
        });
      }

      // Clean up reason upon confirmation: remove temporary awaiting/verification phrases
      let cleanedReason = (movement.reason || 'Manual Stock Addition')
        .replace(/Added by Admin\/Owner \(Awaiting Stock Keeper Verification\)/gi, 'Manual Stock Addition')
        .replace(/\(Awaiting Stock Keeper.*?\)/gi, '')
        .trim();
      if (!cleanedReason) {
        cleanedReason = 'Manual Stock Addition';
      }

      return await tx.stockMovement.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          confirmedById: userId,
          reason: cleanedReason,
        },
        include: {
          stockItem: true,
          user: { select: { id: true, fullName: true, role: true } },
          confirmedBy: { select: { id: true, fullName: true, role: true } },
        },
      });
    });

    if (updated.stockItem) {
      notificationsService.notifyAdminsAndOwners(
        updated.stockItem.branchId,
        'STOCK_CONFIRMED',
        'notifications.stockConfirmedTitle',
        'notifications.stockConfirmedBody',
        {
          itemName: updated.stockItem.name,
          quantity: Number(updated.quantity),
          unit: updated.stockItem.unitType,
          confirmedBy: updated.confirmedBy?.fullName || 'Stock Keeper',
        },
        '/stock-movements'
      ).catch((err) => console.error('[Notification] confirmStockMovement error:', err));
    }

    return { data: updated };
  }

  async rejectStockMovement(id: string, userId: string, reason?: string): ServiceResult {
    const movement = await prisma.stockMovement.findUnique({
      where: { id },
      include: { stockItem: true },
    });
    if (!movement) {
      return { error: 'Stock movement not found', status: 404 };
    }
    if (movement.status !== 'PENDING_CONFIRMATION') {
      return { error: `Stock movement cannot be rejected because status is ${movement.status}`, status: 400 };
    }

    const rejectionReason = reason?.trim() || 'No reason provided';
    const updated = await prisma.stockMovement.update({
      where: { id },
      data: {
        status: 'REJECTED',
        confirmedAt: new Date(),
        confirmedById: userId,
        reason: movement.reason ? `${movement.reason} [Rejected: ${rejectionReason}]` : `[Rejected: ${rejectionReason}]`,
      },
      include: {
        stockItem: true,
        user: { select: { id: true, fullName: true, role: true } },
        confirmedBy: { select: { id: true, fullName: true, role: true } },
      },
    });

    // Notify the user who recorded it + branch Admins and Owners
    const userIdsToNotify = new Set<string>();
    if (movement.userId && movement.userId !== userId) {
      userIdsToNotify.add(movement.userId);
    }

    const branchAdmins = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: ['OWNER', 'ADMIN'] },
        OR: [
          { branchId: updated.stockItem?.branchId || null },
          { role: 'OWNER' },
        ],
      },
      select: { id: true },
    });
    branchAdmins.forEach((u) => userIdsToNotify.add(u.id));
    userIdsToNotify.delete(userId);

    if (userIdsToNotify.size > 0 && updated.stockItem) {
      notificationsService.notifyUsers({
        userIds: Array.from(userIdsToNotify),
        branchId: updated.stockItem.branchId,
        type: 'STOCK_REJECTED',
        titleKey: 'notifications.stockRejectedTitle',
        bodyKey: 'notifications.stockRejectedBody',
        variables: {
          itemName: updated.stockItem.name,
          quantity: Number(updated.quantity),
          unit: updated.stockItem.unitType,
          rejectedBy: updated.confirmedBy?.fullName || 'Stock Keeper',
          reason: rejectionReason,
        },
        link: '/stock-movements?tab=rejected',
      }).catch((err) => console.error('[Notification] rejectStockMovement error:', err));
    }

    return { data: updated };
  }

  async resubmitStockMovement(
    id: string,
    userId: string,
    data: { quantity?: number; unitPrice?: number; reason?: string }
  ): ServiceResult {
    const movement = await prisma.stockMovement.findUnique({
      where: { id },
      include: { stockItem: true, user: true, purchaseLoan: true },
    });
    if (!movement) {
      return { error: 'Stock movement not found', status: 404 };
    }
    if (movement.status !== 'REJECTED' && movement.status !== 'PENDING_CONFIRMATION') {
      return { error: `Stock movement cannot be resubmitted because status is ${movement.status}`, status: 400 };
    }

    const newQty = data.quantity !== undefined ? Number(data.quantity) : Number(movement.quantity);
    if (newQty <= 0 || isNaN(newQty)) {
      return { error: 'Quantity must be greater than 0', status: 400 };
    }

    const newUnitPrice = data.unitPrice !== undefined ? Number(data.unitPrice) : (movement.unitPrice ? Number(movement.unitPrice) : undefined);
    const newTotalValue = newUnitPrice !== undefined ? newQty * newUnitPrice : undefined;

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
    const rawReason = data.reason || movement.reason || 'Manual Stock Addition';
    const cleanReason = rawReason
      .replace(/Added by Admin\/Owner \(Awaiting Stock Keeper Verification\)/gi, 'Manual Stock Addition')
      .replace(/\(Awaiting Stock Keeper.*?\)/gi, '')
      .replace(/\s*\[Rejected:.*?\]/g, '')
      .replace(/\s*\[Resubmitted by.*?\]/g, '')
      .trim() || 'Manual Stock Addition';
    const updatedReason = `${cleanReason} [Resubmitted by ${user?.fullName || 'Management'}]`;

    const updated = await prisma.$transaction(async (tx) => {
      const m = await tx.stockMovement.update({
        where: { id },
        data: {
          quantity: newQty,
          unitPrice: newUnitPrice,
          totalValue: newTotalValue,
          reason: updatedReason,
          status: 'PENDING_CONFIRMATION',
          confirmedAt: null,
          confirmedById: null,
        },
        include: {
          stockItem: true,
          user: { select: { id: true, fullName: true, role: true } },
        },
      });

      if (movement.purchaseLoan) {
        const paidAmount = Number(movement.purchaseLoan.paidAmount || 0);
        const remainingBalance = Math.max(0, (newTotalValue || 0) - paidAmount);
        const loanStatus = remainingBalance <= 0 ? 'PAID' : (paidAmount > 0 ? 'PARTIAL' : 'UNPAID');

        await tx.stockPurchaseLoan.update({
          where: { id: movement.purchaseLoan.id },
          data: {
            totalAmount: newTotalValue || 0,
            remainingBalance,
            status: loanStatus,
          },
        });
      }

      return m;
    });

    // Notify Stock Keepers in this branch
    if (updated.stockItem?.branchId) {
      notificationsService.notifyBranchRoles(
        updated.stockItem.branchId,
        ['STOCK_KEEPER'],
        'STOCK_RESUBMITTED',
        'notifications.stockResubmittedTitle',
        'notifications.stockResubmittedBody',
        {
          itemName: updated.stockItem.name,
          quantity: newQty,
          unit: updated.stockItem.unitType,
          resubmittedBy: user?.fullName || 'Management',
        },
        '/stock-movements?tab=approvals'
      ).catch((err) => console.error('[Notification] resubmitStockMovement error:', err));
    }

    return { data: updated };
  }

  // Per-item full movement history — used on stock item detail pages
  async getMovementsByStockItem(stockItemId: string, limit: number = 100): ServiceResult {
    const stockItem = await prisma.stockItem.findUnique({
      where: { id: stockItemId },
      include: { branch: { select: { id: true, name: true } } },
    });
    if (!stockItem) return { error: 'Stock item not found', status: 404 };

    const movements = await prisma.stockMovement.findMany({
      where: { stockItemId },
      include: { 
        user: { select: { id: true, fullName: true, role: true } },
        confirmedBy: { select: { id: true, fullName: true, role: true } },
        purchaseLoan: {
          include: {
            payments: {
              include: { user: { select: { id: true, fullName: true } } },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return {
      data: {
        stockItem,
        movements,
        totalIn: movements
          .filter((m) => m.type === 'IN' && m.status === 'CONFIRMED')
          .reduce((s, m) => s + Number(m.quantity), 0),
        totalOut: movements
          .filter((m) => (m.type === 'OUT' || m.type === 'PRODUCTION_USAGE') && m.status === 'CONFIRMED')
          .reduce((s, m) => s + Number(m.quantity), 0),
      },
    };
  }

  // Inventory summary — used on web dashboard inventory widget & stock keeper
  async getStockSummary(branchId?: string | null): ServiceResult {
    if (!branchId) return { error: 'branchId required', status: 400 };

    const items = await prisma.stockItem.findMany({
      where: { branchId },
      orderBy: { name: 'asc' },
    });

    const pendingApprovals = await prisma.stockMovement.count({
      where: {
        stockItem: { branchId },
        status: 'PENDING_CONFIRMATION',
      },
    });

    const totalItems = items.length;
    const outOfStock = items.filter((i) => Number(i.currentQuantity) <= 0).length;
    const lowStock = items.filter(
      (i) => i.minStockLevel != null && Number(i.currentQuantity) <= Number(i.minStockLevel)
    ).length;
    const healthy = totalItems - outOfStock;

    return {
      data: {
        branchId,
        totalItems,
        outOfStock,
        lowStock,
        healthy,
        pendingApprovals,
        items,
      },
    };
  }

  async getStockPurchaseLoans(
    branchId?: string | null,
    status?: string,
    page: number = 1,
    limit: number = 20,
    search?: string,
    user?: { id: string; role: string }
  ): ServiceResult {
    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (status && status !== 'ALL') where.status = status;
    if (user?.role === 'ADMIN') {
      where.stockMovement = { userId: user.id };
    }
    if (search && search.trim()) {
      const q = search.trim();
      const searchOr = [
        { supplierName: { contains: q, mode: 'insensitive' } },
        { stockItem: { name: { contains: q, mode: 'insensitive' } } },
      ];
      if (user?.role === 'ADMIN') {
        where.AND = [
          { stockMovement: { userId: user.id } },
          { OR: searchOr },
        ];
        delete where.stockMovement;
      } else {
        where.OR = searchOr;
      }
    }

    const skip = (page - 1) * limit;

    const statsWhere: any = {
      ...(branchId ? { branchId } : {}),
      ...(user?.role === 'ADMIN' ? { stockMovement: { userId: user.id } } : {}),
    };

    const [total, loans, statsAggregate, activeLoansCount] = await Promise.all([
      prisma.stockPurchaseLoan.count({ where }),
      prisma.stockPurchaseLoan.findMany({
        where,
        include: {
          stockMovement: {
            include: {
              stockItem: { select: { id: true, name: true, unitType: true } },
              user: { select: { id: true, fullName: true, role: true } },
            },
          },
          payments: {
            include: { user: { select: { id: true, fullName: true } } },
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.stockPurchaseLoan.aggregate({
        where: statsWhere,
        _sum: {
          totalAmount: true,
          paidAmount: true,
          remainingBalance: true,
        },
      }),
      prisma.stockPurchaseLoan.count({
        where: {
          ...statsWhere,
          status: { not: 'PAID' },
        },
      }),
    ]);

    const paginated = buildPaginatedResponse(loans, total, page, limit);
    return {
      data: {
        ...paginated,
        stats: {
          totalCredit: Number(statsAggregate._sum.totalAmount || 0),
          totalPaid: Number(statsAggregate._sum.paidAmount || 0),
          totalRemaining: Number(statsAggregate._sum.remainingBalance || 0),
          activeLoansCount,
        },
      },
    };
  }

  async recordLoanPayment(loanId: string, userId: string, amountToPay: number, note?: string): ServiceResult {
    const amt = decimalToNum(amountToPay);
    if (!Number.isFinite(amt) || amt <= 0) {
      return { error: 'Valid positive payment amount required', status: 400 };
    }

    const loan = await prisma.stockPurchaseLoan.findUnique({ 
      where: { id: loanId },
      include: { stockMovement: true },
    });
    if (!loan) {
      return { error: 'Stock purchase loan record not found', status: 404 };
    }

    const currentUser = await prisma.user.findUnique({ where: { id: userId } });
    if (currentUser?.role === 'ADMIN' && loan.stockMovement?.userId !== userId) {
      return { error: 'You do not have permission to pay loans recorded by other users', status: 403 };
    }

    const currentBal = Number(loan.remainingBalance);
    if (currentBal <= 0 || loan.status === 'PAID') {
      return { error: 'Loan is already fully paid and settled', status: 400 };
    }

    const payAmt = Math.min(currentBal, amt);
    const newPaid = Number(loan.paidAmount) + payAmt;
    const newBal = Number(loan.totalAmount) - newPaid;
    const newStatus = newBal <= 0 ? 'PAID' : 'PARTIAL';

    const result = await prisma.$transaction(async (tx) => {
      const updatedLoan = await tx.stockPurchaseLoan.update({
        where: { id: loanId },
        data: {
          paidAmount: newPaid,
          remainingBalance: newBal,
          status: newStatus,
        },
        include: {
          stockMovement: {
            include: { stockItem: { select: { id: true, name: true, unitType: true } } },
          },
          payments: {
            include: { user: { select: { id: true, fullName: true } } },
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      const payment = await tx.stockPurchasePayment.create({
        data: {
          loanId,
          userId,
          amount: payAmt,
          note: note?.trim() || 'Loan installment payment',
        },
        include: { user: { select: { id: true, fullName: true } } },
      });

      return { loan: updatedLoan, payment };
    });

    return { data: result };
  }
}
