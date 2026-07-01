-- Add parent/child hierarchy to ProductCategory

ALTER TABLE `ProductCategory`
    ADD COLUMN `parentId` VARCHAR(191) NULL,
    ADD INDEX `ProductCategory_parentId_idx`(`parentId`);

ALTER TABLE `ProductCategory`
    ADD CONSTRAINT `ProductCategory_parentId_fkey`
    FOREIGN KEY (`parentId`) REFERENCES `ProductCategory`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
