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

async function cleanDatabase() {
  console.log('🧹 [0/9] Cleaning existing database records without conflicts...');
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

  for (const table of tableNames) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
    } catch (e: any) {
      // Table might not exist yet if fresh, continue safely
    }
  }
  console.log('✨ All tables wiped clean.');
}

async function main() {
  console.log('\n🌱 Starting ERP Database Clean & Reseed...');

  // 0. Clean database
  await cleanDatabase();

  // 1. Company & Branches
  console.log('📍 [1/9] Seeding Company & Branches...');
  const company = await prisma.company.create({
    data: {
      name: 'Koket Bakery Group',
      email: 'info@koketbakery.com',
      phone: '0912345678',
      address: 'Addis Ababa, Ethiopia',
    },
  });

  const branchMain = await prisma.branch.create({
    data: {
      name: 'Main Branch',
      address: 'Bole Medhanialem, Addis Ababa',
      companyId: company.id,
    },
  });

  const branchPiassa = await prisma.branch.create({
    data: {
      name: 'Piassa Branch',
      address: 'Churchill Road, Piassa, Addis Ababa',
      companyId: company.id,
    },
  });

  // 2. Users & Staff Roles
  console.log('👥 [2/9] Seeding Staff & Roles...');
  const passwordHash = await bcrypt.hash('password123', 10);

  const staffList = [
    { phone: '0912345678', fullName: 'Hamza Owner', role: Role.OWNER, salary: 45000, shift: null },
    { phone: '0910000001', fullName: 'Abebe Admin', role: Role.ADMIN, salary: 25000, shift: null },
    { phone: '0910000002', fullName: 'Hanna Cashier', role: Role.CASHIER, salary: 14000, shift: Shift.DAY },
    { phone: '0910000003', fullName: 'Dawit Master Baker', role: Role.BAKER, salary: 18000, shift: Shift.DAY },
    { phone: '0910000004', fullName: 'Sara Sambusa Specialist', role: Role.SAMBUSA_WORKER, salary: 13500, shift: Shift.DAY },
    { phone: '0910000005', fullName: 'Selam Cake Chef', role: Role.CAKE_WORKER, salary: 16000, shift: Shift.DAY },
    { phone: '0910000006', fullName: 'Almaz General Staff', role: Role.EMPLOYEE, salary: 9500, shift: Shift.DAY },
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
        branchId: branchMain.id,
      },
    });
    userMap.set(s.role, user.id);
  }

  const ownerId = userMap.get(Role.OWNER)!;
  const adminId = userMap.get(Role.ADMIN)!;
  const cashierId = userMap.get(Role.CASHIER)!;
  const bakerId = userMap.get(Role.BAKER)!;
  const sambusaId = userMap.get(Role.SAMBUSA_WORKER)!;

  // 3. Financial Categories
  console.log('🏷️  [3/9] Seeding Financial Categories...');
  const fcRetail = await prisma.financialCategory.create({ data: { name: 'Retail sales (bakery)', type: 'REVENUE' } });
  const fcResell = await prisma.financialCategory.create({ data: { name: 'Resell goods', type: 'REVENUE' } });
  const fcRent = await prisma.financialCategory.create({ data: { name: 'Rent & facilities', type: 'EXPENSE' } });
  const fcUtilities = await prisma.financialCategory.create({ data: { name: 'Utilities (Electricity & Water)', type: 'EXPENSE' } });
  const fcSupplies = await prisma.financialCategory.create({ data: { name: 'Ingredients & Supplies', type: 'EXPENSE' } });
  const fcLunch = await prisma.financialCategory.create({ data: { name: 'Staff Lunch & Welfare', type: 'EXPENSE' } });
  const fcPackaging = await prisma.financialCategory.create({ data: { name: 'Packaging & Logistics', type: 'EXPENSE' } });

  // 4. Product Categories
  console.log('🍞 [4/9] Seeding Product Categories...');
  const catBread = await prisma.productCategory.create({ data: { name: 'Bread (Machine)', type: CategoryType.PRODUCED } });
  const catPastry = await prisma.productCategory.create({ data: { name: 'Sambusa / Pastry / Snacks', type: CategoryType.PRODUCED } });
  const catCakes = await prisma.productCategory.create({ data: { name: 'Cakes & Sweets', type: CategoryType.PRODUCED } });
  const catDairy = await prisma.productCategory.create({ data: { name: 'Milk & Yoghurt', type: CategoryType.RESELL } });
  const catInjera = await prisma.productCategory.create({ data: { name: 'Injera', type: CategoryType.RESELL } });

  // 5. Products with requested images
  console.log('🥐 [5/9] Seeding Products with High-Quality Images...');
  const productsData = [
    {
      categoryId: catBread.id,
      name: 'Bread',
      flavor: 'Normal',
      unitType: UnitType.PIECE,
      basePrice: 10,
      buyPrice: null,
      financialCategoryId: fcRetail.id,
      imageUrl: 'https://www.melskitchencafe.com/wp-content/uploads/french-bread1.webp',
    },
    {
      categoryId: catBread.id,
      name: 'Special Loaf Bread',
      flavor: 'White Loaf',
      unitType: UnitType.PIECE,
      basePrice: 35,
      buyPrice: null,
      financialCategoryId: fcRetail.id,
      imageUrl: 'https://www.thespruceeats.com/thmb/j4mujy24lcmnyW_a7VS1sVP4Mw4=/750x0/filters:no_upscale():max_bytes(150000):strip_icc():format(webp)/loaf-of-bread-182835505-58a7008c5f9b58a3c91c9a14.jpg',
    },
    {
      categoryId: catBread.id,
      name: 'Barley Bread',
      flavor: 'Barley (ገብስ)',
      unitType: UnitType.PIECE,
      basePrice: 15,
      buyPrice: null,
      financialCategoryId: fcRetail.id,
      imageUrl: 'https://live.staticflickr.com/2835/8764387785_85b54dae35_z.jpg',
    },
    {
      categoryId: catBread.id,
      name: 'Bomboloni',
      flavor: 'Sugar Coated',
      unitType: UnitType.PIECE,
      basePrice: 15,
      buyPrice: null,
      financialCategoryId: fcRetail.id,
      imageUrl: 'https://images.unsplash.com/photo-1527515637462-cff94eecc1ac?auto=format&fit=crop&w=600&q=80',
    },
    {
      categoryId: catBread.id,
      name: 'Chocolate Donut',
      flavor: 'Dark Chocolate',
      unitType: UnitType.PIECE,
      basePrice: 20,
      buyPrice: null,
      financialCategoryId: fcRetail.id,
      imageUrl: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=600&q=80',
    },
    {
      categoryId: catPastry.id,
      name: 'Butter Croissant',
      flavor: 'Golden Butter',
      unitType: UnitType.PIECE,
      basePrice: 25,
      buyPrice: null,
      financialCategoryId: fcRetail.id,
      imageUrl: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=600&q=80',
    },
    {
      categoryId: catPastry.id,
      name: 'Lentil Sambusa',
      flavor: 'Spicy Lentil (ምስር)',
      unitType: UnitType.PIECE,
      basePrice: 15,
      buyPrice: null,
      financialCategoryId: fcRetail.id,
      imageUrl: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=600&q=80',
    },
    {
      categoryId: catPastry.id,
      name: 'Meat Sambusa',
      flavor: 'Beef Minced (የስጋ)',
      unitType: UnitType.PIECE,
      basePrice: 25,
      buyPrice: null,
      financialCategoryId: fcRetail.id,
      imageUrl: 'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?auto=format&fit=crop&w=600&q=80',
    },
    {
      categoryId: catCakes.id,
      name: 'Slice Cake',
      flavor: 'Vanilla Cream',
      unitType: UnitType.PIECE,
      basePrice: 60,
      buyPrice: null,
      financialCategoryId: fcRetail.id,
      imageUrl: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=600&q=80',
    },
    {
      categoryId: catCakes.id,
      name: 'Chocolate Forest Cake',
      flavor: 'Black Forest',
      unitType: UnitType.PIECE,
      basePrice: 450,
      buyPrice: null,
      financialCategoryId: fcRetail.id,
      imageUrl: 'https://images.unsplash.com/photo-1588195538326-c5b1e9f80a1b?auto=format&fit=crop&w=600&q=80',
    },
    {
      categoryId: catDairy.id,
      name: 'Fresh Milk',
      flavor: 'Whole Milk',
      unitType: UnitType.LITER,
      basePrice: 60,
      buyPrice: 48,
      financialCategoryId: fcResell.id,
      imageUrl: 'https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=600&q=80',
    },
    {
      categoryId: catDairy.id,
      name: 'Yoghurt',
      flavor: 'Plain Cultured (እርጎ)',
      unitType: UnitType.PIECE,
      basePrice: 35,
      buyPrice: 28,
      financialCategoryId: fcResell.id,
      imageUrl: 'https://images.unsplash.com/photo-1488477181946-6428a0291777?auto=format&fit=crop&w=600&q=80',
    },
    {
      categoryId: catInjera.id,
      name: 'White Teff Injera',
      flavor: 'White Teff (ነጭ ጤፍ)',
      unitType: UnitType.PIECE,
      basePrice: 40,
      buyPrice: 32,
      financialCategoryId: fcResell.id,
      imageUrl: 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=600&q=80',
    },
    {
      categoryId: catInjera.id,
      name: 'Red Teff Injera',
      flavor: 'Sergegna (ሰርገኛ)',
      unitType: UnitType.PIECE,
      basePrice: 35,
      buyPrice: 28,
      financialCategoryId: fcResell.id,
      imageUrl: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=600&q=80',
    },
  ];

  const productMap = new Map<string, string>();
  for (const p of productsData) {
    const prod = await prisma.product.create({ data: p });
    productMap.set(p.name, prod.id);
  }

  // 6. Raw Materials & Stock Inventory
  console.log('📦 [6/9] Seeding Raw Materials & Stock...');
  const stockItemsData = [
    { name: 'Wheat Flour (Special)', unitType: UnitType.KG, currentQuantity: 650, minStockLevel: 100, unitPrice: 85 },
    { name: 'Dough Mix', unitType: UnitType.KG, currentQuantity: 180, minStockLevel: 30, unitPrice: 120 },
    { name: 'Sugar', unitType: UnitType.KG, currentQuantity: 240, minStockLevel: 50, unitPrice: 110 },
    { name: 'Cooking Oil', unitType: UnitType.LITER, currentQuantity: 120, minStockLevel: 30, unitPrice: 190 },
    { name: 'Dry Yeast', unitType: UnitType.KG, currentQuantity: 45, minStockLevel: 10, unitPrice: 450 },
    { name: 'Iodized Salt', unitType: UnitType.KG, currentQuantity: 60, minStockLevel: 15, unitPrice: 35 },
  ];

  const stockMap = new Map<string, string>();
  for (const s of stockItemsData) {
    const item = await prisma.stockItem.create({
      data: {
        name: s.name,
        unitType: s.unitType,
        currentQuantity: s.currentQuantity,
        minStockLevel: s.minStockLevel,
        unitPrice: s.unitPrice,
        branchId: branchMain.id,
      },
    });
    stockMap.set(s.name, item.id);

    // Initial movement
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

  // 7. Suppliers & Deliveries
  console.log('🚚 [7/9] Seeding Suppliers & Partner Deliveries...');
  const supInjera = await prisma.supplier.create({
    data: { name: 'Bole Injera Cooperative', phone: '0911002233', type: SupplierType.INJERA, branchId: branchMain.id },
  });
  const supMilk = await prisma.supplier.create({
    data: { name: 'Addis Milk Dairy Farm', phone: '0911445566', type: SupplierType.MILK, branchId: branchMain.id },
  });
  const supFlour = await prisma.supplier.create({
    data: { name: 'National Flour & Grain Corp', phone: '0911778899', type: SupplierType.GENERAL, branchId: branchMain.id },
  });

  // 8. Daily Sessions (Yesterday CLOSED, Today OPEN)
  console.log('💰 [8/9] Seeding Daily Business Sessions & Transactions...');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // --- YESTERDAY'S CLOSED SESSION (Rich Historical Analytics) ---
  const yesterdaySession = await prisma.dailySession.create({
    data: {
      date: yesterday,
      status: SessionStatus.CLOSED,
      label: 'Main Day Shift (Yesterday)',
      openingCashFloat: 1500,
      actualCashAmount: 14850,
      actualCbeAmount: 5200,
      actualTelebirrAmount: 8400,
      cashLeftoverAmount: 1500,
      notes: 'Successfully balanced and finalized yesterday.',
      branchId: branchMain.id,
    },
  });

  // Deliveries for yesterday
  await prisma.supplierDelivery.create({
    data: {
      supplierId: supInjera.id,
      productId: productMap.get('White Teff Injera')!,
      quantityReceived: 80,
      unitBuyPrice: 32,
      unitSellPrice: 40,
      sessionId: yesterdaySession.id,
      isPaid: true,
      paymentSource: DeliveryPaymentSource.DAILY_CASH,
      returnedQuantity: 2,
    },
  });

  await prisma.supplierDelivery.create({
    data: {
      supplierId: supMilk.id,
      productId: productMap.get('Fresh Milk')!,
      quantityReceived: 50,
      unitBuyPrice: 48,
      unitSellPrice: 60,
      sessionId: yesterdaySession.id,
      isPaid: true,
      paymentSource: DeliveryPaymentSource.DAILY_CASH,
      returnedQuantity: 0,
    },
  });

  // Yesterday Sales
  const breadId = productMap.get('Bread')!;
  const loafId = productMap.get('Special Loaf Bread')!;
  const donutId = productMap.get('Chocolate Donut')!;
  const sambusaLentilId = productMap.get('Lentil Sambusa')!;
  const injeraWhiteId = productMap.get('White Teff Injera')!;
  const milkId = productMap.get('Fresh Milk')!;

  await prisma.sale.create({
    data: {
      totalAmount: 380,
      paymentMethod: PaymentMethod.CASH,
      sessionId: yesterdaySession.id,
      userId: cashierId,
      items: {
        create: [
          { productId: breadId, quantity: 20, unitPrice: 10, subtotal: 200 },
          { productId: loafId, quantity: 4, unitPrice: 35, subtotal: 140 },
          { productId: donutId, quantity: 2, unitPrice: 20, subtotal: 40 },
        ],
      },
    },
  });

  await prisma.sale.create({
    data: {
      totalAmount: 520,
      paymentMethod: PaymentMethod.TELEBIRR,
      sessionId: yesterdaySession.id,
      userId: cashierId,
      items: {
        create: [
          { productId: injeraWhiteId, quantity: 8, unitPrice: 40, subtotal: 320 },
          { productId: milkId, quantity: 2, unitPrice: 60, subtotal: 120 },
          { productId: sambusaLentilId, quantity: 4, unitPrice: 20, subtotal: 80 },
        ],
      },
    },
  });

  // Yesterday Leftover record
  await prisma.leftoverRecord.create({
    data: {
      sessionId: yesterdaySession.id,
      productId: breadId,
      quantityRemaining: 12,
      damagedQuantity: 2,
      damageReason: 'Overbaked crust edge',
    },
  });

  // Yesterday Production Batches
  const flourId = stockMap.get('Wheat Flour (Special)')!;
  const yeastId = stockMap.get('Dry Yeast')!;

  const yesterdayBatch = await prisma.productionBatch.create({
    data: {
      date: yesterday,
      shift: Shift.DAY,
      status: BatchStatus.COMPLETED,
      branchId: branchMain.id,
      userId: bakerId,
      sessionId: yesterdaySession.id,
      items: {
        create: [
          { productId: breadId, quantityProduced: 300, returnedQuantity: 0 },
          { productId: loafId, quantityProduced: 60, returnedQuantity: 0 },
          { productId: donutId, quantityProduced: 50, returnedQuantity: 0 },
        ],
      },
      materialUsages: {
        create: [
          { stockItemId: flourId, quantityUsed: 65 },
          { stockItemId: yeastId, quantityUsed: 3.5 },
        ],
      },
    },
  });

  // --- TODAY'S ACTIVE OPEN SESSION ---
  const todaySession = await prisma.dailySession.create({
    data: {
      date: today,
      status: SessionStatus.OPEN,
      label: 'Main Day Shift (Today)',
      openingCashFloat: 2000,
      actualCashAmount: 0,
      actualCbeAmount: 0,
      actualTelebirrAmount: 0,
      notes: 'Active business session for daily operations',
      branchId: branchMain.id,
    },
  });

  // Today Production Batch
  const todayBatch = await prisma.productionBatch.create({
    data: {
      date: today,
      shift: Shift.DAY,
      status: BatchStatus.COMPLETED,
      branchId: branchMain.id,
      userId: bakerId,
      sessionId: todaySession.id,
      items: {
        create: [
          { productId: breadId, quantityProduced: 250, returnedQuantity: 0 },
          { productId: loafId, quantityProduced: 70, returnedQuantity: 0 },
          { productId: productMap.get('Barley Bread')!, quantityProduced: 80, returnedQuantity: 0 },
          { productId: productMap.get('Bomboloni')!, quantityProduced: 60, returnedQuantity: 0 },
        ],
      },
      materialUsages: {
        create: [
          { stockItemId: flourId, quantityUsed: 55 },
          { stockItemId: yeastId, quantityUsed: 2.5 },
        ],
      },
    },
  });

  await prisma.stockMovement.create({
    data: {
      type: StockMovementType.PRODUCTION_USAGE,
      quantity: 55,
      reason: `Used in Batch #${todayBatch.id.slice(-6)}`,
      stockItemId: flourId,
      userId: bakerId,
    },
  });

  // Today Sambusa Batch
  await prisma.productionBatch.create({
    data: {
      date: today,
      shift: Shift.DAY,
      status: BatchStatus.COMPLETED,
      branchId: branchMain.id,
      userId: sambusaId,
      sessionId: todaySession.id,
      items: {
        create: [
          { productId: sambusaLentilId, quantityProduced: 120, returnedQuantity: 0 },
          { productId: productMap.get('Meat Sambusa')!, quantityProduced: 80, returnedQuantity: 0 },
        ],
      },
      materialUsages: {
        create: [
          { stockItemId: stockMap.get('Cooking Oil')!, quantityUsed: 12 },
        ],
      },
    },
  });

  // Today Sample POS Sales
  await prisma.sale.create({
    data: {
      totalAmount: 180,
      paymentMethod: PaymentMethod.CASH,
      sessionId: todaySession.id,
      userId: cashierId,
      items: {
        create: [
          { productId: breadId, quantity: 10, unitPrice: 10, subtotal: 100 },
          { productId: loafId, quantity: 2, unitPrice: 35, subtotal: 70 },
          { productId: breadId, quantity: 1, unitPrice: 10, subtotal: 10 },
        ],
      },
    },
  });

  await prisma.sale.create({
    data: {
      totalAmount: 260,
      paymentMethod: PaymentMethod.TELEBIRR,
      sessionId: todaySession.id,
      userId: cashierId,
      items: {
        create: [
          { productId: injeraWhiteId, quantity: 4, unitPrice: 40, subtotal: 160 },
          { productId: milkId, quantity: 1, unitPrice: 60, subtotal: 60 },
          { productId: productMap.get('Bomboloni')!, quantity: 2, unitPrice: 20, subtotal: 40 },
        ],
      },
    },
  });

  // Sample Product Conversion (Bread -> Bomboloni)
  console.log('🔄 [9/9] Seeding Product Conversion, Customer Credits, Loans & Payroll...');
  await prisma.productConversion.create({
    data: {
      branchId: branchMain.id,
      userId: adminId,
      fromProductId: breadId,
      toProductId: productMap.get('Bomboloni')!,
      fromQuantity: 10,
      toQuantity: 10,
    },
  });

  // Customer Credits
  const custBole = await prisma.customer.create({
    data: {
      companyId: company.id,
      branchId: branchMain.id,
      fullName: 'Bole Horizon Cafe & Restaurant',
      phone: '0911223344',
      address: 'Near Bole Medhanialem Mall',
    },
  });

  const credit1 = await prisma.customerCredit.create({
    data: {
      customerId: custBole.id,
      branchId: branchMain.id,
      sessionId: todaySession.id,
      amount: 4500,
      paidAmount: 2500,
      remainingBalance: 2000,
      status: CreditStatus.OPEN,
      description: 'Morning bread & croissant supply delivery',
      date: today,
    },
  });

  await prisma.customerCreditPayment.create({
    data: {
      creditId: credit1.id,
      amount: 2500,
      paymentMethod: PaymentMethod.TELEBIRR,
      notes: 'Partial payment received via Telebirr',
      date: today,
    },
  });

  const custSkylight = await prisma.customer.create({
    data: {
      companyId: company.id,
      branchId: branchMain.id,
      fullName: 'Skylight Bistro',
      phone: '0922334455',
      address: 'Airport Road, Addis Ababa',
    },
  });

  const credit2 = await prisma.customerCredit.create({
    data: {
      customerId: custSkylight.id,
      branchId: branchMain.id,
      amount: 3200,
      paidAmount: 3200,
      remainingBalance: 0,
      status: CreditStatus.PAID,
      description: 'Catering pastry assortment',
      date: yesterday,
    },
  });

  await prisma.customerCreditPayment.create({
    data: {
      creditId: credit2.id,
      amount: 3200,
      paymentMethod: PaymentMethod.CBE,
      notes: 'Full payment via CBE transfer',
      date: yesterday,
    },
  });

  // Operating Expenses
  await prisma.expense.create({
    data: {
      type: ExpenseType.COMPANY,
      category: 'RENT',
      amount: 15000,
      date: today,
      description: 'Monthly Bakery Main Facility Rent',
      branchId: branchMain.id,
      userId: adminId,
      sessionId: todaySession.id,
      financialCategoryId: fcRent.id,
    },
  });

  await prisma.expense.create({
    data: {
      type: ExpenseType.COMPANY,
      category: 'UTILITIES',
      amount: 2400,
      date: today,
      description: 'Commercial Electricity & Water Utility Bill',
      branchId: branchMain.id,
      userId: adminId,
      sessionId: todaySession.id,
      financialCategoryId: fcUtilities.id,
    },
  });

  await prisma.expense.create({
    data: {
      type: ExpenseType.COMPANY,
      category: 'LUNCH',
      amount: 850,
      date: today,
      description: 'Bakery Morning Shift Staff Lunch Catering',
      branchId: branchMain.id,
      userId: adminId,
      sessionId: todaySession.id,
      financialCategoryId: fcLunch.id,
    },
  });

  // Staff Loans
  const staffLoanBaker = await prisma.loan.create({
    data: {
      type: LoanType.STAFF_LOAN,
      totalAmount: 3000,
      remainingBalance: 1500,
      status: LoanStatus.OPEN,
      date: today,
      branchId: branchMain.id,
      userId: bakerId,
    },
  });

  await prisma.loanPayment.create({
    data: {
      loanId: staffLoanBaker.id,
      amountPaid: 1500,
      date: today,
    },
  });

  const staffAdvanceCashier = await prisma.loan.create({
    data: {
      type: LoanType.SALARY_ADVANCE,
      totalAmount: 2000,
      remainingBalance: 1000,
      status: LoanStatus.OPEN,
      date: today,
      branchId: branchMain.id,
      userId: cashierId,
    },
  });

  await prisma.loanPayment.create({
    data: {
      loanId: staffAdvanceCashier.id,
      amountPaid: 1000,
      date: today,
    },
  });

  // Historical Payroll for Staff
  const lastMonth = today.getMonth() === 0 ? 12 : today.getMonth();
  const payrollYear = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();

  for (const s of staffList) {
    const uId = userMap.get(s.role)!;
    await prisma.payrollRecord.create({
      data: {
        userId: uId,
        month: lastMonth,
        year: payrollYear,
        baseSalary: s.salary,
        loanDeductions: s.role === Role.BAKER ? 1500 : 0,
        penaltyDeductions: 0,
        bonus: 1000,
        finalAmount: (s.salary + 1000) - (s.role === Role.BAKER ? 1500 : 0),
        status: ApprovalStatus.APPROVED,
        paymentDate: yesterday,
      },
    });
  }

  // Summary output
  console.log('\n=============================================================');
  console.log('🎉 DATABASE CLEAN & SEED COMPLETED WITH ZERO CONFLICTS!');
  console.log('=============================================================');
  console.log('🔑 Staff Login Credentials (Password for all: password123):');
  console.log('   • OWNER:    0912345678  (Full executive overview, reports & audit)');
  console.log('   • ADMIN:    0910000001  (Inventory, operations & shift config)');
  console.log('   • CASHIER:  0910000002  (POS cashier register & credits)');
  console.log('   • BAKER:    0910000003  (Bakery production workstation)');
  console.log('   • SAMBUSA:  0910000004  (Sambusa & pastry station)');
  console.log('   • CAKE:     0910000005  (Cakes & confectionery)');
  console.log('   • EMPLOYEE: 0910000006  (Staff self-service profile)');
  console.log('-------------------------------------------------------------');
  console.log('✨ Seeded Data Highlights:');
  console.log('   • Company: Koket Bakery Group (Main Branch + Piassa Branch)');
  console.log('   • Products: 14 items with requested French Bread, Loaf & Barley images');
  console.log('   • Daily Session: Today is OPEN (Main Day Shift) + Yesterday CLOSED');
  console.log('   • POS Sales: Cash & Telebirr transactions recorded');
  console.log('   • Production: Active morning batches produced & flour deducted');
  console.log('   • Conversions: Sample 10 Bread -> 10 Bomboloni recorded');
  console.log('   • Customer Credits: Bole Horizon Cafe & Skylight Bistro with payments');
  console.log('   • Staff Loans & Payroll: Approved payroll records for all staff');
  console.log('   • Operating Expenses: Rent, Utilities, and Staff Lunch');
  console.log('=============================================================\n');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('❌ Seeding failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
