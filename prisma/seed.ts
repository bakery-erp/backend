import {
  PrismaClient,
  Role,
  Shift,
  BatchStatus,
  SessionStatus,
  PaymentMethod,
  SupplierType,
  DeliveryPaymentSource,
  LoanType,
  LoanStatus,
  ApprovalStatus,
  StockMovementType,
  ExpenseType,
  CategoryType,
  UnitType,
  CreditStatus,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const rawUrl = process.env.DATABASE_URL || '';
const sessionUrl = rawUrl.replace(':6543/', ':5432/').replace('&pgbouncer=true', '').replace('?pgbouncer=true', '?');
const prisma = new PrismaClient(sessionUrl ? { datasources: { db: { url: sessionUrl } } } : undefined);

async function safeOp<T>(fn: () => Promise<T>, maxRetries = 5, delayMs = 2000): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      if (attempt >= maxRetries) throw err;
      console.log(`⚠️ Database connection glitch (${attempt}/${maxRetries}), reconnecting in ${delayMs}ms...`);
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
}

async function cleanDatabase() {
  console.log('🧹 Cleaning existing database records...');
  const tableNames = [
    'CustomerCreditPayment',
    'CustomerCredit',
    'Customer',
    'PasswordResetRequest',
    'PayrollRecord',
    'Penalty',
    'LoanPayment',
    'Loan',
    'Expense',
    'SupplierDelivery',
    'Supplier',
    'LeftoverRecord',
    'SaleItem',
    'Sale',
    'ProductConversion',
    'ProductionMaterialUsage',
    'ProductionItem',
    'ProductionBatch',
    'StockPurchasePayment',
    'StockPurchaseLoan',
    'StockMovement',
    'StockItem',
    'Product',
    'FinancialCategory',
    'ProductCategory',
    'DailySession',
    'User',
    'Branch',
    'Company',
  ];

  const quotedTables = tableNames.map((t) => `"${t}"`).join(', ');
  await safeOp(async () => {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quotedTables} CASCADE;`);
  });
  console.log('✨ All tables wiped clean.');
}

export async function seed8Days() {
  console.log('\n=============================================================');
  console.log('🌱 Starting Full Multi-Branch Bakery ERP Dataset Seeder');
  console.log('=============================================================\n');

  // 0. Clean database
  await cleanDatabase();

  // 1. Company & Branches
  console.log('📍 [1/8] Creating Company & Branches (Megenagna & Piassa)...');
  const { company, branchMegenagna, branchPiassa } = await safeOp(async () => {
    const comp = await prisma.company.create({
      data: {
        name: 'Koket Bakery Group',
        email: 'info@koketbakery.com',
        phone: '0912345678',
        address: 'Addis Ababa, Ethiopia',
      },
    });

    const bMeg = await prisma.branch.create({
      data: {
        name: 'Megenagna Branch',
        address: 'Around Megenagna Square, Zefmesh Mall Area, Addis Ababa',
        companyId: comp.id,
      },
    });

    const bPia = await prisma.branch.create({
      data: {
        name: 'Piassa Branch',
        address: 'Churchill Road, Piassa, Addis Ababa',
        companyId: comp.id,
      },
    });

    return { company: comp, branchMegenagna: bMeg, branchPiassa: bPia };
  });

  // 2. Users & Staff Roles
  console.log('👥 [2/8] Creating Personnel & Staff for Both Branches...');
  const passwordHash = await bcrypt.hash('password123', 10);

  const staffList = [
    // Owner (Global)
    { phone: '0912345678', fullName: 'Hamza Owner', role: Role.OWNER, salary: 45000, shift: null, branchId: branchMegenagna.id, key: 'OWNER' },

    // Megenagna Staff
    { phone: '0910000001', fullName: 'Abebe Admin', role: Role.ADMIN, salary: 25000, shift: null, branchId: branchMegenagna.id, key: 'ADMIN_MEG' },
    { phone: '0920000001', fullName: 'Tadesse Baker', role: Role.BAKER, salary: 18500, shift: Shift.DAY, branchId: branchMegenagna.id, key: 'BAKER_MEG' },
    { phone: '0920000002', fullName: 'Meron Cashier', role: Role.CASHIER, salary: 13500, shift: Shift.DAY, branchId: branchMegenagna.id, key: 'CASHIER_MEG' },
    { phone: '0920000003', fullName: 'Fatima Pastry', role: Role.SAMBUSA_WORKER, salary: 12000, shift: Shift.DAY, branchId: branchMegenagna.id, key: 'SAMBUSA_MEG' },
    { phone: '0920000005', fullName: 'Hanna Cake', role: Role.CAKE_WORKER, salary: 16000, shift: Shift.DAY, branchId: branchMegenagna.id, key: 'CAKE_MEG' },
    { phone: '0920000004', fullName: 'Kassahun Cleaner', role: Role.EMPLOYEE, salary: 8500, shift: Shift.DAY, branchId: branchMegenagna.id, key: 'CLEANER_MEG' },

    // Piassa Staff
    { phone: '0910000002', fullName: 'Dawit Piassa Admin', role: Role.ADMIN, salary: 25000, shift: null, branchId: branchPiassa.id, key: 'ADMIN_PIA' },
    { phone: '0920000011', fullName: 'Kebede Piassa Baker', role: Role.BAKER, salary: 18500, shift: Shift.DAY, branchId: branchPiassa.id, key: 'BAKER_PIA' },
    { phone: '0920000012', fullName: 'Selam Piassa Cashier', role: Role.CASHIER, salary: 13500, shift: Shift.DAY, branchId: branchPiassa.id, key: 'CASHIER_PIA' },
    { phone: '0920000013', fullName: 'Tigist Piassa Sambusa', role: Role.SAMBUSA_WORKER, salary: 12000, shift: Shift.DAY, branchId: branchPiassa.id, key: 'SAMBUSA_PIA' },
    { phone: '0920000015', fullName: 'Yonas Piassa Cake', role: Role.CAKE_WORKER, salary: 16000, shift: Shift.DAY, branchId: branchPiassa.id, key: 'CAKE_PIA' },
  ];

  const userMap = new Map<string, string>();
  for (const s of staffList) {
    const user = await prisma.user.create({
      data: {
        fullName: s.fullName,
        phone: s.phone,
        passwordHash,
        role: s.role,
        salary: s.salary,
        shift: s.shift,
        isActive: true,
        branchId: s.branchId,
      },
    });
    userMap.set(s.key, user.id);
  }

  // 3. Financial & Product Categories
  console.log('🏷️  [3/8] Setting Up Financial & Catalog Categories with Role Mappings...');
  const fcRetail = await prisma.financialCategory.create({ data: { name: 'Retail sales (bakery)', type: 'REVENUE' } });
  const fcResell = await prisma.financialCategory.create({ data: { name: 'Resell goods', type: 'REVENUE' } });
  const fcLunch = await prisma.financialCategory.create({ data: { name: 'Staff Lunch & Welfare', type: 'EXPENSE' } });
  const fcSupplies = await prisma.financialCategory.create({ data: { name: 'Ingredients & Supplies', type: 'EXPENSE' } });
  const fcUtilities = await prisma.financialCategory.create({ data: { name: 'Utilities (Electricity & Water)', type: 'EXPENSE' } });
  const fcPackaging = await prisma.financialCategory.create({ data: { name: 'Packaging & Logistics', type: 'EXPENSE' } });

  const catBread = await prisma.productCategory.create({
    data: { name: 'Bread (Machine)', type: CategoryType.PRODUCED, productionRole: Role.BAKER },
  });
  const catPastry = await prisma.productCategory.create({
    data: { name: 'Pastry & Snacks', type: CategoryType.PRODUCED, productionRole: Role.SAMBUSA_WORKER },
  });
  const catCake = await prisma.productCategory.create({
    data: { name: 'Cakes & Desserts', type: CategoryType.PRODUCED, productionRole: Role.CAKE_WORKER },
  });
  const catDairy = await prisma.productCategory.create({
    data: { name: 'Dairy', type: CategoryType.RESELL },
  });
  const catInjera = await prisma.productCategory.create({
    data: { name: 'Injera', type: CategoryType.RESELL },
  });

  // 4. Products Catalog
  console.log('🍞 [4/8] Seeding Product Catalog with Branch Scoping...');
  const productsDef = [
    {
      name: 'Bread',
      flavor: 'Normal',
      unitType: UnitType.PIECE,
      basePrice: 10,
      buyPrice: null,
      categoryId: catBread.id,
      financialCategoryId: fcRetail.id,
      imageUrl: 'https://www.melskitchencafe.com/wp-content/uploads/french-bread1.webp',
      branchIds: [branchMegenagna.id, branchPiassa.id],
    },
    {
      name: 'Special Loaf Bread',
      flavor: 'White Loaf',
      unitType: UnitType.PIECE,
      basePrice: 35,
      buyPrice: null,
      categoryId: catBread.id,
      financialCategoryId: fcRetail.id,
      imageUrl: 'https://www.thespruceeats.com/thmb/j4mujy24lcmnyW_a7VS1sVP4Mw4=/750x0/filters:no_upscale():max_bytes(150000):strip_icc():format(webp)/loaf-of-bread-182835505-58a7008c5f9b58a3c91c9a14.jpg',
      branchIds: [branchMegenagna.id], // Megenagna exclusive
    },
    {
      name: 'Lentil Sambusa',
      flavor: 'Spicy Lentil',
      unitType: UnitType.PIECE,
      basePrice: 15,
      buyPrice: null,
      categoryId: catPastry.id,
      financialCategoryId: fcRetail.id,
      imageUrl: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=600&q=80',
      branchIds: [branchMegenagna.id, branchPiassa.id],
    },
    {
      name: 'Strawberry Cream Cake',
      flavor: 'Strawberry Vanilla',
      unitType: UnitType.PIECE,
      basePrice: 85,
      buyPrice: null,
      categoryId: catCake.id,
      financialCategoryId: fcRetail.id,
      imageUrl: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=600&q=80',
      branchIds: [branchMegenagna.id, branchPiassa.id],
    },
    {
      name: 'Fresh Milk',
      flavor: 'Whole Milk 500ml',
      unitType: UnitType.LITER,
      basePrice: 60,
      buyPrice: 48,
      categoryId: catDairy.id,
      financialCategoryId: fcResell.id,
      imageUrl: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=600&q=80',
      branchIds: [branchMegenagna.id, branchPiassa.id],
    },
    {
      name: 'White Teff Injera',
      flavor: 'Pure Teff',
      unitType: UnitType.PIECE,
      basePrice: 40,
      buyPrice: 32,
      categoryId: catInjera.id,
      financialCategoryId: fcResell.id,
      imageUrl: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80',
      branchIds: [branchPiassa.id], // Piassa exclusive
    },
  ];

  const productMap = new Map<string, any>();
  for (const p of productsDef) {
    const prod = await prisma.product.create({ data: p });
    productMap.set(p.name, prod);
  }

  // 5. Raw Materials (Stock Items) for Both Branches
  console.log('📦 [5/8] Seeding Initial Raw Material Inventory for Both Branches...');
  const stockDefs = [
    { name: 'Wheat Flour (Special)', unitType: UnitType.KG, currentQuantity: 1500, minStockLevel: 200, unitPrice: 85 },
    { name: 'Dry Yeast', unitType: UnitType.KG, currentQuantity: 60, minStockLevel: 15, unitPrice: 420 },
    { name: 'Cooking Oil', unitType: UnitType.LITER, currentQuantity: 250, minStockLevel: 50, unitPrice: 190 },
    { name: 'Sugar', unitType: UnitType.KG, currentQuantity: 350, minStockLevel: 60, unitPrice: 110 },
    { name: 'Lentils', unitType: UnitType.KG, currentQuantity: 120, minStockLevel: 25, unitPrice: 140 },
  ];

  const stockMapMeg = new Map<string, any>();
  const stockMapPia = new Map<string, any>();

  for (const s of stockDefs) {
    // Megenagna stock
    const itemMeg = await prisma.stockItem.create({
      data: { ...s, branchId: branchMegenagna.id },
    });
    stockMapMeg.set(s.name, itemMeg);
    await prisma.stockMovement.create({
      data: {
        type: StockMovementType.IN,
        quantity: s.currentQuantity,
        reason: 'Opening inventory setup (Megenagna)',
        stockItemId: itemMeg.id,
        userId: userMap.get('ADMIN_MEG')!,
      },
    });

    // Piassa stock
    const itemPia = await prisma.stockItem.create({
      data: { ...s, branchId: branchPiassa.id },
    });
    stockMapPia.set(s.name, itemPia);
    await prisma.stockMovement.create({
      data: {
        type: StockMovementType.IN,
        quantity: s.currentQuantity,
        reason: 'Opening inventory setup (Piassa)',
        stockItemId: itemPia.id,
        userId: userMap.get('ADMIN_PIA')!,
      },
    });
  }

  // 6. Suppliers & Customers for Both Branches
  console.log('🤝 [6/8] Seeding Suppliers & Customers for Both Branches...');
  const supDairyMeg = await prisma.supplier.create({
    data: { name: 'Bishoftu Fresh Dairy (Megenagna)', phone: '0911887766', type: SupplierType.MILK, branchId: branchMegenagna.id },
  });
  const supInjeraMeg = await prisma.supplier.create({
    data: { name: 'Bole Injera Cooperative', phone: '0911554433', type: SupplierType.INJERA, branchId: branchMegenagna.id },
  });

  const supDairyPia = await prisma.supplier.create({
    data: { name: 'Arsho Fresh Dairy (Piassa)', phone: '0911889900', type: SupplierType.MILK, branchId: branchPiassa.id },
  });
  const supInjeraPia = await prisma.supplier.create({
    data: { name: 'Churchill Teff Injera (Piassa)', phone: '0911667788', type: SupplierType.INJERA, branchId: branchPiassa.id },
  });

  const custMeg1 = await prisma.customer.create({
    data: { fullName: 'Megenagna Blue Cafe', phone: '0911998877', companyId: company.id, branchId: branchMegenagna.id, address: 'Near Megenagna Plaza' },
  });
  const custPia1 = await prisma.customer.create({
    data: { fullName: 'Piassa Heritage Cafe', phone: '0911443322', companyId: company.id, branchId: branchPiassa.id, address: 'Churchill Road 3rd Floor' },
  });

  // 7. Timeline Simulation for Both Branches
  console.log('📅 [7/8] Simulating 8 Days of Production, Sales & Sessions for Both Branches...');

  const ethNow = new Date(Date.now() + 3 * 3600 * 1000);
  const today = new Date(Date.UTC(ethNow.getUTCFullYear(), ethNow.getUTCMonth(), ethNow.getUTCDate(), 0, 0, 0, 0));

  const branchConfigs = [
    {
      branch: branchMegenagna,
      name: 'Megenagna',
      adminId: userMap.get('ADMIN_MEG')!,
      bakerId: userMap.get('BAKER_MEG')!,
      cashierId: userMap.get('CASHIER_MEG')!,
      sambusaId: userMap.get('SAMBUSA_MEG')!,
      cakeId: userMap.get('CAKE_MEG')!,
      stockMap: stockMapMeg,
      supDairy: supDairyMeg,
      supInjera: supInjeraMeg,
      customer: custMeg1,
      isMegenagna: true,
    },
    {
      branch: branchPiassa,
      name: 'Piassa',
      adminId: userMap.get('ADMIN_PIA')!,
      bakerId: userMap.get('BAKER_PIA')!,
      cashierId: userMap.get('CASHIER_PIA')!,
      sambusaId: userMap.get('SAMBUSA_PIA')!,
      cakeId: userMap.get('CAKE_PIA')!,
      stockMap: stockMapPia,
      supDairy: supDairyPia,
      supInjera: supInjeraPia,
      customer: custPia1,
      isMegenagna: false,
    },
  ];

  // 8 Days Definition
  const days = [
    { dayIndex: 1, offset: -7, status: SessionStatus.CLOSED, float: 1000, nextFloat: 1200 },
    { dayIndex: 2, offset: -6, status: SessionStatus.CLOSED, float: 1200, nextFloat: 1500 },
    { dayIndex: 3, offset: -5, status: SessionStatus.CLOSED, float: 1500, nextFloat: 1500 },
    { dayIndex: 4, offset: -4, status: SessionStatus.CLOSED, float: 1500, nextFloat: 1800 },
    { dayIndex: 5, offset: -3, status: SessionStatus.CLOSED, float: 1800, nextFloat: 1800 },
    { dayIndex: 6, offset: -2, status: SessionStatus.CLOSED, float: 1800, nextFloat: 2000 },
    { dayIndex: 7, offset: -1, status: SessionStatus.CLOSED, float: 2000, nextFloat: 2000 },
    { dayIndex: 8, offset: 0, status: SessionStatus.OPEN, float: 2000, nextFloat: null }, // TODAY live
  ];

  for (const bCfg of branchConfigs) {
    console.log(`\n🏢 ---> Simulating Timeline for ${bCfg.name} Branch <---`);

    for (const d of days) {
      const sessionDate = new Date(today);
      sessionDate.setDate(today.getDate() + d.offset);

      // Create or reuse Daily Session
      const session = await prisma.dailySession.upsert({
        where: {
          branchId_date: {
            branchId: bCfg.branch.id,
            date: sessionDate,
          },
        },
        create: {
          date: sessionDate,
          branchId: bCfg.branch.id,
          status: d.status,
          label: `${bCfg.name} Shift (Day ${d.dayIndex})`,
          openingCashFloat: d.float,
          actualCashAmount: d.status === SessionStatus.CLOSED ? 5000 + d.dayIndex * 400 : null,
          actualTelebirrAmount: d.status === SessionStatus.CLOSED ? 2000 + d.dayIndex * 200 : null,
          actualCbeAmount: d.status === SessionStatus.CLOSED ? 1000 + d.dayIndex * 150 : null,
          cashLeftoverAmount: d.nextFloat,
          notes: d.status === SessionStatus.CLOSED ? `${bCfg.name} Day ${d.dayIndex} finalized & reconciled.` : 'Shift actively in progress today.',
        },
        update: {
          status: d.status,
          label: `${bCfg.name} Shift (Day ${d.dayIndex})`,
          openingCashFloat: d.float,
          actualCashAmount: d.status === SessionStatus.CLOSED ? 5000 + d.dayIndex * 400 : null,
          actualTelebirrAmount: d.status === SessionStatus.CLOSED ? 2000 + d.dayIndex * 200 : null,
          actualCbeAmount: d.status === SessionStatus.CLOSED ? 1000 + d.dayIndex * 150 : null,
          cashLeftoverAmount: d.nextFloat,
          notes: d.status === SessionStatus.CLOSED ? `${bCfg.name} Day ${d.dayIndex} finalized & reconciled.` : 'Shift actively in progress today.',
        },
      });

      console.log(`   📅 Day ${d.dayIndex}/8 (${sessionDate.toISOString().slice(0, 10)}) simulated for ${bCfg.name}...`);

      // 1. Baker Batches (Bread) - Multiple batches for Today (15) and Yesterday (12) to test pagination & "Show More"
      const bakerBatchesToCreate = d.offset === 0
        ? [
            { hour: 6, min: 0, breadQty: 100, loafQty: 20, flour: 20, yeast: 0.6, sugar: 0.8 },
            { hour: 6, min: 45, breadQty: 80, loafQty: 15, flour: 18, yeast: 0.5, sugar: 0.7 },
            { hour: 7, min: 30, breadQty: 120, loafQty: 25, flour: 24, yeast: 0.8, sugar: 1.0 },
            { hour: 8, min: 15, breadQty: 90, loafQty: 20, flour: 20, yeast: 0.6, sugar: 0.8 },
            { hour: 9, min: 0, breadQty: 110, loafQty: 30, flour: 25, yeast: 0.8, sugar: 1.0 },
            { hour: 9, min: 45, breadQty: 95, loafQty: 20, flour: 20, yeast: 0.6, sugar: 0.8 },
            { hour: 10, min: 30, breadQty: 130, loafQty: 35, flour: 28, yeast: 0.9, sugar: 1.1 },
            { hour: 11, min: 15, breadQty: 85, loafQty: 15, flour: 18, yeast: 0.5, sugar: 0.7 },
            { hour: 12, min: 0, breadQty: 100, loafQty: 25, flour: 22, yeast: 0.7, sugar: 0.9 },
            { hour: 12, min: 45, breadQty: 115, loafQty: 25, flour: 25, yeast: 0.8, sugar: 1.0 },
            // Page 2 batches (Show More loads these 5 batches)
            { hour: 13, min: 30, breadQty: 105, loafQty: 20, flour: 22, yeast: 0.7, sugar: 0.9 },
            { hour: 14, min: 15, breadQty: 90, loafQty: 18, flour: 20, yeast: 0.6, sugar: 0.8 },
            { hour: 15, min: 0, breadQty: 120, loafQty: 30, flour: 26, yeast: 0.8, sugar: 1.0 },
            { hour: 15, min: 45, breadQty: 80, loafQty: 15, flour: 18, yeast: 0.5, sugar: 0.7 },
            { hour: 16, min: 30, breadQty: 75, loafQty: 10, flour: 16, yeast: 0.5, sugar: 0.6 },
          ]
        : d.offset === -1
        ? [
            { hour: 6, min: 15, breadQty: 100, loafQty: 20, flour: 20, yeast: 0.6, sugar: 0.8 },
            { hour: 7, min: 0, breadQty: 80, loafQty: 15, flour: 18, yeast: 0.5, sugar: 0.7 },
            { hour: 7, min: 45, breadQty: 110, loafQty: 25, flour: 24, yeast: 0.8, sugar: 1.0 },
            { hour: 8, min: 30, breadQty: 95, loafQty: 20, flour: 20, yeast: 0.6, sugar: 0.8 },
            { hour: 9, min: 15, breadQty: 120, loafQty: 30, flour: 26, yeast: 0.8, sugar: 1.0 },
            { hour: 10, min: 0, breadQty: 90, loafQty: 18, flour: 20, yeast: 0.6, sugar: 0.8 },
            { hour: 10, min: 45, breadQty: 130, loafQty: 35, flour: 28, yeast: 0.9, sugar: 1.1 },
            { hour: 11, min: 30, breadQty: 85, loafQty: 15, flour: 18, yeast: 0.5, sugar: 0.7 },
            { hour: 12, min: 15, breadQty: 100, loafQty: 25, flour: 22, yeast: 0.7, sugar: 0.9 },
            { hour: 13, min: 0, breadQty: 115, loafQty: 25, flour: 25, yeast: 0.8, sugar: 1.0 },
            // Page 2 batches (Show More loads these 2 batches)
            { hour: 14, min: 0, breadQty: 105, loafQty: 20, flour: 22, yeast: 0.7, sugar: 0.9 },
            { hour: 15, min: 0, breadQty: 90, loafQty: 15, flour: 20, yeast: 0.6, sugar: 0.8 },
          ]
        : [
            { hour: 8, min: 0, breadQty: 200 + d.dayIndex * 10, loafQty: 40 + d.dayIndex * 2, flour: 50, yeast: 1.5, sugar: 2.0 },
          ];

      for (let bIdx = 0; bIdx < bakerBatchesToCreate.length; bIdx++) {
        const bSpec = bakerBatchesToCreate[bIdx];
        const batchCreatedAt = new Date(sessionDate);
        batchCreatedAt.setUTCHours(bSpec.hour - 3, bSpec.min, 0, 0);

        const breadItems = bCfg.isMegenagna
          ? [{ name: 'Bread', qty: bSpec.breadQty }, { name: 'Special Loaf Bread', qty: bSpec.loafQty }]
          : [{ name: 'Bread', qty: bSpec.breadQty }];

        const breadMat = [
          { name: 'Wheat Flour (Special)', qty: bSpec.flour },
          { name: 'Dry Yeast', qty: bSpec.yeast },
          { name: 'Sugar', qty: bSpec.sugar },
        ];

        await prisma.productionBatch.create({
          data: {
            branchId: bCfg.branch.id,
            userId: bCfg.bakerId,
            sessionId: session.id,
            date: sessionDate,
            shift: Shift.DAY,
            status: BatchStatus.COMPLETED,
            createdAt: batchCreatedAt,
            items: {
              create: breadItems.map((i) => ({ productId: productMap.get(i.name).id, quantityProduced: i.qty })),
            },
            materialUsages: {
              create: breadMat.map((m) => ({ stockItemId: bCfg.stockMap.get(m.name).id, quantityUsed: m.qty })),
            },
          },
        });

        for (const m of breadMat) {
          const item = bCfg.stockMap.get(m.name);
          await prisma.stockItem.update({ where: { id: item.id }, data: { currentQuantity: { decrement: m.qty } } });
          await prisma.stockMovement.create({
            data: {
              stockItemId: item.id,
              userId: bCfg.bakerId,
              quantity: m.qty,
              type: StockMovementType.PRODUCTION_USAGE,
              reason: `Baker Bread Batch ${bIdx + 1} (Day ${d.dayIndex})`,
              createdAt: batchCreatedAt,
            },
          });
        }
      }

      // 2. Sambusa Worker Batch (Sambusa)
      const sambusaItems = [{ name: 'Lentil Sambusa', qty: 80 + d.dayIndex * 5 }];
      const sambusaMat = [
        { name: 'Wheat Flour (Special)', qty: 8 },
        { name: 'Cooking Oil', qty: 4 },
        { name: 'Lentils', qty: 6 },
      ];

      await prisma.productionBatch.create({
        data: {
          branchId: bCfg.branch.id,
          userId: bCfg.sambusaId,
          sessionId: session.id,
          date: sessionDate,
          shift: Shift.DAY,
          status: BatchStatus.COMPLETED,
          createdAt: sessionDate,
          items: {
            create: sambusaItems.map((i) => ({ productId: productMap.get(i.name).id, quantityProduced: i.qty })),
          },
          materialUsages: {
            create: sambusaMat.map((m) => ({ stockItemId: bCfg.stockMap.get(m.name).id, quantityUsed: m.qty })),
          },
        },
      });

      for (const m of sambusaMat) {
        const item = bCfg.stockMap.get(m.name);
        await prisma.stockItem.update({ where: { id: item.id }, data: { currentQuantity: { decrement: m.qty } } });
        await prisma.stockMovement.create({
          data: {
            stockItemId: item.id,
            userId: bCfg.sambusaId,
            quantity: m.qty,
            type: StockMovementType.PRODUCTION_USAGE,
            reason: `Sambusa Station Batch (Day ${d.dayIndex})`,
            createdAt: sessionDate,
          },
        });
      }

      // 3. Cake Worker Batch (Cake)
      const cakeItems = [{ name: 'Strawberry Cream Cake', qty: 25 + d.dayIndex * 2 }];
      const cakeMat = [
        { name: 'Wheat Flour (Special)', qty: 6 },
        { name: 'Sugar', qty: 3 },
        { name: 'Cooking Oil', qty: 2 },
      ];

      await prisma.productionBatch.create({
        data: {
          branchId: bCfg.branch.id,
          userId: bCfg.cakeId,
          sessionId: session.id,
          date: sessionDate,
          shift: Shift.DAY,
          status: BatchStatus.COMPLETED,
          createdAt: sessionDate,
          items: {
            create: cakeItems.map((i) => ({ productId: productMap.get(i.name).id, quantityProduced: i.qty })),
          },
          materialUsages: {
            create: cakeMat.map((m) => ({ stockItemId: bCfg.stockMap.get(m.name).id, quantityUsed: m.qty })),
          },
        },
      });

      for (const m of cakeMat) {
        const item = bCfg.stockMap.get(m.name);
        await prisma.stockItem.update({ where: { id: item.id }, data: { currentQuantity: { decrement: m.qty } } });
        await prisma.stockMovement.create({
          data: {
            stockItemId: item.id,
            userId: bCfg.cakeId,
            quantity: m.qty,
            type: StockMovementType.PRODUCTION_USAGE,
            reason: `Cake Station Batch (Day ${d.dayIndex})`,
            createdAt: sessionDate,
          },
        });
      }

      // 4. Supplier Deliveries (Resell items)
      await prisma.supplierDelivery.create({
        data: {
          supplierId: bCfg.supDairy.id,
          productId: productMap.get('Fresh Milk').id,
          quantityReceived: 40 + d.dayIndex * 2,
          returnedQuantity: 0,
          unitBuyPrice: 48,
          unitSellPrice: 60,
          sessionId: session.id,
          paymentSource: DeliveryPaymentSource.DAILY_CASH,
          isPaid: true,
          createdAt: sessionDate,
        },
      });

      if (!bCfg.isMegenagna) {
        // Piassa has White Teff Injera
        await prisma.supplierDelivery.create({
          data: {
            supplierId: bCfg.supInjera.id,
            productId: productMap.get('White Teff Injera').id,
            quantityReceived: 60 + d.dayIndex * 3,
            returnedQuantity: 0,
            unitBuyPrice: 32,
            unitSellPrice: 40,
            sessionId: session.id,
            paymentSource: DeliveryPaymentSource.DAILY_CASH,
            isPaid: true,
            createdAt: sessionDate,
          },
        });
      }

      // 5. Shift Expenses
      await prisma.expense.create({
        data: {
          branchId: bCfg.branch.id,
          userId: bCfg.cashierId,
          sessionId: session.id,
          date: sessionDate,
          amount: 350 + d.dayIndex * 20,
          category: 'Staff Lunch & Welfare',
          description: `${bCfg.name} Staff Lunch (Day ${d.dayIndex})`,
          type: ExpenseType.COMPANY,
          createdAt: sessionDate,
        },
      });

      // 6. Leftovers & Sales
      if (d.status === SessionStatus.CLOSED) {
        const prodList = bCfg.isMegenagna
          ? ['Bread', 'Special Loaf Bread', 'Lentil Sambusa', 'Strawberry Cream Cake', 'Fresh Milk']
          : ['Bread', 'Lentil Sambusa', 'Strawberry Cream Cake', 'Fresh Milk', 'White Teff Injera'];

        const saleLines: any[] = [];
        let totalSales = 0;

        for (const pName of prodList) {
          const prod = productMap.get(pName);
          const remaining = 5 + (d.dayIndex % 4);
          const damaged = d.dayIndex % 2 === 0 ? 2 : 0;

          await prisma.leftoverRecord.create({
            data: {
              sessionId: session.id,
              productId: prod.id,
              quantityRemaining: remaining,
              damagedQuantity: damaged,
              damageReason: damaged > 0 ? 'Quality check inspection' : null,
            },
          });

          const soldQty = 25 + d.dayIndex * 15;
          const price = Number(prod.basePrice);
          const subtotal = soldQty * price;
          totalSales += subtotal;
          saleLines.push({ productId: prod.id, quantity: soldQty, unitPrice: price, subtotal });
        }

        await prisma.sale.create({
          data: {
            sessionId: session.id,
            userId: bCfg.cashierId,
            totalAmount: totalSales,
            paymentMethod: PaymentMethod.CASH,
            createdAt: sessionDate,
            items: { create: saleLines },
          },
        });
      } else {
        // Day 8 (TODAY): Active in-progress sales
        const breadProd = productMap.get('Bread');
        const sambusaProd = productMap.get('Lentil Sambusa');
        const cakeProd = productMap.get('Strawberry Cream Cake');

        await prisma.sale.create({
          data: {
            sessionId: session.id,
            userId: bCfg.cashierId,
            totalAmount: 250,
            paymentMethod: PaymentMethod.CASH,
            items: {
              create: [
                { productId: breadProd.id, quantity: 15, unitPrice: 10, subtotal: 150 },
                { productId: sambusaProd.id, quantity: 5, unitPrice: 15, subtotal: 75 },
                { productId: cakeProd.id, quantity: 1, unitPrice: 85, subtotal: 85 },
              ],
            },
          },
        });
      }
    }
  }

  // 8. Loans & Penalties
  console.log('💼 [8/8] Seeding Staff Loans and Owner Drawdowns for Both Branches...');
  await safeOp(async () => {
    // Owner Loan in Megenagna
    const ownerLoan = await prisma.loan.create({
      data: {
        userId: userMap.get('OWNER')!,
        branchId: branchMegenagna.id,
        totalAmount: 25000,
        remainingBalance: 20000,
        type: LoanType.OWNER_LOAN,
        status: LoanStatus.OPEN,
      },
    });

    await prisma.loanPayment.create({
      data: { loanId: ownerLoan.id, amountPaid: 5000, date: new Date() },
    });

    // Megenagna Baker Advance
    await prisma.loan.create({
      data: {
        userId: userMap.get('BAKER_MEG')!,
        branchId: branchMegenagna.id,
        totalAmount: 2000,
        remainingBalance: 2000,
        type: LoanType.SALARY_ADVANCE,
        status: LoanStatus.OPEN,
      },
    });

    // Piassa Baker Advance
    await prisma.loan.create({
      data: {
        userId: userMap.get('BAKER_PIA')!,
        branchId: branchPiassa.id,
        totalAmount: 1500,
        remainingBalance: 1500,
        type: LoanType.SALARY_ADVANCE,
        status: LoanStatus.OPEN,
      },
    });

    // Cleaner Penalty
    await prisma.penalty.create({
      data: {
        userId: userMap.get('CLEANER_MEG')!,
        amount: 300,
        reason: 'Unexcused late arrival on Saturday morning shift',
        date: new Date(),
        status: ApprovalStatus.APPROVED,
        isDeducted: false,
      },
    });
  });

  console.log('\n=============================================================');
  console.log('✅ Complete Multi-Branch Bakery ERP Dataset Seeding Complete!');
  console.log('=============================================================\n');
}

seed8Days()
  .catch((e) => {
    console.error('❌ Seeding failed with error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
