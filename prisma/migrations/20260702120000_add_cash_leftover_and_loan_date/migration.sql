-- Add daily cash leftover tracking and a business date for loans

ALTER TABLE `DailySession`
    ADD COLUMN `cashLeftoverAmount` DECIMAL(12, 2) NULL;

ALTER TABLE `Loan`
    ADD COLUMN `date` DATE NOT NULL DEFAULT (CURDATE());
