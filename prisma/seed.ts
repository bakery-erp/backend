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

const prisma = new PrismaClient();

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
  console.log('🌱 Starting 8-Day Cohesive Bakery ERP Dataset Seeder');
  console.log('=============================================================\n');

  // 0. Clean database
  await cleanDatabase();

  // 1. Company & Branches
  console.log('📍 [1/8] Creating Company & Branches...');
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
  console.log('👥 [2/8] Creating Personnel & Staff...');
  const passwordHash = await bcrypt.hash('password123', 10);

  const staffList = [
    { phone: '0912345678', fullName: 'Hamza Owner', role: Role.OWNER, salary: 45000, shift: null },
    { phone: '0910000001', fullName: 'Abebe Admin', role: Role.ADMIN, salary: 25000, shift: null },
    { phone: '0920000001', fullName: 'Tadesse Baker', role: Role.BAKER, salary: 18500, shift: Shift.DAY },
    { phone: '0920000002', fullName: 'Meron Cashier', role: Role.CASHIER, salary: 13500, shift: Shift.DAY },
    { phone: '0920000003', fullName: 'Fatima Pastry', role: Role.SAMBUSA_WORKER, salary: 12000, shift: Shift.DAY },
    { phone: '0920000004', fullName: 'Kassahun Cleaner', role: Role.EMPLOYEE, salary: 8500, shift: Shift.DAY },
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
        branchId: branchMegenagna.id,
      },
    });
    userMap.set(s.role, user.id);
  }

  const ownerId = userMap.get(Role.OWNER)!;
  const adminId = userMap.get(Role.ADMIN)!;
  const cashierId = userMap.get(Role.CASHIER)!;
  const bakerId = userMap.get(Role.BAKER)!;
  const sambusaId = userMap.get(Role.SAMBUSA_WORKER)!;

  // 3. Financial & Product Categories
  console.log('🏷️  [3/8] Setting Up Financial & Catalog Categories...');
  const fcRetail = await prisma.financialCategory.create({ data: { name: 'Retail sales (bakery)', type: 'REVENUE' } });
  const fcResell = await prisma.financialCategory.create({ data: { name: 'Resell goods', type: 'REVENUE' } });
  const fcLunch = await prisma.financialCategory.create({ data: { name: 'Staff Lunch & Welfare', type: 'EXPENSE' } });
  const fcSupplies = await prisma.financialCategory.create({ data: { name: 'Ingredients & Supplies', type: 'EXPENSE' } });
  const fcUtilities = await prisma.financialCategory.create({ data: { name: 'Utilities (Electricity & Water)', type: 'EXPENSE' } });
  const fcPackaging = await prisma.financialCategory.create({ data: { name: 'Packaging & Logistics', type: 'EXPENSE' } });

  const catBread = await prisma.productCategory.create({ data: { name: 'Bread (Machine)', type: CategoryType.PRODUCED } });
  const catPastry = await prisma.productCategory.create({ data: { name: 'Pastry & Snacks', type: CategoryType.PRODUCED } });
  const catDairy = await prisma.productCategory.create({ data: { name: 'Dairy', type: CategoryType.RESELL } });
  const catInjera = await prisma.productCategory.create({ data: { name: 'Injera', type: CategoryType.RESELL } });

  // 4. Products Catalog
  console.log('🍞 [4/8] Seeding Product Catalog...');
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
    },
  ];

  const productMap = new Map<string, any>();
  for (const p of productsDef) {
    const prod = await prisma.product.create({ data: p });
    productMap.set(p.name, prod);
  }

  // 5. Raw Materials (Stock Items) with Initial Stock In
  console.log('📦 [5/8] Seeding Initial Raw Material Inventory...');
  const stockDefs = [
    { name: 'Wheat Flour (Special)', unitType: UnitType.KG, currentQuantity: 1000, minStockLevel: 150, unitPrice: 85 },
    { name: 'Dry Yeast', unitType: UnitType.KG, currentQuantity: 50, minStockLevel: 10, unitPrice: 420 },
    { name: 'Cooking Oil', unitType: UnitType.LITER, currentQuantity: 200, minStockLevel: 40, unitPrice: 190 },
    { name: 'Sugar', unitType: UnitType.KG, currentQuantity: 300, minStockLevel: 50, unitPrice: 110 },
    { name: 'Lentils', unitType: UnitType.KG, currentQuantity: 100, minStockLevel: 20, unitPrice: 140 },
  ];

  const stockMap = new Map<string, any>();
  for (const s of stockDefs) {
    const item = await prisma.stockItem.create({
      data: {
        name: s.name,
        unitType: s.unitType,
        currentQuantity: s.currentQuantity,
        minStockLevel: s.minStockLevel,
        unitPrice: s.unitPrice,
        branchId: branchMegenagna.id,
      },
    });
    stockMap.set(s.name, item);

    await prisma.stockMovement.create({
      data: {
        type: StockMovementType.IN,
        quantity: s.currentQuantity,
        reason: 'Initial opening inventory setup',
        stockItemId: item.id,
        userId: adminId,
      },
    });
  }

  // 6. Suppliers & Customers
  console.log('🤝 [6/8] Seeding Suppliers & Commercial Customers...');
  const supDairy = await prisma.supplier.create({
    data: { name: 'Bishoftu Fresh Dairy', phone: '0911887766', type: SupplierType.MILK, branchId: branchMegenagna.id },
  });
  const supInjera = await prisma.supplier.create({
    data: { name: 'Bole Injera Cooperative', phone: '0911554433', type: SupplierType.INJERA, branchId: branchMegenagna.id },
  });
  const supFlour = await prisma.supplier.create({
    data: { name: 'National Flour & Grain Corp', phone: '0911778899', type: SupplierType.GENERAL, branchId: branchMegenagna.id },
  });

  const custBlueCafe = await prisma.customer.create({
    data: {
      fullName: 'Megenagna Blue Cafe',
      phone: '0911998877',
      companyId: company.id,
      branchId: branchMegenagna.id,
      address: 'Near Megenagna Plaza',
    },
  });

  const custSunset = await prisma.customer.create({
    data: {
      fullName: 'Sunset Restaurant',
      phone: '0911882233',
      companyId: company.id,
      branchId: branchMegenagna.id,
      address: 'Zefmesh Mall 4th Floor',
    },
  });

  // 7. Generate 8-Day Cohesive Timeline
  console.log('📅 [7/8] Simulating 8 Consecutive Days of Business Cycles...');

  // Anchor today: 00:00:00 UTC
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));

  const daysData = [
    // DAY 1 (7 days ago) - CLOSED
    {
      dayIndex: 1,
      dateOffset: -7,
      status: SessionStatus.CLOSED,
      openingFloat: 1000,
      tomorrowFloat: 1200,
      production: [
        {
          items: [{ name: 'Bread', qty: 200 }, { name: 'Special Loaf Bread', qty: 40 }],
          materials: [{ name: 'Wheat Flour (Special)', qty: 50 }, { name: 'Dry Yeast', qty: 1.5 }, { name: 'Sugar', qty: 2 }],
        },
        {
          items: [{ name: 'Lentil Sambusa', qty: 80 }],
          materials: [{ name: 'Wheat Flour (Special)', qty: 8 }, { name: 'Cooking Oil', qty: 4 }, { name: 'Lentils', qty: 6 }],
        },
      ],
      deliveries: [
        { supplierId: supDairy.id, productName: 'Fresh Milk', qty: 50, buyPrice: 48, sellPrice: 60 },
        { supplierId: supInjera.id, productName: 'White Teff Injera', qty: 60, buyPrice: 32, sellPrice: 40 },
      ],
      conversions: [],
      expenses: [
        { category: 'Staff Lunch & Welfare', amount: 350, desc: 'Staff lunch shift #1' },
        { category: 'Ingredients & Supplies', amount: 150, desc: 'Sanitizing liquid' },
      ],
      leftovers: {
        'Bread': { remaining: 15, damaged: 5 },
        'Special Loaf Bread': { remaining: 5, damaged: 1 },
        'Lentil Sambusa': { remaining: 8, damaged: 2 },
        'Fresh Milk': { remaining: 8, damaged: 0 },
        'White Teff Injera': { remaining: 6, damaged: 2 },
      },
      cashBreakdown: { cash: 5140, telebirr: 2500, cbe: 1500 }, // Total = 9,140
      customerCredit: null,
      creditRepayment: null,
    },

    // DAY 2 (6 days ago) - CLOSED
    {
      dayIndex: 2,
      dateOffset: -6,
      status: SessionStatus.CLOSED,
      openingFloat: 1200,
      tomorrowFloat: 1500,
      production: [
        {
          items: [{ name: 'Bread', qty: 220 }, { name: 'Special Loaf Bread', qty: 45 }],
          materials: [{ name: 'Wheat Flour (Special)', qty: 55 }, { name: 'Dry Yeast', qty: 1.8 }, { name: 'Sugar', qty: 2.5 }],
        },
        {
          items: [{ name: 'Lentil Sambusa', qty: 90 }],
          materials: [{ name: 'Wheat Flour (Special)', qty: 9 }, { name: 'Cooking Oil', qty: 4.5 }, { name: 'Lentils', qty: 7 }],
        },
      ],
      deliveries: [
        { supplierId: supDairy.id, productName: 'Fresh Milk', qty: 40, buyPrice: 48, sellPrice: 60 },
        { supplierId: supInjera.id, productName: 'White Teff Injera', qty: 70, buyPrice: 32, sellPrice: 40 },
      ],
      conversions: [],
      expenses: [
        { category: 'Staff Lunch & Welfare', amount: 400, desc: 'Lunch shift #2' },
      ],
      leftovers: {
        'Bread': { remaining: 12, damaged: 3 },
        'Special Loaf Bread': { remaining: 6, damaged: 0 },
        'Lentil Sambusa': { remaining: 10, damaged: 2 },
        'Fresh Milk': { remaining: 5, damaged: 1 },
        'White Teff Injera': { remaining: 8, damaged: 2 },
      },
      cashBreakdown: { cash: 6190, telebirr: 3000, cbe: 1800 }, // Total = 10,990
      customerCredit: { customerId: custBlueCafe.id, amount: 600, desc: 'Blue Cafe morning supply credit' },
      creditRepayment: null,
    },

    // DAY 3 (5 days ago) - CLOSED
    {
      dayIndex: 3,
      dateOffset: -5,
      status: SessionStatus.CLOSED,
      openingFloat: 1500,
      tomorrowFloat: 1500,
      production: [
        {
          items: [{ name: 'Bread', qty: 240 }, { name: 'Special Loaf Bread', qty: 50 }],
          materials: [{ name: 'Wheat Flour (Special)', qty: 60 }, { name: 'Dry Yeast', qty: 2 }, { name: 'Sugar', qty: 3 }],
        },
        {
          items: [{ name: 'Lentil Sambusa', qty: 100 }],
          materials: [{ name: 'Wheat Flour (Special)', qty: 10 }, { name: 'Cooking Oil', qty: 5 }, { name: 'Lentils', qty: 8 }],
        },
      ],
      deliveries: [
        { supplierId: supDairy.id, productName: 'Fresh Milk', qty: 60, buyPrice: 48, sellPrice: 60 },
        { supplierId: supInjera.id, productName: 'White Teff Injera', qty: 80, buyPrice: 32, sellPrice: 40 },
      ],
      conversions: [
        { fromProduct: 'Bread', fromQty: 10, toProduct: 'Special Loaf Bread', toQty: 10 },
      ],
      expenses: [
        { category: 'Staff Lunch & Welfare', amount: 450, desc: 'Shift lunch' },
        { category: 'Utilities (Electricity & Water)', amount: 650, desc: 'Generator diesel top-up' },
      ],
      leftovers: {
        'Bread': { remaining: 18, damaged: 4 },
        'Special Loaf Bread': { remaining: 4, damaged: 2 },
        'Lentil Sambusa': { remaining: 12, damaged: 3 },
        'Fresh Milk': { remaining: 7, damaged: 0 },
        'White Teff Injera': { remaining: 10, damaged: 4 },
      },
      cashBreakdown: { cash: 6565, telebirr: 4000, cbe: 2000 }, // Expected: 1500 + 12165 - 1100 = 12565
      customerCredit: null,
      creditRepayment: null,
    },

    // DAY 4 (4 days ago) - CLOSED
    {
      dayIndex: 4,
      dateOffset: -4,
      status: SessionStatus.CLOSED,
      openingFloat: 1500,
      tomorrowFloat: 1800,
      stockRestock: [
        { stockItemName: 'Wheat Flour (Special)', qty: 500, reason: 'Bulk flour delivery from National Grain' },
        { stockItemName: 'Cooking Oil', qty: 50, reason: 'Refined palm oil restock' },
      ],
      production: [
        {
          items: [{ name: 'Bread', qty: 280 }, { name: 'Special Loaf Bread', qty: 60 }],
          materials: [{ name: 'Wheat Flour (Special)', qty: 70 }, { name: 'Dry Yeast', qty: 2.2 }, { name: 'Sugar', qty: 3.5 }],
        },
        {
          items: [{ name: 'Lentil Sambusa', qty: 120 }],
          materials: [{ name: 'Wheat Flour (Special)', qty: 12 }, { name: 'Cooking Oil', qty: 6 }, { name: 'Lentils', qty: 9 }],
        },
      ],
      deliveries: [
        { supplierId: supDairy.id, productName: 'Fresh Milk', qty: 70, buyPrice: 48, sellPrice: 60 },
        { supplierId: supInjera.id, productName: 'White Teff Injera', qty: 90, buyPrice: 32, sellPrice: 40 },
      ],
      conversions: [],
      expenses: [
        { category: 'Packaging & Logistics', amount: 500, desc: 'Branded paper bags' },
        { category: 'Staff Lunch & Welfare', amount: 400, desc: 'Lunch' },
      ],
      leftovers: {
        'Bread': { remaining: 22, damaged: 6 },
        'Special Loaf Bread': { remaining: 8, damaged: 1 },
        'Lentil Sambusa': { remaining: 15, damaged: 2 },
        'Fresh Milk': { remaining: 9, damaged: 0 },
        'White Teff Injera': { remaining: 12, damaged: 3 },
      },
      cashBreakdown: { cash: 7430, telebirr: 4500, cbe: 2500 }, // Total = 14,430
      customerCredit: null,
      creditRepayment: null,
    },

    // DAY 5 (3 days ago) - CLOSED
    {
      dayIndex: 5,
      dateOffset: -3,
      status: SessionStatus.CLOSED,
      openingFloat: 1800,
      tomorrowFloat: 1800,
      production: [
        {
          items: [{ name: 'Bread', qty: 260 }, { name: 'Special Loaf Bread', qty: 55 }],
          materials: [{ name: 'Wheat Flour (Special)', qty: 65 }, { name: 'Dry Yeast', qty: 2 }, { name: 'Sugar', qty: 3 }],
        },
        {
          items: [{ name: 'Lentil Sambusa', qty: 110 }],
          materials: [{ name: 'Wheat Flour (Special)', qty: 11 }, { name: 'Cooking Oil', qty: 5.5 }, { name: 'Lentils', qty: 8.5 }],
        },
      ],
      deliveries: [
        { supplierId: supDairy.id, productName: 'Fresh Milk', qty: 65, buyPrice: 48, sellPrice: 60 },
        { supplierId: supInjera.id, productName: 'White Teff Injera', qty: 85, buyPrice: 32, sellPrice: 40 },
      ],
      conversions: [],
      expenses: [
        { category: 'Staff Lunch & Welfare', amount: 450, desc: 'Staff lunch' },
        { category: 'Utilities (Electricity & Water)', amount: 300, desc: 'Water refill' },
      ],
      leftovers: {
        'Bread': { remaining: 20, damaged: 4 },
        'Special Loaf Bread': { remaining: 7, damaged: 1 },
        'Lentil Sambusa': { remaining: 14, damaged: 3 },
        'Fresh Milk': { remaining: 8, damaged: 1 },
        'White Teff Injera': { remaining: 11, damaged: 4 },
      },
      cashBreakdown: { cash: 7355, telebirr: 4200, cbe: 2800 }, // Total = 14,355
      customerCredit: { customerId: custSunset.id, amount: 2000, desc: 'Sunset Restaurant dinner event credit' },
      creditRepayment: null,
    },

    // DAY 6 (2 days ago) - CLOSED
    {
      dayIndex: 6,
      dateOffset: -2,
      status: SessionStatus.CLOSED,
      openingFloat: 1800,
      tomorrowFloat: 2000,
      production: [
        {
          items: [{ name: 'Bread', qty: 240 }, { name: 'Special Loaf Bread', qty: 50 }],
          materials: [{ name: 'Wheat Flour (Special)', qty: 60 }, { name: 'Dry Yeast', qty: 1.8 }, { name: 'Sugar', qty: 2.8 }],
        },
        {
          items: [{ name: 'Lentil Sambusa', qty: 100 }],
          materials: [{ name: 'Wheat Flour (Special)', qty: 10 }, { name: 'Cooking Oil', qty: 5 }, { name: 'Lentils', qty: 8 }],
        },
      ],
      deliveries: [
        { supplierId: supDairy.id, productName: 'Fresh Milk', qty: 60, buyPrice: 48, sellPrice: 60 },
        { supplierId: supInjera.id, productName: 'White Teff Injera', qty: 80, buyPrice: 32, sellPrice: 40 },
      ],
      conversions: [],
      expenses: [
        { category: 'Staff Lunch & Welfare', amount: 420, desc: 'Lunch' },
        { category: 'Packaging & Logistics', amount: 280, desc: 'Transport dispatch' },
      ],
      leftovers: {
        'Bread': { remaining: 16, damaged: 4 },
        'Special Loaf Bread': { remaining: 5, damaged: 2 },
        'Lentil Sambusa': { remaining: 12, damaged: 2 },
        'Fresh Milk': { remaining: 6, damaged: 0 },
        'White Teff Injera': { remaining: 9, damaged: 8 }, // Tested high spoilage
      },
      cashBreakdown: { cash: 6430, telebirr: 4200, cbe: 2800 }, // Total = 13,430
      customerCredit: null,
      creditRepayment: null,
    },

    // DAY 7 (1 day ago / Yesterday) - CLOSED
    {
      dayIndex: 7,
      dateOffset: -1,
      status: SessionStatus.CLOSED,
      openingFloat: 2000,
      tomorrowFloat: 2000,
      production: [
        {
          items: [{ name: 'Bread', qty: 260 }, { name: 'Special Loaf Bread', qty: 50 }],
          materials: [{ name: 'Wheat Flour (Special)', qty: 65 }, { name: 'Dry Yeast', qty: 2 }, { name: 'Sugar', qty: 3 }],
        },
        {
          items: [{ name: 'Lentil Sambusa', qty: 110 }],
          materials: [{ name: 'Wheat Flour (Special)', qty: 12 }, { name: 'Cooking Oil', qty: 6 }, { name: 'Lentils', qty: 9 }],
        },
      ],
      deliveries: [
        { supplierId: supDairy.id, productName: 'Fresh Milk', qty: 65, buyPrice: 48, sellPrice: 60 },
        { supplierId: supInjera.id, productName: 'White Teff Injera', qty: 85, buyPrice: 32, sellPrice: 40 },
      ],
      conversions: [],
      expenses: [
        { category: 'Staff Lunch & Welfare', amount: 450, desc: 'Lunch' },
        { category: 'Ingredients & Supplies', amount: 250, desc: 'Baking sheet parchment paper' },
      ],
      leftovers: {
        'Bread': { remaining: 18, damaged: 4 },
        'Special Loaf Bread': { remaining: 6, damaged: 1 },
        'Lentil Sambusa': { remaining: 14, damaged: 2 },
        'Fresh Milk': { remaining: 7, damaged: 1 },
        'White Teff Injera': { remaining: 10, damaged: 2 },
      },
      cashBreakdown: { cash: 7170, telebirr: 4300, cbe: 2700 }, // Total = 14,170
      customerCredit: null,
      creditRepayment: null,
    },

    // DAY 8 (TODAY) - OPEN
    {
      dayIndex: 8,
      dateOffset: 0,
      status: SessionStatus.OPEN,
      openingFloat: 2000, // Inherited from Day 7's tomorrowFloat!
      tomorrowFloat: null,
      production: [
        {
          items: [{ name: 'Bread', qty: 240 }, { name: 'Special Loaf Bread', qty: 45 }],
          materials: [{ name: 'Wheat Flour (Special)', qty: 60 }, { name: 'Dry Yeast', qty: 1.8 }, { name: 'Sugar', qty: 2.5 }],
        },
        {
          items: [{ name: 'Lentil Sambusa', qty: 95 }],
          materials: [{ name: 'Wheat Flour (Special)', qty: 10 }, { name: 'Cooking Oil', qty: 5 }, { name: 'Lentils', qty: 8 }],
        },
      ],
      deliveries: [
        { supplierId: supDairy.id, productName: 'Fresh Milk', qty: 50, buyPrice: 48, sellPrice: 60 },
        { supplierId: supInjera.id, productName: 'White Teff Injera', qty: 70, buyPrice: 32, sellPrice: 40 },
      ],
      conversions: [],
      expenses: [
        { category: 'Staff Lunch & Welfare', amount: 400, desc: 'Today staff lunch' },
      ],
      leftovers: null, // NOT finalized yet! Ready for user to test in UI
      cashBreakdown: null,
      customerCredit: null,
      creditRepayment: null,
    },
  ];

  for (const day of daysData) {
    const sessionDate = new Date(today);
    sessionDate.setDate(today.getDate() + day.dateOffset);

    console.log(`\n⏳ Seeding Day ${day.dayIndex} (${sessionDate.toISOString().slice(0, 10)}) [${day.status}]...`);

    // Create Daily Session
    const session = await prisma.dailySession.create({
      data: {
        date: sessionDate,
        branchId: branchMegenagna.id,
        status: day.status,
        label: `Megenagna Shift (Day ${day.dayIndex})`,
        openingCashFloat: day.openingFloat,
        actualCashAmount: day.cashBreakdown?.cash ?? null,
        actualTelebirrAmount: day.cashBreakdown?.telebirr ?? null,
        actualCbeAmount: day.cashBreakdown?.cbe ?? null,
        cashLeftoverAmount: day.tomorrowFloat,
        notes: day.status === SessionStatus.CLOSED ? `Day ${day.dayIndex} finalized & reconciled.` : 'Shift in progress.',
      },
    });

    // Handle any raw stock restock on this day
    if ((day as any).stockRestock) {
      for (const r of (day as any).stockRestock) {
        const item = stockMap.get(r.stockItemName);
        if (item) {
          await prisma.stockItem.update({
            where: { id: item.id },
            data: { currentQuantity: { increment: r.qty } },
          });
          await prisma.stockMovement.create({
            data: {
              stockItemId: item.id,
              userId: adminId,
              quantity: r.qty,
              type: StockMovementType.IN,
              reason: r.reason,
              createdAt: sessionDate,
            },
          });
        }
      }
    }

    // Handle Production Batches
    for (const batchDef of day.production) {
      const batch = await prisma.productionBatch.create({
        data: {
          branchId: branchMegenagna.id,
          userId: bakerId,
          sessionId: session.id,
          date: sessionDate,
          shift: Shift.DAY,
          status: BatchStatus.COMPLETED,
          createdAt: sessionDate,
          items: {
            create: batchDef.items.map((i) => ({
              productId: productMap.get(i.name).id,
              quantityProduced: i.qty,
            })),
          },
          materialUsages: {
            create: batchDef.materials.map((m) => ({
              stockItemId: stockMap.get(m.name).id,
              quantityUsed: m.qty,
            })),
          },
        },
      });

      // Deduct raw material inventory & create stock movement
      for (const m of batchDef.materials) {
        const stockItem = stockMap.get(m.name);
        await safeOp(async () => {
          await prisma.stockItem.update({
            where: { id: stockItem.id },
            data: { currentQuantity: { decrement: m.qty } },
          });

          await prisma.stockMovement.create({
            data: {
              stockItemId: stockItem.id,
              userId: bakerId,
              quantity: m.qty,
              type: StockMovementType.PRODUCTION_USAGE,
              reason: `Batch Production Usage (Day ${day.dayIndex})`,
              createdAt: sessionDate,
            },
          });
        });
      }
    }

    // Handle Supplier Deliveries
    for (const del of day.deliveries) {
      const prod = productMap.get(del.productName);
      await prisma.supplierDelivery.create({
        data: {
          supplierId: del.supplierId,
          productId: prod.id,
          quantityReceived: del.qty,
          returnedQuantity: 0,
          unitBuyPrice: del.buyPrice,
          unitSellPrice: del.sellPrice,
          sessionId: session.id,
          paymentSource: DeliveryPaymentSource.DAILY_CASH,
          isPaid: true,
          createdAt: sessionDate,
        },
      });
    }

    // Handle Product Conversions
    for (const conv of day.conversions) {
      const fromP = productMap.get(conv.fromProduct);
      const toP = productMap.get(conv.toProduct);
      await prisma.productConversion.create({
        data: {
          branchId: branchMegenagna.id,
          userId: bakerId,
          fromProductId: fromP.id,
          toProductId: toP.id,
          fromQuantity: conv.fromQty,
          toQuantity: conv.toQty,
          createdAt: sessionDate,
        },
      });
    }

    // Handle Shift Expenses
    for (const exp of day.expenses) {
      await prisma.expense.create({
        data: {
          branchId: branchMegenagna.id,
          userId: cashierId,
          sessionId: session.id,
          date: sessionDate,
          amount: exp.amount,
          category: exp.category,
          description: exp.desc,
          type: ExpenseType.COMPANY,
          createdAt: sessionDate,
        },
      });
    }

    // Handle Customer Credit
    if (day.customerCredit) {
      await prisma.customerCredit.create({
        data: {
          customerId: day.customerCredit.customerId,
          branchId: branchMegenagna.id,
          sessionId: session.id,
          amount: day.customerCredit.amount,
          paidAmount: 0,
          remainingBalance: day.customerCredit.amount,
          status: CreditStatus.OPEN,
          description: day.customerCredit.desc,
          date: sessionDate,
          createdAt: sessionDate,
        },
      });
    }

    // Handle Leftovers & Sales Derivation for CLOSED days
    if (day.status === SessionStatus.CLOSED && day.leftovers) {
      // 1. Create Leftover Records
      for (const [prodName, l] of Object.entries(day.leftovers)) {
        const prod = productMap.get(prodName);
        await prisma.leftoverRecord.create({
          data: {
            sessionId: session.id,
            productId: prod.id,
            quantityRemaining: l.remaining,
            damagedQuantity: l.damaged,
            damageReason: l.damaged > 0 ? 'End of shift quality inspection' : null,
          },
        });
      }

      // 2. Derive Sale Items according to system formula:
      // Available = Opening + Produced + Delivered + ConvertedIn - ConvertedOut
      // Sold = Available - Leftover - Damaged
      // We also derive opening leftovers from previous day:
      const prevSession = await prisma.dailySession.findFirst({
        where: {
          branchId: branchMegenagna.id,
          status: SessionStatus.CLOSED,
          date: { lt: sessionDate },
        },
        include: { leftoverRecords: true },
        orderBy: { date: 'desc' },
      });

      const openingByProduct: Record<string, number> = {};
      for (const r of prevSession?.leftoverRecords ?? []) {
        openingByProduct[r.productId] = (openingByProduct[r.productId] ?? 0) + r.quantityRemaining;
      }

      const saleLineItems: { productId: string; quantity: number; unitPrice: number; subtotal: number }[] = [];
      let totalSalesAmount = 0;

      for (const [prodName, l] of Object.entries(day.leftovers)) {
        const prod = productMap.get(prodName);
        const opening = openingByProduct[prod.id] ?? 0;

        // Produced today
        const produced = day.production.reduce((sum, b) => {
          const item = b.items.find((i) => i.name === prodName);
          return sum + (item ? item.qty : 0);
        }, 0);

        // Delivered today
        const delivered = day.deliveries
          .filter((d) => d.productName === prodName)
          .reduce((sum, d) => sum + d.qty, 0);

        // Conversions
        const convertedOut = day.conversions
          .filter((c) => c.fromProduct === prodName)
          .reduce((sum, c) => sum + c.fromQty, 0);
        const convertedIn = day.conversions
          .filter((c) => c.toProduct === prodName)
          .reduce((sum, c) => sum + c.toQty, 0);

        const available = opening + produced + delivered + convertedIn - convertedOut;
        const sold = Math.max(0, available - l.remaining - l.damaged);
        const unitPrice = Number(prod.basePrice);
        const subtotal = sold * unitPrice;

        totalSalesAmount += subtotal;
        saleLineItems.push({
          productId: prod.id,
          quantity: sold,
          unitPrice,
          subtotal,
        });
      }

      // Create Sale Record
      await prisma.sale.create({
        data: {
          sessionId: session.id,
          userId: cashierId,
          totalAmount: totalSalesAmount,
          paymentMethod: PaymentMethod.CASH,
          createdAt: sessionDate,
          items: {
            create: saleLineItems.map((s) => ({
              productId: s.productId,
              quantity: s.quantity,
              unitPrice: s.unitPrice,
              subtotal: s.subtotal,
            })),
          },
        },
      });
    } else if (day.status === SessionStatus.OPEN) {
      // Day 8 (TODAY): Add 2 sample in-shift POS sales
      const breadProd = productMap.get('Bread');
      const milkProd = productMap.get('Fresh Milk');
      const sambusaProd = productMap.get('Lentil Sambusa');

      await prisma.sale.create({
        data: {
          sessionId: session.id,
          userId: cashierId,
          totalAmount: 320,
          paymentMethod: PaymentMethod.CASH,
          items: {
            create: [
              { productId: breadProd.id, quantity: 20, unitPrice: 10, subtotal: 200 },
              { productId: milkProd.id, quantity: 2, unitPrice: 60, subtotal: 120 },
            ],
          },
        },
      });

      await prisma.sale.create({
        data: {
          sessionId: session.id,
          userId: cashierId,
          totalAmount: 150,
          paymentMethod: PaymentMethod.TELEBIRR,
          items: {
            create: [
              { productId: sambusaProd.id, quantity: 10, unitPrice: 15, subtotal: 150 },
            ],
          },
        },
      });
    }

    await new Promise((r) => setTimeout(r, 150));
  }

  // 8. Staff Payroll & Owner Loans
  console.log('💼 [8/8] Seeding Staff Loans, Penalties, and Owner Capital Drawdowns...');
  await safeOp(async () => {
    const ownerLoan = await prisma.loan.create({
      data: {
        userId: ownerId,
        branchId: branchMegenagna.id,
        totalAmount: 25000,
        remainingBalance: 20000,
        type: LoanType.OWNER_LOAN,
        status: LoanStatus.OPEN,
      },
    });

    await prisma.loanPayment.create({
      data: {
        loanId: ownerLoan.id,
        amountPaid: 5000,
        date: new Date(),
      },
    });

    await prisma.loan.create({
      data: {
        userId: bakerId,
        branchId: branchMegenagna.id,
        totalAmount: 2000,
        remainingBalance: 2000,
        type: LoanType.SALARY_ADVANCE,
        status: LoanStatus.OPEN,
      },
    });

    await prisma.penalty.create({
      data: {
        userId: userMap.get(Role.EMPLOYEE)!,
        amount: 300,
        reason: 'Unexcused late arrival on Saturday morning shift',
        date: new Date(),
        status: ApprovalStatus.APPROVED,
        isDeducted: false,
      },
    });
  });

  console.log('\n=============================================================');
  console.log('✅ 8-Day Cohesive Bakery ERP Dataset Seeding Complete!');
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
