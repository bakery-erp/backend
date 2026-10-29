import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient, UnitType, CategoryType, Role, FinancialCategoryType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Starting database cleanup and new catalog population...');

  // 1. Fetch active branches
  const branches = await prisma.branch.findMany({ select: { id: true, name: true } });
  const allBranchIds = branches.map((b) => b.id);
  console.log(`Found ${branches.length} branches:`, branches.map((b) => b.name));

  // 2. Fetch or create Financial Categories
  let fcRetail = await prisma.financialCategory.findFirst({
    where: { name: 'Bakery Products Sales', type: FinancialCategoryType.REVENUE },
  });
  if (!fcRetail) {
    fcRetail = await prisma.financialCategory.create({
      data: { name: 'Bakery Products Sales', type: FinancialCategoryType.REVENUE },
    });
  }

  let fcResell = await prisma.financialCategory.findFirst({
    where: { name: 'Resell Goods Sales', type: FinancialCategoryType.REVENUE },
  });
  if (!fcResell) {
    fcResell = await prisma.financialCategory.create({
      data: { name: 'Resell Goods Sales', type: FinancialCategoryType.REVENUE },
    });
  }

  // 3. Clear dependent records in safe order
  console.log('🧹 Clearing old transaction records...');
  await prisma.leftoverRecord.deleteMany();
  await prisma.saleItem.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.productionMaterialUsage.deleteMany();
  await prisma.productionItem.deleteMany();
  await prisma.productionBatch.deleteMany();
  await prisma.productConversion.deleteMany();
  if ((prisma as any).supplierDeliveryItem) {
    await (prisma as any).supplierDeliveryItem.deleteMany();
  }
  await prisma.supplierDelivery.deleteMany();
  if ((prisma as any).stockPurchaseLoan) {
    await (prisma as any).stockPurchaseLoan.deleteMany();
  }
  await prisma.stockMovement.deleteMany();

  // 4. Clear products, stock items, and categories
  console.log('🧹 Clearing old products, stock items, and categories...');
  await prisma.product.deleteMany();
  await prisma.stockItem.deleteMany();
  await prisma.productCategory.deleteMany();

  console.log('✅ Cleanup complete! Now seeding new categories and products...');

  // 5. Define Categories and Subcategories
  // Main Category 1: የዳቦ ምርቶች
  const catBakery = await prisma.productCategory.create({
    data: {
      name: 'የዳቦ ምርቶች',
      nameLatin: 'Bakery Products',
      type: CategoryType.PRODUCED,
      productionRole: Role.BAKER,
    },
  });

  const subCatNormalBread = await prisma.productCategory.create({
    data: { name: 'መደበኛ ዳቦ', nameLatin: 'Medebegna Dabo', type: CategoryType.PRODUCED, productionRole: Role.BAKER, parentId: catBakery.id },
  });
  const subCatDifo = await prisma.productCategory.create({
    data: { name: 'ድፎ ዳቦ', nameLatin: 'Difo Dabo', type: CategoryType.PRODUCED, productionRole: Role.BAKER, parentId: catBakery.id },
  });
  const subCatSinde = await prisma.productCategory.create({
    data: { name: 'ስንዴ ዳቦ', nameLatin: 'Sinde Dabo', type: CategoryType.PRODUCED, productionRole: Role.BAKER, parentId: catBakery.id },
  });
  const subCatSweetBread = await prisma.productCategory.create({
    data: { name: 'ጣፋጭ ዳቦ እና ፓስትሪ', nameLatin: 'Tafach Dabo & Pastry', type: CategoryType.PRODUCED, productionRole: Role.BAKER, parentId: catBakery.id },
  });
  const subCatDomat = await prisma.productCategory.create({
    data: { name: 'ዶማት እና መክሰስ', nameLatin: 'Domat & Snacks', type: CategoryType.PRODUCED, productionRole: Role.BAKER, parentId: catBakery.id },
  });
  const subCatEnjera = await prisma.productCategory.create({
    data: { name: 'እንጀራ እና አምባሻ', nameLatin: 'Enjera & Ambasha', type: CategoryType.PRODUCED, productionRole: Role.BAKER, parentId: catBakery.id },
  });

  // Main Category 2: የሳምቡሳ እና ፈጣን ምግቦች
  const catSambusa = await prisma.productCategory.create({
    data: {
      name: 'የሳምቡሳ እና ፈጣን ምግቦች',
      nameLatin: 'Sambusa & Fast Foods',
      type: CategoryType.PRODUCED,
      productionRole: Role.SAMBUSA_WORKER,
    },
  });

  const subCatSambusa = await prisma.productCategory.create({
    data: { name: 'ሳንቡሳ', nameLatin: 'Sambusa', type: CategoryType.PRODUCED, productionRole: Role.SAMBUSA_WORKER, parentId: catSambusa.id },
  });
  const subCatSpring = await prisma.productCategory.create({
    data: { name: 'እስፕሪንግ ሮል', nameLatin: 'Spring Roll', type: CategoryType.PRODUCED, productionRole: Role.SAMBUSA_WORKER, parentId: catSambusa.id },
  });
  const subCatKeshkesh = await prisma.productCategory.create({
    data: { name: 'ከሽከሽ', nameLatin: 'Keshkesh', type: CategoryType.PRODUCED, productionRole: Role.SAMBUSA_WORKER, parentId: catSambusa.id },
  });
  const subCatPizza = await prisma.productCategory.create({
    data: { name: 'ፒዛ', nameLatin: 'Pizza', type: CategoryType.PRODUCED, productionRole: Role.SAMBUSA_WORKER, parentId: catSambusa.id },
  });
  const subCatFetira = await prisma.productCategory.create({
    data: { name: 'ፈጢራ', nameLatin: 'Fetira', type: CategoryType.PRODUCED, productionRole: Role.SAMBUSA_WORKER, parentId: catSambusa.id },
  });

  // Main Category 3: የኬክ ምርቶች
  const catCake = await prisma.productCategory.create({
    data: {
      name: 'የኬክ ምርቶች',
      nameLatin: 'Cake Products',
      type: CategoryType.PRODUCED,
      productionRole: Role.CAKE_WORKER,
    },
  });

  const subCatDrekCake = await prisma.productCategory.create({
    data: { name: 'ደረቅ ኬክ', nameLatin: 'Drek Cake', type: CategoryType.PRODUCED, productionRole: Role.CAKE_WORKER, parentId: catCake.id },
  });
  const subCatTeqorachCake = await prisma.productCategory.create({
    data: { name: 'ተቆራጭ ኬክ', nameLatin: 'Teqorach Cake', type: CategoryType.PRODUCED, productionRole: Role.CAKE_WORKER, parentId: catCake.id },
  });
  const subCatBananaLife = await prisma.productCategory.create({
    data: { name: 'ባናና ላይፍ', nameLatin: 'Banana Life', type: CategoryType.PRODUCED, productionRole: Role.CAKE_WORKER, parentId: catCake.id },
  });
  const subCatCreamCake = await prisma.productCategory.create({
    data: { name: 'ክሬም እና ልዩ ኬኮች', nameLatin: 'Cream Cakes & Pastries', type: CategoryType.PRODUCED, productionRole: Role.CAKE_WORKER, parentId: catCake.id },
  });
  const subCatTortaCake = await prisma.productCategory.create({
    data: { name: 'ቶርታ ኬክ', nameLatin: 'Torta Cake', type: CategoryType.PRODUCED, productionRole: Role.CAKE_WORKER, parentId: catCake.id },
  });
  const subCatGatoCake = await prisma.productCategory.create({
    data: { name: 'ጋቶ ኬክ', nameLatin: 'Gato Cake', type: CategoryType.PRODUCED, productionRole: Role.CAKE_WORKER, parentId: catCake.id },
  });
  const subCatCookies = await prisma.productCategory.create({
    data: { name: 'ኩኪስ', nameLatin: 'Cookies', type: CategoryType.PRODUCED, productionRole: Role.CAKE_WORKER, parentId: catCake.id },
  });

  // Main Category 4: መሸጫ እቃዎች
  const catResale = await prisma.productCategory.create({
    data: {
      name: 'መሸጫ እቃዎች',
      nameLatin: 'Resale Items',
      type: CategoryType.RESELL,
      productionRole: Role.CASHIER,
    },
  });

  const subCatErgo = await prisma.productCategory.create({
    data: { name: 'እርጎ', nameLatin: 'Ergo (Yogurt)', type: CategoryType.RESELL, productionRole: Role.CASHIER, parentId: catResale.id },
  });
  const subCatWetet = await prisma.productCategory.create({
    data: { name: 'ወተት', nameLatin: 'Wetet (Milk)', type: CategoryType.RESELL, productionRole: Role.CASHIER, parentId: catResale.id },
  });
  const subCatChocolate = await prisma.productCategory.create({
    data: { name: 'ቸኮሌት', nameLatin: 'Chocolate', type: CategoryType.RESELL, productionRole: Role.CASHIER, parentId: catResale.id },
  });

  // 6. Products Definitions
  const productsList = [
    // --- 1.1 መደበኛ ዳቦ ---
    { name: 'መደበኛ ዳቦ ባለ 15', nameLatin: 'Medebegna Dabo Bale 15', price: 15, unit: UnitType.PIECE, catId: subCatNormalBread.id, fcId: fcRetail.id },
    { name: 'መደበኛ ዳቦ ባለ 20', nameLatin: 'Medebegna Dabo Bale 20', price: 20, unit: UnitType.PIECE, catId: subCatNormalBread.id, fcId: fcRetail.id },
    { name: 'መደበኛ ዳቦ ባለ 25', nameLatin: 'Medebegna Dabo Bale 25', price: 25, unit: UnitType.PIECE, catId: subCatNormalBread.id, fcId: fcRetail.id },
    { name: 'መደበኛ ዳቦ ባለ 30', nameLatin: 'Medebegna Dabo Bale 30', price: 30, unit: UnitType.PIECE, catId: subCatNormalBread.id, fcId: fcRetail.id },
    { name: 'መደበኛ ዳቦ ባለ 33', nameLatin: 'Medebegna Dabo Bale 33', price: 33, unit: UnitType.PIECE, catId: subCatNormalBread.id, fcId: fcRetail.id },
    { name: 'የገብስ ዳቦ ባለ 15', nameLatin: 'Ye Gebs Dabo Bale 15', price: 15, unit: UnitType.PIECE, catId: subCatNormalBread.id, fcId: fcRetail.id },
    { name: 'እስላይስ ዳቦ', nameLatin: 'Slice Dabo', price: 90, unit: UnitType.PIECE, catId: subCatNormalBread.id, fcId: fcRetail.id },

    // --- 1.2 ድፎ ዳቦ ---
    { name: 'ድፎ ዳቦ ባለ 50', nameLatin: 'Difo Dabo Bale 50', price: 50, unit: UnitType.PIECE, catId: subCatDifo.id, fcId: fcRetail.id },
    { name: 'ድፎ ዳቦ ባለ 100', nameLatin: 'Difo Dabo Bale 100', price: 100, unit: UnitType.PIECE, catId: subCatDifo.id, fcId: fcRetail.id },
    { name: 'ድፎ ዳቦ ባለ 150', nameLatin: 'Difo Dabo Bale 150', price: 150, unit: UnitType.PIECE, catId: subCatDifo.id, fcId: fcRetail.id },
    { name: 'ድፎ ዳቦ ባለ 200', nameLatin: 'Difo Dabo Bale 200', price: 200, unit: UnitType.PIECE, catId: subCatDifo.id, fcId: fcRetail.id },
    { name: 'ድፎ ዳቦ ባለ 300', nameLatin: 'Difo Dabo Bale 300', price: 300, unit: UnitType.PIECE, catId: subCatDifo.id, fcId: fcRetail.id },
    { name: 'ድፎ ዳቦ ባለ 400', nameLatin: 'Difo Dabo Bale 400', price: 400, unit: UnitType.PIECE, catId: subCatDifo.id, fcId: fcRetail.id },
    { name: 'ድፎ ዳቦ ባለ 500', nameLatin: 'Difo Dabo Bale 500', price: 500, unit: UnitType.PIECE, catId: subCatDifo.id, fcId: fcRetail.id },

    // --- 1.3 ስንዴ ዳቦ ---
    { name: 'ስንዴ ዳቦ ባለ 200', nameLatin: 'Sinde Dabo Bale 200', price: 200, unit: UnitType.PIECE, catId: subCatSinde.id, fcId: fcRetail.id },
    { name: 'ስንዴ ዳቦ ባለ 300', nameLatin: 'Sinde Dabo Bale 300', price: 300, unit: UnitType.PIECE, catId: subCatSinde.id, fcId: fcRetail.id },
    { name: 'ስንዴ ዳቦ ባለ 400', nameLatin: 'Sinde Dabo Bale 400', price: 400, unit: UnitType.PIECE, catId: subCatSinde.id, fcId: fcRetail.id },
    { name: 'ስንዴ ዳቦ ባለ 500', nameLatin: 'Sinde Dabo Bale 500', price: 500, unit: UnitType.PIECE, catId: subCatSinde.id, fcId: fcRetail.id },

    // --- 1.4 ጣፋጭ ዳቦ እና ፓስትሪ ---
    { name: 'ጣፋጭ ዳቦ ባለ 50', nameLatin: 'Tafach Dabo Bale 50', price: 50, unit: UnitType.PIECE, catId: subCatSweetBread.id, fcId: fcRetail.id },
    { name: 'ክሮሰንት ባለ 60', nameLatin: 'Croissant Bale 60', price: 60, unit: UnitType.PIECE, catId: subCatSweetBread.id, fcId: fcRetail.id },
    { name: 'ጣፋጭ ዳቦ ባለ 70', nameLatin: 'Tafach Dabo Bale 70', price: 70, unit: UnitType.PIECE, catId: subCatSweetBread.id, fcId: fcRetail.id },
    { name: 'ቦንቦሊኖ ባለ 50', nameLatin: 'Bombolino Bale 50', price: 50, unit: UnitType.PIECE, catId: subCatSweetBread.id, fcId: fcRetail.id },
    { name: 'ቡስኩት ባለ 50', nameLatin: 'Biskut Bale 50', price: 50, unit: UnitType.PIECE, catId: subCatSweetBread.id, fcId: fcRetail.id },
    { name: 'ዶናት ባለ 65', nameLatin: 'Donut Bale 65', price: 65, unit: UnitType.PIECE, catId: subCatSweetBread.id, fcId: fcRetail.id },
    { name: 'ሚኒ ዶናት ባለ 80', nameLatin: 'Mini Donut Bale 80', price: 80, unit: UnitType.PIECE, catId: subCatSweetBread.id, fcId: fcRetail.id },

    // --- 1.5 ዶማት እና መክሰስ ---
    { name: 'ዶማት ባለ 5', nameLatin: 'Domat Bale 5', price: 5, unit: UnitType.PIECE, catId: subCatDomat.id, fcId: fcRetail.id },
    { name: 'ዶማት ባለ 10', nameLatin: 'Domat Bale 10', price: 10, unit: UnitType.PIECE, catId: subCatDomat.id, fcId: fcRetail.id },
    { name: 'ዶማት ባለ 65', nameLatin: 'Domat Bale 65', price: 65, unit: UnitType.PIECE, catId: subCatDomat.id, fcId: fcRetail.id },
    { name: 'ግርሲኒ ባለ 40', nameLatin: 'Grisini Bale 40', price: 40, unit: UnitType.PIECE, catId: subCatDomat.id, fcId: fcRetail.id },
    { name: 'ግርሲኒ ባለ 45', nameLatin: 'Grisini Bale 45', price: 45, unit: UnitType.PIECE, catId: subCatDomat.id, fcId: fcRetail.id },
    { name: 'ዳቦ ቆሎ ባለ 90', nameLatin: 'Dabo Kolo Bale 90', price: 90, unit: UnitType.PIECE, catId: subCatDomat.id, fcId: fcRetail.id },

    // --- 1.6 እንጀራ እና አምባሻ ---
    { name: 'እንጀራ ባለ 25', nameLatin: 'Enjera Bale 25', price: 25, unit: UnitType.PIECE, catId: subCatEnjera.id, fcId: fcRetail.id },
    { name: 'እንጀራ ባለ 30', nameLatin: 'Enjera Bale 30', price: 30, unit: UnitType.PIECE, catId: subCatEnjera.id, fcId: fcRetail.id },
    { name: 'አምባሻ ባለ 160', nameLatin: 'Ambasha Bale 160', price: 160, unit: UnitType.PIECE, catId: subCatEnjera.id, fcId: fcRetail.id },

    // --- 2.1 ሳንቡሳ ---
    { name: 'ሳንቡሳ ባለ 30', nameLatin: 'Sambusa Bale 30', price: 30, unit: UnitType.PIECE, catId: subCatSambusa.id, fcId: fcRetail.id },

    // --- 2.2 እስፕሪንግ ሮል ---
    { name: 'እስፕሪንግ ሮል ባለ 35', nameLatin: 'Spring Roll Bale 35', price: 35, unit: UnitType.PIECE, catId: subCatSpring.id, fcId: fcRetail.id },

    // --- 2.3 ከሽከሽ ---
    { name: 'ከሽከሽ ባለ 25', nameLatin: 'Keshkesh Bale 25', price: 25, unit: UnitType.PIECE, catId: subCatKeshkesh.id, fcId: fcRetail.id },

    // --- 2.4 ፒዛ ---
    { name: 'ፒዛ ባለ 35', nameLatin: 'Pizza Bale 35', price: 35, unit: UnitType.PIECE, catId: subCatPizza.id, fcId: fcRetail.id },
    { name: 'ፒዛ ባለ 60', nameLatin: 'Pizza Bale 60', price: 60, unit: UnitType.PIECE, catId: subCatPizza.id, fcId: fcRetail.id },

    // --- 2.5 ፈጢራ ---
    { name: 'ፈጢራ ባለ 150', nameLatin: 'Fetira Bale 150', price: 150, unit: UnitType.PIECE, catId: subCatFetira.id, fcId: fcRetail.id },
    { name: 'ፈጢራ ባለ 180', nameLatin: 'Fetira Bale 180', price: 180, unit: UnitType.PIECE, catId: subCatFetira.id, fcId: fcRetail.id },
    { name: 'ፈጢራ ባለ 210', nameLatin: 'Fetira Bale 210', price: 210, unit: UnitType.PIECE, catId: subCatFetira.id, fcId: fcRetail.id },

    // --- 3.1 ደረቅ ኬክ ---
    { name: 'ደረቅ ኬክ ባለ 40', nameLatin: 'Drek Cake Bale 40', price: 40, unit: UnitType.PIECE, catId: subCatDrekCake.id, fcId: fcRetail.id },
    { name: 'ደረቅ ኬክ ባለ 50', nameLatin: 'Drek Cake Bale 50', price: 50, unit: UnitType.PIECE, catId: subCatDrekCake.id, fcId: fcRetail.id },
    { name: 'ደረቅ ኬክ ባለ 60', nameLatin: 'Drek Cake Bale 60', price: 60, unit: UnitType.PIECE, catId: subCatDrekCake.id, fcId: fcRetail.id },

    // --- 3.2 ተቆራጭ ኬክ ---
    { name: 'ተቆራጭ ኬክ ባለ 60', nameLatin: 'Teqorach Cake Bale 60', price: 60, unit: UnitType.PIECE, catId: subCatTeqorachCake.id, fcId: fcRetail.id },
    { name: 'ተቆራጭ ኬክ ባለ 70', nameLatin: 'Teqorach Cake Bale 70', price: 70, unit: UnitType.PIECE, catId: subCatTeqorachCake.id, fcId: fcRetail.id },
    { name: 'ተቆራጭ ኬክ ባለ 90', nameLatin: 'Teqorach Cake Bale 90', price: 90, unit: UnitType.PIECE, catId: subCatTeqorachCake.id, fcId: fcRetail.id },

    // --- 3.3 ባናና ላይፍ ---
    { name: 'ባናና ላይፍ ባለ 40', nameLatin: 'Banana Life Bale 40', price: 40, unit: UnitType.PIECE, catId: subCatBananaLife.id, fcId: fcRetail.id },
    { name: 'ባናና ላይፍ ባለ 60', nameLatin: 'Banana Life Bale 60', price: 60, unit: UnitType.PIECE, catId: subCatBananaLife.id, fcId: fcRetail.id },

    // --- 3.4 ክሬም እና ልዩ ኬኮች ---
    { name: 'ተቆራጭ ክሬም ኬክ ባለ 100', nameLatin: 'Teqorach Cream Cake Bale 100', price: 100, unit: UnitType.PIECE, catId: subCatCreamCake.id, fcId: fcRetail.id },
    { name: 'ተቆራጭ ክሬም ኬክ ባለ 120', nameLatin: 'Teqorach Cream Cake Bale 120', price: 120, unit: UnitType.PIECE, catId: subCatCreamCake.id, fcId: fcRetail.id },
    { name: 'ሚሊፎኒ ባለ 110', nameLatin: 'Milifoni Bale 110', price: 110, unit: UnitType.PIECE, catId: subCatCreamCake.id, fcId: fcRetail.id },
    { name: 'ቸኮሌት ኬክ ባለ 150', nameLatin: 'Chocolate Cake Bale 150', price: 150, unit: UnitType.PIECE, catId: subCatCreamCake.id, fcId: fcRetail.id },
    { name: 'ካፕ ኬክ ባለ 50', nameLatin: 'Cup Cake Bale 50', price: 50, unit: UnitType.PIECE, catId: subCatCreamCake.id, fcId: fcRetail.id },
    { name: 'ካፕ ኬክ ባለ 60', nameLatin: 'Cup Cake Bale 60', price: 60, unit: UnitType.PIECE, catId: subCatCreamCake.id, fcId: fcRetail.id },
    { name: 'ካፕ ኬክ በቦክስ ባለ 100', nameLatin: 'Cup Cake Box-ga Bale 100', price: 100, unit: UnitType.PIECE, catId: subCatCreamCake.id, fcId: fcRetail.id },
    { name: 'ባክላቫ ባለ 60', nameLatin: 'Baklava Bale 60', price: 60, unit: UnitType.PIECE, catId: subCatCreamCake.id, fcId: fcRetail.id },
    { name: 'ቲራሚሱ ባለ 80', nameLatin: 'Tiramisu Bale 80', price: 80, unit: UnitType.PIECE, catId: subCatCreamCake.id, fcId: fcRetail.id },

    // --- 3.5 ቶርታ ኬክ ---
    { name: 'ቶርታ ኬክ 0.5 ኪሎ ባለ 500', nameLatin: 'Torta Cake 0.5kg Bale 500', price: 500, unit: UnitType.PIECE, catId: subCatTortaCake.id, fcId: fcRetail.id },
    { name: 'ቶርታ ኬክ 0.5 ኪሎ ባለ 600', nameLatin: 'Torta Cake 0.5kg Bale 600', price: 600, unit: UnitType.PIECE, catId: subCatTortaCake.id, fcId: fcRetail.id },
    { name: 'ቶርታ ኬክ 0.5 ኪሎ ባለ 650', nameLatin: 'Torta Cake 0.5kg Bale 650', price: 650, unit: UnitType.PIECE, catId: subCatTortaCake.id, fcId: fcRetail.id },
    { name: 'ቶርታ ኬክ 0.5 ኪሎ ባለ 700', nameLatin: 'Torta Cake 0.5kg Bale 700', price: 700, unit: UnitType.PIECE, catId: subCatTortaCake.id, fcId: fcRetail.id },
    { name: 'ቶርታ ኬክ 1 ኪሎ ባለ 1200', nameLatin: 'Torta Cake 1kg Bale 1200', price: 1200, unit: UnitType.PIECE, catId: subCatTortaCake.id, fcId: fcRetail.id },
    { name: 'ቶርታ ኬክ 1 ኪሎ ባለ 1400', nameLatin: 'Torta Cake 1kg Bale 1400', price: 1400, unit: UnitType.PIECE, catId: subCatTortaCake.id, fcId: fcRetail.id },
    { name: 'ቶርታ ኬክ 1 ኪሎ ባለ 1500', nameLatin: 'Torta Cake 1kg Bale 1500', price: 1500, unit: UnitType.PIECE, catId: subCatTortaCake.id, fcId: fcRetail.id },
    { name: 'ቶርታ ኬክ 1 ኪሎ ባለ 1700', nameLatin: 'Torta Cake 1kg Bale 1700', price: 1700, unit: UnitType.PIECE, catId: subCatTortaCake.id, fcId: fcRetail.id },
    { name: 'ቶርታ ኬክ 1.5 ኪሎ ባለ 1700', nameLatin: 'Torta Cake 1.5kg Bale 1700', price: 1700, unit: UnitType.PIECE, catId: subCatTortaCake.id, fcId: fcRetail.id },
    { name: 'ቶርታ ኬክ 2 ኪሎ ባለ 2400', nameLatin: 'Torta Cake 2kg Bale 2400', price: 2400, unit: UnitType.PIECE, catId: subCatTortaCake.id, fcId: fcRetail.id },
    { name: 'ቶርታ ኬክ 2 ኪሎ ባለ 2700', nameLatin: 'Torta Cake 2kg Bale 2700', price: 2700, unit: UnitType.PIECE, catId: subCatTortaCake.id, fcId: fcRetail.id },
    { name: 'ፎንዳንት ቶርታ ኬክ 2 ኪሎ ባለ 4000', nameLatin: 'Fondant Torta Cake 2kg Bale 4000', price: 4000, unit: UnitType.PIECE, catId: subCatTortaCake.id, fcId: fcRetail.id },
    { name: 'ቶርታ ኬክ 3 ኪሎ ባለ 3600', nameLatin: 'Torta Cake 3kg Bale 3600', price: 3600, unit: UnitType.PIECE, catId: subCatTortaCake.id, fcId: fcRetail.id },
    { name: 'ቶርታ ኬክ 3 ኪሎ ባለ 5200', nameLatin: 'Torta Cake 3kg Bale 5200', price: 5200, unit: UnitType.PIECE, catId: subCatTortaCake.id, fcId: fcRetail.id },
    { name: 'ቶርታ ኬክ 3.5 ኪሎ ባለ 6200', nameLatin: 'Torta Cake 3.5kg Bale 6200', price: 6200, unit: UnitType.PIECE, catId: subCatTortaCake.id, fcId: fcRetail.id },

    // --- 3.6 ጋቶ ኬክ ---
    { name: 'ጋቶ ኬክ ባለ 600', nameLatin: 'Gato Cake Bale 600', price: 600, unit: UnitType.PIECE, catId: subCatGatoCake.id, fcId: fcRetail.id },
    { name: 'ጋቶ ኬክ ባለ 700', nameLatin: 'Gato Cake Bale 700', price: 700, unit: UnitType.PIECE, catId: subCatGatoCake.id, fcId: fcRetail.id },
    { name: 'ጋቶ ኬክ ባለ 800', nameLatin: 'Gato Cake Bale 800', price: 800, unit: UnitType.PIECE, catId: subCatGatoCake.id, fcId: fcRetail.id },
    { name: 'ጋቶ ኬክ ባለ 900', nameLatin: 'Gato Cake Bale 900', price: 900, unit: UnitType.PIECE, catId: subCatGatoCake.id, fcId: fcRetail.id },
    { name: 'ጋቶ ኬክ ባለ 1500', nameLatin: 'Gato Cake Bale 1500', price: 1500, unit: UnitType.PIECE, catId: subCatGatoCake.id, fcId: fcRetail.id },
    { name: 'ጋቶ ኬክ ባለ 2000', nameLatin: 'Gato Cake Bale 2000', price: 2000, unit: UnitType.PIECE, catId: subCatGatoCake.id, fcId: fcRetail.id },
    { name: 'ጋቶ ኬክ ባለ 2500', nameLatin: 'Gato Cake Bale 2500', price: 2500, unit: UnitType.PIECE, catId: subCatGatoCake.id, fcId: fcRetail.id },
    { name: 'ጋቶ ኬክ ባለ 3000', nameLatin: 'Gato Cake Bale 3000', price: 3000, unit: UnitType.PIECE, catId: subCatGatoCake.id, fcId: fcRetail.id },

    // --- 3.7 ኩኪስ ---
    { name: 'ኩኪስ 1 ኪሎ ባለ 700', nameLatin: 'Cookies 1kg Bale 700', price: 700, unit: UnitType.KG, catId: subCatCookies.id, fcId: fcRetail.id },
    { name: 'ኩኪስ 1 ኪሎ ባለ 850', nameLatin: 'Cookies 1kg Bale 850', price: 850, unit: UnitType.KG, catId: subCatCookies.id, fcId: fcRetail.id },

    // --- 4.1 እርጎ ---
    { name: 'መደበኛ እርጎ 150/175ml ባለ 60', nameLatin: 'Medebegna Ergo 150/175ml Bale 60', price: 60, unit: UnitType.PIECE, catId: subCatErgo.id, fcId: fcResell.id },
    { name: 'መደበኛ እርጎ 300ml ባለ 90', nameLatin: 'Medebegna Ergo 300ml Bale 90', price: 90, unit: UnitType.PIECE, catId: subCatErgo.id, fcId: fcResell.id },
    { name: 'መደበኛ እርጎ 400ml ባለ 100', nameLatin: 'Medebegna Ergo 400ml Bale 100', price: 100, unit: UnitType.PIECE, catId: subCatErgo.id, fcId: fcResell.id },
    { name: 'መደበኛ እርጎ 425ml ባለ 130', nameLatin: 'Medebegna Ergo 425ml Bale 130', price: 130, unit: UnitType.PIECE, catId: subCatErgo.id, fcId: fcResell.id },
    { name: 'ፍሌቨር እርጎ 150ml ባለ 65', nameLatin: 'Flavor Ergo 150ml Bale 65', price: 65, unit: UnitType.PIECE, catId: subCatErgo.id, fcId: fcResell.id },
    { name: 'እስቲርድ እርጎ ባለ 80', nameLatin: 'Stirred Ergo Bale 80', price: 80, unit: UnitType.PIECE, catId: subCatErgo.id, fcId: fcResell.id },
    { name: 'ፍሌቨር እርጎ 425ml ባለ 150', nameLatin: 'Flavor Ergo 425ml Bale 150', price: 150, unit: UnitType.PIECE, catId: subCatErgo.id, fcId: fcResell.id },

    // --- 4.2 ወተት ---
    { name: 'ወተት 500ml ባለ 90', nameLatin: 'Wetet 500ml Bale 90', price: 90, unit: UnitType.PIECE, catId: subCatWetet.id, fcId: fcResell.id },
    { name: 'ወተት 500ml ባለ 110', nameLatin: 'Wetet 500ml Bale 110', price: 110, unit: UnitType.PIECE, catId: subCatWetet.id, fcId: fcResell.id },
    { name: 'ወተት 1 ሊትር ባለ 240', nameLatin: 'Wetet 1L Bale 240', price: 240, unit: UnitType.PIECE, catId: subCatWetet.id, fcId: fcResell.id },

    // --- 4.3 ቸኮሌት ---
    { name: 'አነስተኛ ቸኮሌት ባለ 400', nameLatin: 'Anestegna Chocolate Bale 400', price: 400, unit: UnitType.PIECE, catId: subCatChocolate.id, fcId: fcResell.id },
    { name: 'መካከለኛ ቸኮሌት ባለ 65', nameLatin: 'Mekakelegna Chocolate Bale 65', price: 65, unit: UnitType.PIECE, catId: subCatChocolate.id, fcId: fcResell.id },
    { name: 'ትልቅ ቸኮሌት ባለ 3300', nameLatin: 'Tiliq Chocolate Bale 3300', price: 3300, unit: UnitType.PIECE, catId: subCatChocolate.id, fcId: fcResell.id },
  ];

  console.log(`📦 Seeding ${productsList.length} products...`);
  for (const p of productsList) {
    await prisma.product.create({
      data: {
        name: p.name,
        nameLatin: p.nameLatin,
        basePrice: p.price,
        unitType: p.unit,
        categoryId: p.catId,
        financialCategoryId: p.fcId,
        branchIds: allBranchIds,
        imageUrl: null, // Image functionality removed
      },
    });
  }

  // 7. Stock Items Definitions
  const stockList = [
    // --- 5.1 መሰረታዊ ጥሬ እቃዎች ---
    { name: 'ዱቄት', nameLatin: 'Duket (Flour)', unit: UnitType.KG, cat: 'መሰረታዊ ጥሬ እቃዎች', catLatin: 'Basic Raw Materials' },
    { name: 'ገብስ', nameLatin: 'Gebs (Barley)', unit: UnitType.KG, cat: 'መሰረታዊ ጥሬ እቃዎች', catLatin: 'Basic Raw Materials' },
    { name: 'ስንዴ', nameLatin: 'Sinde (Wheat)', unit: UnitType.KG, cat: 'መሰረታዊ ጥሬ እቃዎች', catLatin: 'Basic Raw Materials' },
    { name: 'ስኳር', nameLatin: 'Sukar (Sugar)', unit: UnitType.KG, cat: 'መሰረታዊ ጥሬ እቃዎች', catLatin: 'Basic Raw Materials' },
    { name: 'የዱቄት ስኳር', nameLatin: 'Ye Duket Sukar (Sugar Powder)', unit: UnitType.KG, cat: 'መሰረታዊ ጥሬ እቃዎች', catLatin: 'Basic Raw Materials' },
    { name: 'እንቁላል', nameLatin: 'Enqulal (Egg)', unit: UnitType.PIECE, cat: 'መሰረታዊ ጥሬ እቃዎች', catLatin: 'Basic Raw Materials' },
    { name: 'እርሾ', nameLatin: 'Ersho (Yeast)', unit: UnitType.KG, cat: 'መሰረታዊ ጥሬ እቃዎች', catLatin: 'Basic Raw Materials' },
    { name: 'ማጂሚክስ', nameLatin: 'Majmex (Bread Improver)', unit: UnitType.PIECE, cat: 'መሰረታዊ ጥሬ እቃዎች', catLatin: 'Basic Raw Materials' },
    { name: 'ቤኪንግ ፓውደር', nameLatin: 'Baking Powder', unit: UnitType.KG, cat: 'መሰረታዊ ጥሬ እቃዎች', catLatin: 'Basic Raw Materials' },
    { name: 'ቤኪንግ ሶዳ', nameLatin: 'Baking Soda', unit: UnitType.KG, cat: 'መሰረታዊ ጥሬ እቃዎች', catLatin: 'Basic Raw Materials' },
    { name: 'ሱፐር ጋቶ', nameLatin: 'Super Gato', unit: UnitType.KG, cat: 'መሰረታዊ ጥሬ እቃዎች', catLatin: 'Basic Raw Materials' },
    { name: 'ቫዝሊኮ', nameLatin: 'Vazlico', unit: UnitType.KG, cat: 'መሰረታዊ ጥሬ እቃዎች', catLatin: 'Basic Raw Materials' },
    { name: 'ሾርትኒንግ', nameLatin: 'Shortening', unit: UnitType.KG, cat: 'መሰረታዊ ጥሬ እቃዎች', catLatin: 'Basic Raw Materials' },
    { name: 'ጨው', nameLatin: 'Chew (Salt)', unit: UnitType.KG, cat: 'መሰረታዊ ጥሬ እቃዎች', catLatin: 'Basic Raw Materials' },
    { name: 'የቀረፋ ዱቄት', nameLatin: 'Ye Qerefa Duket (Cinnamon Powder)', unit: UnitType.KG, cat: 'መሰረታዊ ጥሬ እቃዎች', catLatin: 'Basic Raw Materials' },
    { name: 'ቀረፋ', nameLatin: 'Qerefa (Cinnamon)', unit: UnitType.KG, cat: 'መሰረታዊ ጥሬ እቃዎች', catLatin: 'Basic Raw Materials' },
    { name: 'ኦቾሎኒ', nameLatin: 'Ocholoni (Peanut)', unit: UnitType.KG, cat: 'መሰረታዊ ጥሬ እቃዎች', catLatin: 'Basic Raw Materials' },
    { name: 'ጥቁር አዝሙድ', nameLatin: 'Tiqur Azmud (Black Cumin)', unit: UnitType.KG, cat: 'መሰረታዊ ጥሬ እቃዎች', catLatin: 'Basic Raw Materials' },
    { name: 'ሰሊጥ', nameLatin: 'Selit (Sesame)', unit: UnitType.KG, cat: 'መሰረታዊ ጥሬ እቃዎች', catLatin: 'Basic Raw Materials' },

    // --- 5.2 ክሬም፣ ግሌዝ እና ፍሌቨር ---
    { name: 'ሻንቲ ክሬም', nameLatin: 'Shanti Cream', unit: UnitType.KG, cat: 'ክሬም፣ ግሌዝ እና ፍሌቨር', catLatin: 'Creams, Glazes & Flavors' },
    { name: 'ካስተርድ ዱቄት', nameLatin: 'Casterd Powder', unit: UnitType.KG, cat: 'ክሬም፣ ግሌዝ እና ፍሌቨር', catLatin: 'Creams, Glazes & Flavors' },
    { name: 'ብሎክ ቸኮሌት', nameLatin: 'Chocolate Blok', unit: UnitType.PIECE, cat: 'ክሬም፣ ግሌዝ እና ፍሌቨር', catLatin: 'Creams, Glazes & Flavors' },
    { name: 'ፈሳሽ ቸኮሌት', nameLatin: 'Chocolate Liquid', unit: UnitType.LITER, cat: 'ክሬም፣ ግሌዝ እና ፍሌቨር', catLatin: 'Creams, Glazes & Flavors' },
    { name: 'ካካዋ', nameLatin: 'Cacawa (Cocoa)', unit: UnitType.KG, cat: 'ክሬም፣ ግሌዝ እና ፍሌቨር', catLatin: 'Creams, Glazes & Flavors' },
    { name: 'የስትሮቤሪ ግሌዝ', nameLatin: 'Strawberry Glaze', unit: UnitType.LITER, cat: 'ክሬም፣ ግሌዝ እና ፍሌቨር', catLatin: 'Creams, Glazes & Flavors' },
    { name: 'የካራሜል ግሌዝ', nameLatin: 'Caramel Glaze', unit: UnitType.LITER, cat: 'ክሬም፣ ግሌዝ እና ፍሌቨር', catLatin: 'Creams, Glazes & Flavors' },
    { name: 'የቸኮሌት ግሌዝ', nameLatin: 'Chocolate Glaze', unit: UnitType.LITER, cat: 'ክሬም፣ ግሌዝ እና ፍሌቨር', catLatin: 'Creams, Glazes & Flavors' },
    { name: 'የቫኒላ ግሌዝ', nameLatin: 'Vanilla Glaze', unit: UnitType.LITER, cat: 'ክሬም፣ ግሌዝ እና ፍሌቨር', catLatin: 'Creams, Glazes & Flavors' },
    { name: 'የሙዝ ግሌዝ', nameLatin: 'Banana Glaze', unit: UnitType.LITER, cat: 'ክሬም፣ ግሌዝ እና ፍሌቨር', catLatin: 'Creams, Glazes & Flavors' },
    { name: 'የብርቱካን ግሌዝ', nameLatin: 'Orange Glaze', unit: UnitType.LITER, cat: 'ክሬም፣ ግሌዝ እና ፍሌቨር', catLatin: 'Creams, Glazes & Flavors' },
    { name: 'ናቹራል ግሌዝ', nameLatin: 'Natural Glaze', unit: UnitType.LITER, cat: 'ክሬም፣ ግሌዝ እና ፍሌቨር', catLatin: 'Creams, Glazes & Flavors' },
    { name: 'የቫኒላ ፍሌቨር', nameLatin: 'Vanilla Flavor', unit: UnitType.LITER, cat: 'ክሬም፣ ግሌዝ እና ፍሌቨር', catLatin: 'Creams, Glazes & Flavors' },
    { name: 'የብርቱካን ፍሌቨር', nameLatin: 'Orange Flavor', unit: UnitType.LITER, cat: 'ክሬም፣ ግሌዝ እና ፍሌቨር', catLatin: 'Creams, Glazes & Flavors' },

    // --- 5.3 የሳምቡሳ ግብዓቶች እና የምግብ ዘይት ---
    { name: 'ምስር', nameLatin: 'Misir (Lentils)', unit: UnitType.KG, cat: 'የሳምቡሳ ግብዓቶች እና የምግብ ዘይት', catLatin: 'Sambusa Ingredients & Oil' },
    { name: 'ሽንኩርት', nameLatin: 'Shinkurt (Onions)', unit: UnitType.KG, cat: 'የሳምቡሳ ግብዓቶች እና የምግብ ዘይት', catLatin: 'Sambusa Ingredients & Oil' },
    { name: 'ቃሪያ', nameLatin: 'Qariya (Green Pepper)', unit: UnitType.KG, cat: 'የሳምቡሳ ግብዓቶች እና የምግብ ዘይት', catLatin: 'Sambusa Ingredients & Oil' },
    { name: 'ቲማቲም', nameLatin: 'Timatim (Tomatoes)', unit: UnitType.KG, cat: 'የሳምቡሳ ግብዓቶች እና የምግብ ዘይት', catLatin: 'Sambusa Ingredients & Oil' },
    { name: 'በርበሬ', nameLatin: 'Berbere', unit: UnitType.KG, cat: 'የሳምቡሳ ግብዓቶች እና የምግብ ዘይት', catLatin: 'Sambusa Ingredients & Oil' },
    { name: 'የምግብ ዘይት 20 ሊትር', nameLatin: 'Ye Mgib Zeyt 20L', unit: UnitType.PIECE, cat: 'የሳምቡሳ ግብዓቶች እና የምግብ ዘይት', catLatin: 'Sambusa Ingredients & Oil' },
    { name: 'የምግብ ዘይት 5 ሊትር', nameLatin: 'Ye Mgib Zeyt 5L', unit: UnitType.PIECE, cat: 'የሳምቡሳ ግብዓቶች እና የምግብ ዘይት', catLatin: 'Sambusa Ingredients & Oil' },

    // --- 5.4 ሳጥኖች፣ ሰሌዳዎች እና ፓኬጂንግ ---
    { name: 'የኬክ ሰሌዳ 0.5 ኪሎ', nameLatin: 'Cake Bord 0.5kg', unit: UnitType.PIECE, cat: 'ሳጥኖች፣ ሰሌዳዎች እና ፓኬጂንግ', catLatin: 'Packaging & Containers' },
    { name: 'የኬክ ሰሌዳ 1 ኪሎ', nameLatin: 'Cake Bord 1kg', unit: UnitType.PIECE, cat: 'ሳጥኖች፣ ሰሌዳዎች እና ፓኬጂንግ', catLatin: 'Packaging & Containers' },
    { name: 'የኬክ ሰሌዳ 1.5 ኪሎ', nameLatin: 'Cake Bord 1.5kg', unit: UnitType.PIECE, cat: 'ሳጥኖች፣ ሰሌዳዎች እና ፓኬጂንግ', catLatin: 'Packaging & Containers' },
    { name: 'የኬክ ሰሌዳ 2 ኪሎ', nameLatin: 'Cake Bord 2kg', unit: UnitType.PIECE, cat: 'ሳጥኖች፣ ሰሌዳዎች እና ፓኬጂንግ', catLatin: 'Packaging & Containers' },
    { name: 'የኬክ ሳጥን 0.5 ኪሎ', nameLatin: 'Cake Box 0.5kg', unit: UnitType.PIECE, cat: 'ሳጥኖች፣ ሰሌዳዎች እና ፓኬጂንግ', catLatin: 'Packaging & Containers' },
    { name: 'የኬክ ሳጥን 1 ኪሎ', nameLatin: 'Cake Box 1kg', unit: UnitType.PIECE, cat: 'ሳጥኖች፣ ሰሌዳዎች እና ፓኬጂንግ', catLatin: 'Packaging & Containers' },
    { name: 'የኬክ ሳጥን 3 ኪሎ', nameLatin: 'Cake Box 3kg', unit: UnitType.PIECE, cat: 'ሳጥኖች፣ ሰሌዳዎች እና ፓኬጂንግ', catLatin: 'Packaging & Containers' },
    { name: 'የኬክ ሳጥን 3.5 ኪሎ', nameLatin: 'Cake Box 3.5kg', unit: UnitType.PIECE, cat: 'ሳጥኖች፣ ሰሌዳዎች እና ፓኬጂንግ', catLatin: 'Packaging & Containers' },
    { name: 'የሩብ ቴክ አዌይ', nameLatin: 'Teky Away Ye Rub', unit: UnitType.PIECE, cat: 'ሳጥኖች፣ ሰሌዳዎች እና ፓኬጂንግ', catLatin: 'Packaging & Containers' },
    { name: 'የግማሽ ቴክ አዌይ', nameLatin: 'Teky Away Ye Gimash', unit: UnitType.PIECE, cat: 'ሳጥኖች፣ ሰሌዳዎች እና ፓኬጂንግ', catLatin: 'Packaging & Containers' },
    { name: 'የኪሎ ቴክ አዌይ', nameLatin: 'Teky Away Ye Kilo', unit: UnitType.PIECE, cat: 'ሳጥኖች፣ ሰሌዳዎች እና ፓኬጂንግ', catLatin: 'Packaging & Containers' },
    { name: 'ተከዳኝ ባለ 1', nameLatin: 'Tekedagn Bale 1', unit: UnitType.PIECE, cat: 'ሳጥኖች፣ ሰሌዳዎች እና ፓኬጂንግ', catLatin: 'Packaging & Containers' },
    { name: 'ተከዳኝ ባለ 2', nameLatin: 'Tekedagn Bale 2', unit: UnitType.PIECE, cat: 'ሳጥኖች፣ ሰሌዳዎች እና ፓኬጂንግ', catLatin: 'Packaging & Containers' },
    { name: 'ፕላስቲክ ኩባያ', nameLatin: 'Cup (Plastic Cup)', unit: UnitType.PIECE, cat: 'ሳጥኖች፣ ሰሌዳዎች እና ፓኬጂንግ', catLatin: 'Packaging & Containers' },
    { name: 'ፋልኮን ፎይል', nameLatin: 'Falcon Foil', unit: UnitType.PIECE, cat: 'ሳጥኖች፣ ሰሌዳዎች እና ፓኬጂንግ', catLatin: 'Packaging & Containers' },
    { name: 'ፌስታል', nameLatin: 'Festal (Plastic Bags)', unit: UnitType.PIECE, cat: 'ሳጥኖች፣ ሰሌዳዎች እና ፓኬጂንግ', catLatin: 'Packaging & Containers' },
    { name: 'ፕላስቲክ ማንኪያ', nameLatin: 'Spun (Spoon)', unit: UnitType.PIECE, cat: 'ሳጥኖች፣ ሰሌዳዎች እና ፓኬጂንግ', catLatin: 'Packaging & Containers' },
    { name: 'ማገር', nameLatin: 'Mager', unit: UnitType.PIECE, cat: 'ሳጥኖች፣ ሰሌዳዎች እና ፓኬጂንግ', catLatin: 'Packaging & Containers' },
    { name: 'ካቻች', nameLatin: 'Kachach', unit: UnitType.PIECE, cat: 'ሳጥኖች፣ ሰሌዳዎች እና ፓኬጂንግ', catLatin: 'Packaging & Containers' },

    // --- 5.5 የጽዳት እቃዎች እና ነዳጅ ---
    { name: 'ናፍጣ', nameLatin: 'Nafta (Diesel)', unit: UnitType.LITER, cat: 'የጽዳት እቃዎች እና ነዳጅ', catLatin: 'Cleaning & Fuel' },
    { name: 'ላርጎ ፈሳሽ ሳሙና', nameLatin: 'Largo (Liquid Soap)', unit: UnitType.PIECE, cat: 'የጽዳት እቃዎች እና ነዳጅ', catLatin: 'Cleaning & Fuel' },
    { name: 'ጥቅል ሳሙን', nameLatin: 'Tiql Samun (Soap Roll)', unit: UnitType.PIECE, cat: 'የጽዳት እቃዎች እና ነዳጅ', catLatin: 'Cleaning & Fuel' },
    { name: 'ሳሙና', nameLatin: 'Samuna (Bar Soap)', unit: UnitType.PIECE, cat: 'የጽዳት እቃዎች እና ነዳጅ', catLatin: 'Cleaning & Fuel' },
  ];

  console.log(`📦 Seeding stock items across ${branches.length} branches (${stockList.length} items each)...`);
  for (const b of branches) {
    for (const s of stockList) {
      await prisma.stockItem.create({
        data: {
          branchId: b.id,
          name: s.name,
          nameLatin: s.nameLatin,
          category: s.cat,
          categoryLatin: s.catLatin,
          unitType: s.unit,
          currentQuantity: 0,
          unitPrice: 0,
          minStockLevel: 10,
        },
      });
    }
  }

  console.log('🎉 SUCCESSFULLY SEEDED ALL PRODUCTS AND STOCK ITEMS!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
