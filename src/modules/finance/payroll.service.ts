import { prisma } from '../../lib/prisma.js';
import { EthDateTime } from 'ethiopian-calendar-date-converter';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

function decimalToNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return 0;
}

export class PayrollService {
  async getMyPayroll(userId?: string): ServiceResult {
    if (!userId) {
      return { error: 'Unauthorized', status: 401 };
    }
    const list = await prisma.payrollRecord.findMany({
      where: { userId },
      include: { user: { select: { id: true, fullName: true, phone: true, role: true } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    return { data: list };
  }

  async getPayroll(userId?: string, month?: string, year?: string): ServiceResult {
    const where: any = {};
    if (userId) where.userId = userId;
    if (month) where.month = parseInt(month, 10);
    if (year) where.year = parseInt(year, 10);
    const list = await prisma.payrollRecord.findMany({
      where,
      include: { user: { select: { id: true, fullName: true, phone: true, role: true } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
    return { data: list };
  }

  async getPayrollById(id: string): ServiceResult {
    const record = await prisma.payrollRecord.findUnique({
      where: { id },
      include: { user: { select: { id: true, fullName: true, phone: true, role: true } } },
    });
    if (!record) {
      return { error: 'Payroll record not found', status: 404 };
    }
    return { data: record };
  }

  async createPayroll(body: any): ServiceResult {
    const { userId, month, year, baseSalary, loanDeductions, penaltyDeductions, bonus, paymentDate } = body;
    if (!userId || month == null || year == null || baseSalary == null) {
      return { error: 'userId, month, year, baseSalary required', status: 400 };
    }

    const m = parseInt(String(month), 10);
    const y = parseInt(String(year), 10);

    const existing = await prisma.payrollRecord.findFirst({
      where: {
        userId,
        month: m,
        year: y,
      },
    });
    if (existing) {
      return {
        error: `Payroll for this employee has already been processed for term ${m}/${y}.`,
        status: 400,
      };
    }

    const base = decimalToNum(baseSalary);
    const loanD = decimalToNum(loanDeductions);
    const penaltyD = decimalToNum(penaltyDeductions);
    const bonusNum = decimalToNum(bonus);
    const finalAmount = body.finalAmount != null ? decimalToNum(body.finalAmount) : (base - loanD - penaltyD + bonusNum);

    try {
      const record = await prisma.$transaction(async (tx) => {
        const createdRecord = await tx.payrollRecord.create({
          data: {
            userId,
            month,
            year,
            baseSalary: base,
            loanDeductions: loanD,
            penaltyDeductions: penaltyD,
            bonus: bonusNum,
            finalAmount,
            status: 'PENDING_APPROVAL',
            paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
          },
          include: { user: { select: { id: true, fullName: true, phone: true, role: true } } },
        });

        if (loanD > 0) {
          let remainingToDeduct = loanD;
          const openLoans = await tx.loan.findMany({
            where: { userId, status: 'OPEN' },
            orderBy: { createdAt: 'asc' },
          });

          for (const l of openLoans) {
            if (remainingToDeduct <= 0) break;
            const currentBal = Number(l.remainingBalance);
            const payAmt = Math.min(remainingToDeduct, currentBal);
            remainingToDeduct -= payAmt;
            const newBal = Math.max(0, currentBal - payAmt);

            await tx.loanPayment.create({
              data: {
                loanId: l.id,
                amountPaid: payAmt,
                date: paymentDate ? new Date(paymentDate) : new Date(),
              },
            });

            await tx.loan.update({
              where: { id: l.id },
              data: {
                remainingBalance: newBal,
                status: newBal <= 0.01 ? 'PAID' : 'OPEN',
              },
            });
          }
        }

        if (penaltyD > 0) {
          await tx.penalty.updateMany({
            where: { userId, isDeducted: false },
            data: { isDeducted: true },
          });
        }

        return createdRecord;
      });

      return { data: record };
    } catch (e: any) {
      return { error: e.message || 'Failed to create payroll record', status: 400 };
    }
  }

  async calculatePayroll(userId: string, month: string, year: string): ServiceResult {
    if (!month || !year) {
      return { error: 'month and year required', status: 400 };
    }
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) {
      return { error: 'User not found', status: 404 };
    }

    const baseSalary = user.salary != null ? Number(user.salary) : 0;
    const startDate = user.startDate ? new Date(user.startDate) : new Date(user.createdAt);
    const isLeapYear = y % 4 === 3;
    const daysInMonth = m === 13 ? (isLeapYear ? 6 : 5) : 30;

    let proratedBase = (baseSalary / 30) * daysInMonth;

    if (startDate) {
      const ethStart = EthDateTime.fromEuropeanDate(startDate);
      const sYear = ethStart.year;
      const sMonth = ethStart.month;
      const sDay = ethStart.date;

      if (sYear > y || (sYear === y && sMonth > m)) {
        proratedBase = 0;
      } else if (sYear === y && sMonth === m) {
        const daysWorked = daysInMonth - sDay + 1;
        proratedBase = (baseSalary / 30) * Math.max(0, daysWorked);
      }
    }

    proratedBase = Math.round(proratedBase * 100) / 100;
    const openLoans = await prisma.loan.findMany({
      where: { userId, status: 'OPEN' },
    });
    const totalLoanBalance = openLoans.reduce((s, l) => s + Number(l.remainingBalance), 0);
    const undeductedPenalties = await prisma.penalty.findMany({
      where: { userId, isDeducted: false, status: 'APPROVED' },
    });
    const penaltyDeductions = undeductedPenalties.reduce((s, p) => s + Number(p.amount), 0);

    const existingPayroll = await prisma.payrollRecord.findFirst({
      where: { userId, month: m, year: y },
    });

    return {
      data: {
        userId,
        month: m,
        year: y,
        isAlreadyPaid: !!existingPayroll,
        existingPayroll: existingPayroll || null,
        baseSalary,
        proratedBase,
        loanDeductions: totalLoanBalance,
        penaltyDeductions,
        suggestedFinalAmount: proratedBase - totalLoanBalance - penaltyDeductions,
        undeductedPenalties,
        openLoans,
      },
    };
  }

  async updatePayroll(id: string, body: any): ServiceResult {
    const { paymentDate, bonus, loanDeductions, penaltyDeductions, baseSalary, finalAmount, status } = body;
    const existing = await prisma.payrollRecord.findUnique({ where: { id } });
    if (!existing) {
      return { error: 'Payroll record not found', status: 404 };
    }

    const data: any = {};
    if (paymentDate !== undefined) data.paymentDate = paymentDate ? new Date(paymentDate) : null;
    if (baseSalary != null) data.baseSalary = decimalToNum(baseSalary);
    if (bonus != null) data.bonus = decimalToNum(bonus);
    if (loanDeductions != null) data.loanDeductions = decimalToNum(loanDeductions);
    if (penaltyDeductions != null) data.penaltyDeductions = decimalToNum(penaltyDeductions);
    if (status !== undefined) data.status = status;

    if (finalAmount != null) {
      data.finalAmount = decimalToNum(finalAmount);
    } else if (baseSalary != null || bonus != null || loanDeductions != null || penaltyDeductions != null) {
      const base = data.baseSalary ?? Number(existing.baseSalary);
      const loanD = data.loanDeductions ?? Number(existing.loanDeductions);
      const penaltyD = data.penaltyDeductions ?? Number(existing.penaltyDeductions);
      const bonusNum = data.bonus ?? Number(existing.bonus);
      data.finalAmount = base - loanD - penaltyD + bonusNum;
    }

    const record = await prisma.payrollRecord.update({
      where: { id },
      data,
      include: { user: { select: { id: true, fullName: true, phone: true, role: true } } },
    });
    return { data: record };
  }

  async approvePayroll(id: string, userId: string): ServiceResult {
    const record = await prisma.payrollRecord.findUnique({ where: { id } });
    if (!record) return { error: 'Payroll record not found', status: 404 };
    if (record.userId !== userId) return { error: 'Unauthorized to approve this payroll record', status: 403 };

    const updated = await prisma.payrollRecord.update({
      where: { id },
      data: { status: 'APPROVED' },
      include: { user: { select: { id: true, fullName: true, phone: true, role: true } } },
    });
    return { data: updated };
  }

  async rejectPayroll(id: string, userId: string): ServiceResult {
    const record = await prisma.payrollRecord.findUnique({ where: { id } });
    if (!record) return { error: 'Payroll record not found', status: 404 };
    if (record.userId !== userId) return { error: 'Unauthorized to reject this payroll record', status: 403 };

    const updated = await prisma.payrollRecord.update({
      where: { id },
      data: { status: 'REJECTED' },
      include: { user: { select: { id: true, fullName: true, phone: true, role: true } } },
    });
    return { data: updated };
  }
}
