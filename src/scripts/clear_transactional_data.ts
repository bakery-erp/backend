import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  console.log('--- STARTING TRANSACTIONAL DATA CLEANUP ---');

  await prisma.$transaction(async (tx) => {
    // 1. Sales & Sessions
    console.log('Deleting SaleItems & Sales...');
    await tx.saleItem.deleteMany();
    await tx.sale.deleteMany();

    console.log('Deleting LeftoverRecords & DailySessions...');
    await tx.leftoverRecord.deleteMany();
    await tx.dailySession.deleteMany();

    // 2. Production & Conversions
    console.log('Deleting ProductionMaterialUsages, ProductionItems, ProductionBatches...');
    await tx.productionMaterialUsage.deleteMany();
    await tx.productionItem.deleteMany();
    await tx.productionBatch.deleteMany();

    console.log('Deleting ProductConversions...');
    await tx.productConversion.deleteMany();

    // 3. Suppliers & Deliveries
    console.log('Deleting SupplierDeliveryPayments, SupplierDeliveries, Suppliers...');
    await tx.supplierDeliveryPayment.deleteMany();
    await tx.supplierDelivery.deleteMany();
    await tx.supplier.deleteMany();

    // 4. Stock Movements & Loans
    console.log('Deleting StockPurchasePayments, StockPurchaseLoans, StockMovements...');
    await tx.stockPurchasePayment.deleteMany();
    await tx.stockPurchaseLoan.deleteMany();
    await tx.stockMovement.deleteMany();

    // Reset stock quantities to 0
    console.log('Resetting StockItem quantities to 0...');
    await tx.stockItem.updateMany({
      data: { currentQuantity: 0 }
    });

    // 5. Customers & Credits
    console.log('Deleting CustomerCreditPayments, CustomerCredits, Customers...');
    await tx.customerCreditPayment.deleteMany();
    await tx.customerCredit.deleteMany();
    await tx.customer.deleteMany();

    // 6. Expenses, Loans, Penalties, Payroll
    console.log('Deleting Expenses...');
    await tx.expense.deleteMany();

    console.log('Deleting LoanPayments, Loans...');
    await tx.loanPayment.deleteMany();
    await tx.loan.deleteMany();

    console.log('Deleting Penalties...');
    await tx.penalty.deleteMany();

    console.log('Deleting PayrollRecords...');
    await tx.payrollRecord.deleteMany();

    // 7. Password reset requests & Notifications
    console.log('Deleting PasswordResetRequests...');
    await tx.passwordResetRequest.deleteMany();

    console.log('Deleting Notifications...');
    await tx.notification.deleteMany();
  }, {
    timeout: 60000,
    maxWait: 20000,
  });

  console.log('--- CLEANUP COMPLETED SUCCESSFULLY ---');

  // Print remaining counts
  const counts = {
    users: await prisma.user.count(),
    branches: await prisma.branch.count(),
    products: await prisma.product.count(),
    productCategories: await prisma.productCategory.count(),
    stockItems: await prisma.stockItem.count(),
    stockMovements: await prisma.stockMovement.count(),
    dailySessions: await prisma.dailySession.count(),
    sales: await prisma.sale.count(),
    productionBatches: await prisma.productionBatch.count(),
    expenses: await prisma.expense.count(),
    loans: await prisma.loan.count(),
    payrollRecords: await prisma.payrollRecord.count(),
    notifications: await prisma.notification.count(),
  };

  console.log('Remaining Records in DB:', counts);
}

main()
  .catch((e) => {
    console.error('Cleanup failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
