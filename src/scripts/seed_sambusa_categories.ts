import { PrismaClient, Role, CategoryType, UnitType } from '@prisma/client';

const rawUrl = process.env.DATABASE_URL || '';
const sessionUrl = rawUrl.replace(':6543/', ':5432/').replace('&pgbouncer=true', '').replace('?pgbouncer=true', '?');
const prisma = new PrismaClient(sessionUrl ? { datasources: { db: { url: sessionUrl } } } : undefined);

async function main() {
  console.log('\n======================================================');
  console.log('🥟 Seeding 3 Categories & Products for SAMBUSA_WORKER');
  console.log('======================================================\n');

  // Find revenue financial category
  const finCat = await prisma.financialCategory.findFirst({
    where: { type: 'REVENUE' },
  });

  const categoriesToSeed = [
    {
      name: 'Sambusa Specialties',
      type: CategoryType.PRODUCED,
      productionRole: Role.SAMBUSA_WORKER,
      products: [
        {
          name: 'Crispy Beef Sambusa',
          flavor: 'Spiced Minced Beef & Green Peppers',
          unitType: UnitType.PIECE,
          basePrice: 35,
          buyPrice: 20,
          imageUrl: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=600&q=80',
        },
        {
          name: 'Spicy Lentil Sambusa',
          flavor: 'Brown Lentil, Onion & Jalapeño',
          unitType: UnitType.PIECE,
          basePrice: 25,
          buyPrice: 15,
          imageUrl: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=600&q=80',
        },
      ],
    },
    {
      name: 'Savory Pies & Patties',
      type: CategoryType.PRODUCED,
      productionRole: Role.SAMBUSA_WORKER,
      products: [
        {
          name: 'Chicken Veggie Patty',
          flavor: 'Shredded Chicken, Carrots & Peas',
          unitType: UnitType.PIECE,
          basePrice: 45,
          buyPrice: 25,
          imageUrl: 'https://images.unsplash.com/photo-1541592106381-b31e9677c0e5?auto=format&fit=crop&w=600&q=80',
        },
        {
          name: 'Cheese & Spinach Roll',
          flavor: 'Feta Cheese & Garden Spinach',
          unitType: UnitType.PIECE,
          basePrice: 40,
          buyPrice: 22,
          imageUrl: 'https://images.unsplash.com/photo-1509722747041-616f39b57569?auto=format&fit=crop&w=600&q=80',
        },
      ],
    },
    {
      name: 'Fried Dough & Fritters',
      type: CategoryType.PRODUCED,
      productionRole: Role.SAMBUSA_WORKER,
      products: [
        {
          name: 'Sugar Bombolino',
          flavor: 'Fluffy Fried Dough dusted with Fine Sugar',
          unitType: UnitType.PIECE,
          basePrice: 20,
          buyPrice: 10,
          imageUrl: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=600&q=80',
        },
        {
          name: 'Cinnamon Twist Donut',
          flavor: 'Twisted Dough with Cinnamon Brown Sugar',
          unitType: UnitType.PIECE,
          basePrice: 25,
          buyPrice: 12,
          imageUrl: 'https://images.unsplash.com/photo-1527515637462-cff94eecc1ac?auto=format&fit=crop&w=600&q=80',
        },
      ],
    },
  ];

  for (const catData of categoriesToSeed) {
    const category = await prisma.productCategory.upsert({
      where: { name: catData.name },
      update: {
        type: catData.type,
        productionRole: catData.productionRole,
      },
      create: {
        name: catData.name,
        type: catData.type,
        productionRole: catData.productionRole,
      },
    });

    console.log(`✅ Category: "${category.name}" (Role: ${category.productionRole})`);

    for (const prodData of catData.products) {
      const product = await prisma.product.upsert({
        where: { id: `seed-sambusa-${prodData.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}` },
        update: {
          name: prodData.name,
          flavor: prodData.flavor,
          unitType: prodData.unitType,
          basePrice: prodData.basePrice,
          buyPrice: prodData.buyPrice,
          imageUrl: prodData.imageUrl,
          categoryId: category.id,
          financialCategoryId: finCat ? finCat.id : null,
          isActive: true,
        },
        create: {
          id: `seed-sambusa-${prodData.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
          name: prodData.name,
          flavor: prodData.flavor,
          unitType: prodData.unitType,
          basePrice: prodData.basePrice,
          buyPrice: prodData.buyPrice,
          imageUrl: prodData.imageUrl,
          categoryId: category.id,
          financialCategoryId: finCat ? finCat.id : null,
          isActive: true,
          branchIds: [],
        },
      });

      console.log(`   📦 Product: "${product.name}" [${product.flavor}] - ${product.basePrice} ETB`);
    }
  }

  console.log('\n🎉 Successfully seeded 3 Sambusa categories with 6 products!\n');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding Sambusa categories:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
