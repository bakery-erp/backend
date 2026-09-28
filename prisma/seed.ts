import { PrismaClient, Role, Shift, BatchStatus, SessionStatus, PaymentMethod, SupplierType, DeliveryPaymentSource, LoanType, LoanStatus, ApprovalStatus, StockMovementType, ExpenseType, CategoryType, UnitType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('\n🌱 Starting ERP Database Seeding...');

  // 0. Pre-flight check: Verify tables exist
  try {
    await prisma.company.count();
  } catch (err: any) {
    console.error('\n❌ Database tables do not exist yet in this database!');
    console.error('💡 Please synchronize your schema first with:');
    console.error('   npm run db:push');
    console.error('   or run: npm run db:setup\n');
    throw err;
  }

  // 1. Company & Branch
  console.log('📍 [1/8] Seeding Company & Branch...');
  let company = await prisma.company.findFirst({ where: { name: 'Koket Bakery Group' } });
  if (!company) {
    company = await prisma.company.create({
      data: {
        name: 'Koket Bakery Group',
        email: 'info@koketbakery.com',
        phone: '0912345678',
        address: 'Addis Ababa, Ethiopia',
      },
    });
  }

  let branch = await prisma.branch.findFirst({ where: { name: 'Main Branch' } });
  if (!branch) {
    branch = await prisma.branch.create({
      data: {
        name: 'Main Branch',
        address: 'Bole Medhanialem, Addis Ababa',
        company: { connect: { id: company.id } },
      },
    });
  }

  // 2. Users & Staff Roles
  console.log('👥 [2/8] Seeding Users & Authentication...');
  const passwordHash = await bcrypt.hash('password123', 10);

  const usersData = [
    { phone: '0912345678', fullName: 'Hamza Owner', role: Role.OWNER, salary: 35000 },
    { phone: '0910000001', fullName: 'Admin User', role: Role.ADMIN, salary: 22000 },
    { phone: '0910000002', fullName: 'Cashier User', role: Role.CASHIER, salary: 12000 },
    { phone: '0910000003', fullName: 'Baker User', role: Role.BAKER, salary: 15000 },
    { phone: '0910000004', fullName: 'Sambusa Worker', role: Role.SAMBUSA_WORKER, salary: 11000 },
    { phone: '0910000005', fullName: 'Cake Worker', role: Role.CAKE_WORKER, salary: 13000 },
    { phone: '0910000006', fullName: 'General Employee', role: Role.EMPLOYEE, salary: 8000 },
  ];

  const userMap = new Map<string, string>();
  for (const u of usersData) {
    const user = await prisma.user.upsert({
      where: { phone: u.phone },
      update: {
        fullName: u.fullName,
        role: u.role,
        salary: u.salary,
        isActive: true,
        branch: { connect: { id: branch.id } },
      },
      create: {
        fullName: u.fullName,
        phone: u.phone,
        passwordHash,
        role: u.role,
        salary: u.salary,
        isActive: true,
        branch: { connect: { id: branch.id } },
      },
    });
    userMap.set(u.role, user.id);
  }

  const ownerId = userMap.get(Role.OWNER)!;
  const adminId = userMap.get(Role.ADMIN)!;
  const cashierId = userMap.get(Role.CASHIER)!;
  const bakerId = userMap.get(Role.BAKER)!;

  // 3. Financial & Product Categories
  console.log('🏷️  [3/8] Seeding Financial & Product Categories...');
  async function ensureFinancialCategory(name: string, type: 'REVENUE' | 'EXPENSE') {
    let fc = await prisma.financialCategory.findFirst({ where: { name, type } });
    if (!fc) {
      fc = await prisma.financialCategory.create({ data: { name, type } });
    }
    return fc;
  }

  const fcRetail = await ensureFinancialCategory('Retail sales (bakery)', 'REVENUE');
  const fcResell = await ensureFinancialCategory('Resell goods', 'REVENUE');
  const fcRent = await ensureFinancialCategory('Rent & facilities', 'EXPENSE');
  const fcUtilities = await ensureFinancialCategory('Utilities', 'EXPENSE');
  const fcSupplies = await ensureFinancialCategory('Supplies & ingredients', 'EXPENSE');
  const fcLunch = await ensureFinancialCategory('Staff lunch & welfare', 'EXPENSE');

  const categories = [
    { name: 'Bread (Machine)', type: CategoryType.PRODUCED },
    { name: 'Sambusa / Pastry / Snacks', type: CategoryType.PRODUCED },
    { name: 'Cakes & Sweets', type: CategoryType.PRODUCED },
    { name: 'Milk & Yoghurt', type: CategoryType.RESELL },
    { name: 'Injera', type: CategoryType.RESELL },
  ];

  const catMap = new Map<string, string>();
  for (const c of categories) {
    let cat = await prisma.productCategory.findFirst({ where: { name: c.name } });
    if (!cat) {
      cat = await prisma.productCategory.create({ data: c });
    }
    catMap.set(c.name, cat.id);
  }

  // 4. Products
  console.log('🍞 [4/8] Seeding Products & Price Catalog...');
  const productsData = [
    { catName: 'Bread (Machine)', name: 'Bread', flavor: 'Normal', unitType: UnitType.PIECE, basePrice: 10, buyPrice: null, revId: fcRetail.id },
    { catName: 'Bread (Machine)', name: 'Barley Bread', flavor: 'Barley', unitType: UnitType.PIECE, basePrice: 12, buyPrice: null, revId: fcRetail.id },
    { catName: 'Bread (Machine)', name: 'Bomboloni', flavor: null, unitType: UnitType.PIECE, basePrice: 15, buyPrice: null, revId: fcRetail.id },
    { catName: 'Bread (Machine)', name: 'Donut', flavor: 'Chocolate', unitType: UnitType.PIECE, basePrice: 20, buyPrice: null, revId: fcRetail.id },
    { catName: 'Sambusa / Pastry / Snacks', name: 'Lentil Sambusa', flavor: 'Lentil', unitType: UnitType.PIECE, basePrice: 15, buyPrice: null, revId: fcRetail.id },
    { catName: 'Sambusa / Pastry / Snacks', name: 'Meat Sambusa', flavor: 'Meat', unitType: UnitType.PIECE, basePrice: 25, buyPrice: null, revId: fcRetail.id },
    { catName: 'Cakes & Sweets', name: 'Slice Cake', flavor: 'Vanilla', unitType: UnitType.PIECE, basePrice: 60, buyPrice: null, revId: fcRetail.id },
    { catName: 'Milk & Yoghurt', name: 'Fresh Milk', flavor: null, unitType: UnitType.LITER, basePrice: 60, buyPrice: 48, revId: fcResell.id },
    { catName: 'Milk & Yoghurt', name: 'Yoghurt', flavor: 'Plain', unitType: UnitType.PIECE, basePrice: 30, buyPrice: 24, revId: fcResell.id },
    { catName: 'Injera', name: 'Red Teff Injera', flavor: 'Red Teff', unitType: UnitType.PIECE, basePrice: 35, buyPrice: 28, revId: fcResell.id },
    { catName: 'Injera', name: 'White Teff Injera', flavor: 'White Teff', unitType: UnitType.PIECE, basePrice: 40, buyPrice: 32, revId: fcResell.id },
  ];

  const productMap = new Map<string, string>();
  for (const p of productsData) {
    const categoryId = catMap.get(p.catName)!;
    let prod = await prisma.product.findUnique({
      where: { name: p.name },
    });
    if (!prod) {
      prod = await prisma.product.create({
        data: {
          name: p.name,
          flavor: p.flavor,
          unitType: p.unitType,
          basePrice: p.basePrice,
          buyPrice: p.buyPrice,
          category: { connect: { id: categoryId } },
          financialCategory: { connect: { id: p.revId } },
        },
      });
    } else {
      await prisma.product.update({
        where: { id: prod.id },
        data: {
          flavor: p.flavor,
          basePrice: p.basePrice,
          buyPrice: p.buyPrice,
          financialCategory: { connect: { id: p.revId } },
        },
      });
    }
    productMap.set(p.name, prod.id);
    productMap.set(`${p.name}_${p.flavor || 'default'}`, prod.id);
    if (p.name === 'Bread') productMap.set('Bread_Normal', prod.id);
    if (p.name === 'Barley Bread') productMap.set('Bread_Barley', prod.id);
    if (p.name === 'White Teff Injera') productMap.set('Injera_White Teff', prod.id);
    if (p.name === 'Red Teff Injera') productMap.set('Injera_Red Teff', prod.id);
  }

  // 5. Stock Items & Raw Materials
  console.log('📦 [5/8] Seeding Raw Materials & Stock Inventory...');
  const stockItemsData = [
    { name: 'Wheat Flour (Special)', unitType: UnitType.KG, currentQuantity: 500, minStockLevel: 100 },
    { name: 'Dough Mix', unitType: UnitType.KG, currentQuantity: 120, minStockLevel: 30 },
    { name: 'Sugar', unitType: UnitType.KG, currentQuantity: 200, minStockLevel: 50 },
    { name: 'Cooking Oil', unitType: UnitType.LITER, currentQuantity: 80, minStockLevel: 25 },
    { name: 'Dry Yeast', unitType: UnitType.KG, currentQuantity: 30, minStockLevel: 10 },
    { name: 'Iodized Salt', unitType: UnitType.KG, currentQuantity: 50, minStockLevel: 15 },
  ];

  const stockMap = new Map<string, string>();
  for (const s of stockItemsData) {
    let item = await prisma.stockItem.findFirst({
      where: { branchId: branch.id, name: s.name },
    });
    if (!item) {
      item = await prisma.stockItem.create({
        data: {
          name: s.name,
          unitType: s.unitType,
          currentQuantity: s.currentQuantity,
          minStockLevel: s.minStockLevel,
          branch: { connect: { id: branch.id } },
        },
      });
      // Initial stock movement
      await prisma.stockMovement.create({
        data: {
          type: StockMovementType.IN,
          quantity: s.currentQuantity,
          reason: 'Initial stock baseline on DB setup',
          stockItem: { connect: { id: item.id } },
          user: { connect: { id: adminId } },
        },
      });
    }
    stockMap.set(s.name, item.id);
  }

  // 6. Suppliers
  console.log('🚚 [6/8] Seeding Suppliers...');
  const suppliersData = [
    { name: 'Bole Injera Cooperative', phone: '0911002233', type: SupplierType.INJERA },
    { name: 'Addis Milk Dairy Farm', phone: '0911445566', type: SupplierType.MILK },
    { name: 'National Flour & Grain Corp', phone: '0911778899', type: SupplierType.GENERAL },
  ];

  const supplierMap = new Map<string, string>();
  for (const sup of suppliersData) {
    let s = await prisma.supplier.findFirst({ where: { branchId: branch.id, name: sup.name } });
    if (!s) {
      s = await prisma.supplier.create({
        data: {
          name: sup.name,
          phone: sup.phone,
          type: sup.type,
          branch: { connect: { id: branch.id } },
        },
      });
    }
    supplierMap.set(sup.name, s.id);
  }

  // 7. Production Batch (Today)
  console.log('🥣 [7/8] Seeding Production Batches...');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let existingBatch = await prisma.productionBatch.findFirst({
    where: { branchId: branch.id, date: today },
  });

  if (!existingBatch) {
    const breadId = productMap.get('Bread_Normal')!;
    const donutId = productMap.get('Donut_Chocolate')!;
    const flourId = stockMap.get('Wheat Flour (Special)')!;
    const yeastId = stockMap.get('Dry Yeast')!;

    const batch = await prisma.productionBatch.create({
      data: {
        date: today,
        shift: Shift.DAY,
        status: BatchStatus.COMPLETED,
        branch: { connect: { id: branch.id } },
        user: { connect: { id: bakerId } },
        items: {
          create: [
            { productId: breadId, quantityProduced: 150, returnedQuantity: 0 },
            { productId: donutId, quantityProduced: 40, returnedQuantity: 0 },
          ],
        },
        materialUsages: {
          create: [
            { stockItemId: flourId, quantityUsed: 45 },
            { stockItemId: yeastId, quantityUsed: 2 },
          ],
        },
      },
    });

    // Record usage stock movement
    await prisma.stockMovement.create({
      data: {
        type: StockMovementType.PRODUCTION_USAGE,
        quantity: 45,
        reason: `Used in Batch #${batch.id.slice(-6)}`,
        stockItem: { connect: { id: flourId } },
        user: { connect: { id: bakerId } },
      },
    });
    await prisma.stockMovement.create({
      data: {
        type: StockMovementType.PRODUCTION_USAGE,
        quantity: 2,
        reason: `Used in Batch #${batch.id.slice(-6)}`,
        stockItem: { connect: { id: yeastId } },
        user: { connect: { id: bakerId } },
      },
    });
  }

  // 8. Daily Sessions, POS Sales, Customer Credits & Expenses
  console.log('💰 [8/8] Seeding Daily Sessions, Sales, Expenses & Customer Credits...');

  let session = await prisma.dailySession.findFirst({
    where: { branchId: branch.id, date: today },
  });

  if (!session) {
    session = await prisma.dailySession.create({
      data: {
        date: today,
        status: SessionStatus.OPEN,
        label: 'Main Day Shift',
        openingCashFloat: 1500,
        actualCashAmount: 0,
        actualCbeAmount: 0,
        actualTelebirrAmount: 0,
        notes: 'Opened for regular daily operations',
        branch: { connect: { id: branch.id } },
      },
    });

    // Create sample POS sales for today
    const breadNormalId = productMap.get('Bread_Normal')!;
    const milkId = productMap.get('Fresh Milk_default')!;
    const injeraId = productMap.get('Injera_White Teff')!;

    await prisma.sale.create({
      data: {
        totalAmount: 110,
        paymentMethod: PaymentMethod.CASH,
        session: { connect: { id: session.id } },
        user: { connect: { id: cashierId } },
        items: {
          create: [
            { productId: breadNormalId, quantity: 5, unitPrice: 10, subtotal: 50 },
            { productId: milkId, quantity: 1, unitPrice: 60, subtotal: 60 },
          ],
        },
      },
    });

    await prisma.sale.create({
      data: {
        totalAmount: 140,
        paymentMethod: PaymentMethod.TELEBIRR,
        session: { connect: { id: session.id } },
        user: { connect: { id: cashierId } },
        items: {
          create: [
            { productId: injeraId, quantity: 2, unitPrice: 40, subtotal: 80 },
            { productId: breadNormalId, quantity: 6, unitPrice: 10, subtotal: 60 },
          ],
        },
      },
    });
  }

  // Seed sample operating expense
  const rentExpense = await prisma.expense.findFirst({
    where: { branchId: branch.id, description: 'Monthly Bakery Shop Rent' },
  });
  if (!rentExpense) {
    await prisma.expense.create({
      data: {
        type: ExpenseType.COMPANY,
        category: 'RENT',
        amount: 12000,
        date: today,
        description: 'Monthly Bakery Shop Rent',
        branch: { connect: { id: branch.id } },
        user: { connect: { id: adminId } },
        session: { connect: { id: session.id } },
        financialCategory: { connect: { id: fcRent.id } },
      },
    });
  }

  const utilitiesExpense = await prisma.expense.findFirst({
    where: { branchId: branch.id, description: 'Electricity & Water Bill' },
  });
  if (!utilitiesExpense) {
    await prisma.expense.create({
      data: {
        type: ExpenseType.COMPANY,
        category: 'UTILITIES',
        amount: 1850,
        date: today,
        description: 'Electricity & Water Bill',
        branch: { connect: { id: branch.id } },
        user: { connect: { id: adminId } },
        session: { connect: { id: session.id } },
        financialCategory: { connect: { id: fcUtilities.id } },
      },
    });
  }

  // Seed Customer Product Credits (Customer Loan)
  const existingCustomerCredit = await prisma.loan.findFirst({
    where: { branchId: branch.id, entityId: 'Bole Horizon Cafe' },
  });
  if (!existingCustomerCredit) {
    const credit = await prisma.loan.create({
      data: {
        type: LoanType.CUSTOMER,
        entityId: 'Bole Horizon Cafe',
        totalAmount: 3200,
        remainingBalance: 2000,
        status: LoanStatus.OPEN,
        date: today,
        branch: { connect: { id: branch.id } },
      },
    });

    // Partial settlement of 1,200 ETB
    await prisma.loanPayment.create({
      data: {
        amountPaid: 1200,
        date: today,
        loan: { connect: { id: credit.id } },
      },
    });
  }

  // Seed Staff Loan for Baker
  const existingStaffLoan = await prisma.loan.findFirst({
    where: { branchId: branch.id, userId: bakerId },
  });
  if (!existingStaffLoan) {
    await prisma.loan.create({
      data: {
        type: LoanType.STAFF_LOAN,
        totalAmount: 2500,
        remainingBalance: 1500,
        status: LoanStatus.OPEN,
        date: today,
        branch: { connect: { id: branch.id } },
        user: { connect: { id: bakerId } },
      },
    });
  }

  // Summary output
  console.log('\n=============================================================');
  console.log('✅ DATABASE SEEDING COMPLETED SUCCESSFULLY!');
  console.log('=============================================================');
  console.log('🔑 Login Credentials (Password for all: password123):');
  console.log('   • OWNER:    0912345678  (Full dashboard, ledger & executive reports)');
  console.log('   • ADMIN:    0910000001  (Inventory, operations & staff management)');
  console.log('   • CASHIER:  0910000002  (POS sessions, sales & customer credits)');
  console.log('   • BAKER:    0910000003  (Production batches & recipe tracking)');
  console.log('   • SAMBUSA:  0910000004  (Pastry & Sambusa production)');
  console.log('   • CAKE:     0910000005  (Cakes & confectionery)');
  console.log('   • EMPLOYEE: 0910000006  (Self-service employee profile)');
  console.log('-------------------------------------------------------------');
  console.log('📊 Seeded Data Summary:');
  console.log('   • Company: Koket Bakery Group');
  console.log('   • Branch: Main Branch');
  console.log('   • Products: Bread, Donut, Sambusa, Milk, Injera, Cake');
  console.log('   • Stock: Wheat Flour, Dough Mix, Sugar, Oil, Yeast, Salt');
  console.log('   • POS: Active Daily Session with sample Cash/Telebirr sales');
  console.log('   • Production: Completed Day shift batch for today');
  console.log('   • Customer Credit: Bole Horizon Cafe with partial payment');
  console.log('   • Expenses: Shop Rent (12,000 ETB) & Utilities (1,850 ETB)');
  console.log('=============================================================\n');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('❌ Seeding failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
