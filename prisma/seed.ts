import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  let branch = await prisma.branch.findFirst({ where: { name: 'Main Branch' } });
  if (!branch) {
    branch = await prisma.branch.create({
      data: { name: 'Main Branch', address: 'Addis Ababa' },
    });
  }

  const passwordHash = await bcrypt.hash('password123', 10);
  await prisma.user.upsert({
    where: { phone: '0912345678' },
    update: {},
    create: {
      fullName: 'Hamza',
      phone: '0912345678',
      passwordHash,
      role: 'OWNER',
      branchId: branch.id,
    },
  });

  const roleUsers = [
    { phone: '0910000001', fullName: 'Admin User', role: 'ADMIN' as const },
    { phone: '0910000002', fullName: 'Cashier User', role: 'CASHIER' as const },
    { phone: '0910000003', fullName: 'Baker User', role: 'BAKER' as const },
    { phone: '0910000004', fullName: 'Sambusa Worker', role: 'SAMBUSA_WORKER' as const },
  ];
  for (const u of roleUsers) {
    await prisma.user.upsert({
      where: { phone: u.phone },
      update: { role: u.role, branchId: branch.id },
      create: {
        fullName: u.fullName,
        phone: u.phone,
        passwordHash,
        role: u.role,
        branchId: branch.id,
      },
    });
  }

  const categories = [
    { name: 'Bread (Machine)', type: 'PRODUCED' as const },
    { name: 'Sambusa / Spring / Fetira / Pizza / Sandwich', type: 'PRODUCED' as const },
    { name: 'Milk & Yoghurt', type: 'RESELL' as const },
    { name: 'Injera', type: 'RESELL' as const },
  ];
  for (const c of categories) {
    const existing = await prisma.productCategory.findFirst({ where: { name: c.name } });
    if (!existing) await prisma.productCategory.create({ data: c });
  }

  async function ensureFinancialCategory(name: string, type: 'REVENUE' | 'EXPENSE') {
    let fc = await prisma.financialCategory.findFirst({ where: { name, type } });
    if (!fc) fc = await prisma.financialCategory.create({ data: { name, type } });
    return fc;
  }
  const fcRetail = await ensureFinancialCategory('Retail sales (bakery)', 'REVENUE');
  const fcResell = await ensureFinancialCategory('Resell goods', 'REVENUE');
  await ensureFinancialCategory('Rent & facilities', 'EXPENSE');
  await ensureFinancialCategory('Utilities', 'EXPENSE');
  await ensureFinancialCategory('Supplies & ingredients', 'EXPENSE');

  const catBread = await prisma.productCategory.findFirst({ where: { name: 'Bread (Machine)' } })!;
  const catMilk = await prisma.productCategory.findFirst({ where: { name: 'Milk & Yoghurt' } })!;
  const catInjera = await prisma.productCategory.findFirst({ where: { name: 'Injera' } })!;

  const products = [
    { categoryId: catBread.id, name: 'Bread', flavor: 'Normal', unitType: 'PIECE' as const, basePrice: 10, buyPrice: null },
    { categoryId: catBread.id, name: 'Bread', flavor: 'Barley', unitType: 'PIECE' as const, basePrice: 12, buyPrice: null },
    { categoryId: catBread.id, name: 'Bomboloni', flavor: null, unitType: 'PIECE' as const, basePrice: 15, buyPrice: null },
    { categoryId: catBread.id, name: 'Donut', flavor: null, unitType: 'PIECE' as const, basePrice: 18, buyPrice: null },
    { categoryId: catMilk.id, name: 'Milk', flavor: null, unitType: 'LITER' as const, basePrice: 50, buyPrice: 40 },
    { categoryId: catMilk.id, name: 'Yoghurt', flavor: null, unitType: 'PIECE' as const, basePrice: 25, buyPrice: 20 },
    { categoryId: catInjera.id, name: 'Injera', flavor: 'Red', unitType: 'PIECE' as const, basePrice: 35, buyPrice: 28 },
    { categoryId: catInjera.id, name: 'Injera', flavor: 'White', unitType: 'PIECE' as const, basePrice: 35, buyPrice: 28 },
  ];
  for (const p of products) {
    const revId = p.categoryId === catInjera.id || p.categoryId === catMilk.id ? fcResell.id : fcRetail.id;
    const exists = await prisma.product.findFirst({
      where: { categoryId: p.categoryId, name: p.name, flavor: p.flavor },
    });
    if (!exists) {
      await prisma.product.create({ data: { ...p, financialCategoryId: revId } });
    } else if (exists.financialCategoryId == null) {
      await prisma.product.update({
        where: { id: exists.id },
        data: { financialCategoryId: revId },
      });
    }
  }

  const stockItems = [
    { branchId: branch.id, name: 'Dough', unitType: 'KG' as const, currentQuantity: 100, minStockLevel: 20 },
    { branchId: branch.id, name: 'Flour', unitType: 'KG' as const, currentQuantity: 200, minStockLevel: 50 },
  ];
  for (const s of stockItems) {
    const exists = await prisma.stockItem.findFirst({ where: { branchId: s.branchId, name: s.name } });
    if (!exists) await prisma.stockItem.create({ data: s });
  }

  console.log(
    'Seed done. Owner: 0912345678 / password123 | Staff: 0910000001 ADMIN, 0910000002 CASHIER, 0910000003 BAKER, 0910000004 SAMBUSA_WORKER / password123'
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
