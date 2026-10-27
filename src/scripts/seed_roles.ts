import { PrismaClient, Role, Shift } from '@prisma/client';
import bcrypt from 'bcryptjs';

const rawUrl = process.env.DATABASE_URL || '';
// Use port 5432 for direct session if Supabase pooler 6543 has transaction locking
const sessionUrl = rawUrl.replace(':6543/', ':5432/').replace('&pgbouncer=true', '').replace('?pgbouncer=true', '?');
const prisma = new PrismaClient(sessionUrl ? { datasources: { db: { url: sessionUrl } } } : undefined);

async function main() {
  console.log('\n======================================================');
  console.log('🚀 Seeding All 8 User Roles with Daily Expense Data');
  console.log('======================================================\n');

  // 1. Get or create a branch to associate all roles with
  let branch = await prisma.branch.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  });

  if (!branch) {
    console.log('📍 No active branch found. Creating primary test branch: "Central Bakery - Bole"...');
    branch = await prisma.branch.create({
      data: {
        name: 'Central Bakery - Bole',
        address: 'Bole Subcity, Next to Edna Mall, Addis Ababa',
        isActive: true,
      },
    });
  }

  console.log(`✅ Using Branch: "${branch.name}" (ID: ${branch.id})\n`);

  const commonPassword = 'password123';
  const passwordHash = await bcrypt.hash(commonPassword, 10);
  const now = new Date();

  // 2. Define data for all 8 roles
  const rolesToSeed = [
    {
      phone: '0911000000',
      fullName: 'Hamza Owner',
      role: Role.OWNER,
      salary: 50000,
      dailyExpense: 500,
      shift: null,
      notes: 'Full administrative & financial control',
    },
    {
      phone: '0911000001',
      fullName: 'Abebe Admin',
      role: Role.ADMIN,
      salary: 25000,
      dailyExpense: 200,
      shift: null,
      notes: 'Branch operations & user approvals',
    },
    {
      phone: '0911000002',
      fullName: 'Meron Cashier',
      role: Role.CASHIER,
      salary: 14000,
      dailyExpense: 100,
      shift: Shift.DAY,
      notes: 'POS sales, daily session opens/closes',
    },
    {
      phone: '0911000003',
      fullName: 'Tadesse Baker',
      role: Role.BAKER,
      salary: 18500,
      dailyExpense: 150,
      shift: Shift.DAY,
      notes: 'Bread production batches & leftovers',
    },
    {
      phone: '0911000004',
      fullName: 'Hanna Cake',
      role: Role.CAKE_WORKER,
      salary: 16000,
      dailyExpense: 120,
      shift: Shift.DAY,
      notes: 'Cakes & pastries batch entry',
    },
    {
      phone: '0911000005',
      fullName: 'Fatima Sambusa',
      role: Role.SAMBUSA_WORKER,
      salary: 13000,
      dailyExpense: 100,
      shift: Shift.DAY,
      notes: 'Sambusa & snacks mobile worker flow',
    },
    {
      phone: '0911000006',
      fullName: 'Dawit Storekeeper',
      role: Role.STOCK_KEEPER,
      salary: 17000,
      dailyExpense: 120,
      shift: Shift.DAY,
      notes: 'Stock movements, adjustments, inventory audits',
    },
    {
      phone: '0911000007',
      fullName: 'Kassahun Staff',
      role: Role.EMPLOYEE,
      salary: 9500,
      dailyExpense: 80,
      shift: Shift.DAY,
      notes: 'General assistant, loans & payroll eligibility',
    },
  ];

  console.log('👤 Upserting users across all roles:');
  const results = [];

  for (const item of rolesToSeed) {
    const user = await prisma.user.upsert({
      where: { phone: item.phone },
      update: {
        fullName: item.fullName,
        role: item.role,
        branchId: branch.id,
        salary: item.salary,
        dailyExpense: item.dailyExpense,
        shift: item.shift,
        isActive: true,
        passwordHash,
      },
      create: {
        phone: item.phone,
        fullName: item.fullName,
        passwordHash,
        role: item.role,
        branchId: branch.id,
        salary: item.salary,
        dailyExpense: item.dailyExpense,
        shift: item.shift,
        isActive: true,
        startDate: now,
      },
    });

    results.push({
      Role: item.role,
      'Full Name': item.fullName,
      Phone: item.phone,
      'Base Salary': `${item.salary} ETB`,
      'Daily Expense': `${item.dailyExpense} ETB`,
      Password: commonPassword,
    });
  }

  console.table(results);
  console.log('🎉 All 8 user roles successfully seeded & linked to branch!\n');
}

main()
  .catch((e) => {
    console.error('❌ Error during role seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
