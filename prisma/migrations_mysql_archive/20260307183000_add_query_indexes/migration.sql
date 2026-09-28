-- Hot-path indexes (sessions, sales, stock, expenses, deliveries).
-- Safe to run on existing DBs; skip if an index already exists.

CREATE INDEX `Sale_sessionId_idx` ON `Sale`(`sessionId`);
CREATE INDEX `Sale_userId_idx` ON `Sale`(`userId`);
CREATE INDEX `Sale_createdAt_idx` ON `Sale`(`createdAt`);

CREATE INDEX `SaleItem_saleId_idx` ON `SaleItem`(`saleId`);
CREATE INDEX `SaleItem_productId_idx` ON `SaleItem`(`productId`);

CREATE INDEX `ProductionBatch_branchId_date_idx` ON `ProductionBatch`(`branchId`, `date`);
CREATE INDEX `ProductionBatch_branchId_status_idx` ON `ProductionBatch`(`branchId`, `status`);

CREATE INDEX `StockMovement_stockItemId_idx` ON `StockMovement`(`stockItemId`);
CREATE INDEX `StockMovement_userId_idx` ON `StockMovement`(`userId`);
CREATE INDEX `StockMovement_createdAt_idx` ON `StockMovement`(`createdAt`);

CREATE INDEX `StockItem_branchId_idx` ON `StockItem`(`branchId`);

CREATE INDEX `Expense_branchId_date_idx` ON `Expense`(`branchId`, `date`);
CREATE INDEX `Expense_userId_idx` ON `Expense`(`userId`);

CREATE INDEX `Loan_branchId_idx` ON `Loan`(`branchId`);

CREATE INDEX `SupplierDelivery_supplierId_idx` ON `SupplierDelivery`(`supplierId`);
CREATE INDEX `SupplierDelivery_createdAt_idx` ON `SupplierDelivery`(`createdAt`);

CREATE INDEX `Penalty_userId_idx` ON `Penalty`(`userId`);
