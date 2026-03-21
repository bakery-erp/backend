-- FinancialCategory + product/expense links + ExpenseType OPERATIONAL/PERSONAL -> COMPANY/OWNER

CREATE TABLE `FinancialCategory` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('REVENUE', 'EXPENSE') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `FinancialCategory_name_type_key`(`name`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Product` ADD COLUMN `financialCategoryId` VARCHAR(191) NULL;
CREATE INDEX `Product_financialCategoryId_idx` ON `Product`(`financialCategoryId`);
ALTER TABLE `Product` ADD CONSTRAINT `Product_financialCategoryId_fkey` FOREIGN KEY (`financialCategoryId`) REFERENCES `FinancialCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Expense` ADD COLUMN `financialCategoryId` VARCHAR(191) NULL;
CREATE INDEX `Expense_financialCategoryId_idx` ON `Expense`(`financialCategoryId`);
ALTER TABLE `Expense` ADD CONSTRAINT `Expense_financialCategoryId_fkey` FOREIGN KEY (`financialCategoryId`) REFERENCES `FinancialCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `Expense` MODIFY COLUMN `type` ENUM('OPERATIONAL', 'PERSONAL', 'COMPANY', 'OWNER') NOT NULL DEFAULT 'OPERATIONAL';
UPDATE `Expense` SET `type` = 'COMPANY' WHERE `type` = 'OPERATIONAL';
UPDATE `Expense` SET `type` = 'OWNER' WHERE `type` = 'PERSONAL';
ALTER TABLE `Expense` MODIFY COLUMN `type` ENUM('COMPANY', 'OWNER') NOT NULL DEFAULT 'COMPANY';
