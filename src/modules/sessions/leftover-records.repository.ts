import { prisma } from '../../lib/prisma.js';

export class LeftoverRecordsRepository {
  async findMany(sessionId: string) {
    return prisma.leftoverRecord.findMany({
      where: { sessionId },
      include: { product: { select: { id: true, name: true, unitType: true } } },
    });
  }

  async createMany(data: any[]) {
    return prisma.leftoverRecord.createMany({
      data,
      skipDuplicates: true,
    });
  }

  async deleteMany(sessionId: string) {
    return prisma.leftoverRecord.deleteMany({ where: { sessionId } });
  }

  async delete(sessionId: string, productId: string) {
    return prisma.leftoverRecord.delete({
      where: { sessionId_productId: { sessionId, productId } },
    });
  }

  async transaction(operations: any[]) {
    return prisma.$transaction(operations);
  }
}
