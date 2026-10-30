import { PrismaClient, Role } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

const rawUrl = process.env.DATABASE_URL || '';
const sessionUrl = rawUrl.replace(':6543/', ':5432/').replace('&pgbouncer=true', '').replace('?pgbouncer=true', '?');
const prisma = new PrismaClient(sessionUrl ? { datasources: { db: { url: sessionUrl } } } : undefined);

interface MappingRule {
  description: string;
  pdfNumber: string;
  roles: Role[];
  match: (name: string, nameLatin: string | null) => boolean;
}

const ALL_PROD_ROLES: Role[] = [Role.BAKER, Role.SAMBUSA_WORKER, Role.CAKE_WORKER];
const BAKER_AND_CAKE: Role[] = [Role.BAKER, Role.CAKE_WORKER];
const SAMBUSA_AND_CAKE: Role[] = [Role.SAMBUSA_WORKER, Role.CAKE_WORKER];
const BAKER_ONLY: Role[] = [Role.BAKER];
const SAMBUSA_ONLY: Role[] = [Role.SAMBUSA_WORKER];
const CAKE_ONLY: Role[] = [Role.CAKE_WORKER];
const STOCK_KEEPER_ONLY: Role[] = []; // Left empty for production, accessible only to Stock Keeper & Owner

const RULES: MappingRule[] = [
  // 1. Flour kg -> 4 (ALL)
  {
    description: 'Flour kg (ዱቄት)',
    pdfNumber: '4',
    roles: ALL_PROD_ROLES,
    match: (n, l) => (n.includes('ዱቄት') && !n.includes('የዱቄት ስኳር') && !n.includes('ቀረፋ') && !n.includes('ቤኪንግ')) || (!!l && l.toLowerCase().includes('flour') && !l.toLowerCase().includes('sugar') && !l.toLowerCase().includes('powder')),
  },

  // 2. Gebs kg -> 1 (BAKER)
  {
    description: 'Gebs kg (ገብስ)',
    pdfNumber: '1',
    roles: BAKER_ONLY,
    match: (n, l) => n.includes('ገብስ') || (!!l && l.toLowerCase().includes('gebs')),
  },

  // 3. Sinde kg -> 1 (BAKER)
  {
    description: 'Sinde kg (ስንዴ)',
    pdfNumber: '1',
    roles: BAKER_ONLY,
    match: (n, l) => n.includes('ስንዴ') || (!!l && l.toLowerCase().includes('sinde')),
  },

  // 4. Sugar g -> 4 (ALL)
  {
    description: 'Sugar (ስኳር - regular)',
    pdfNumber: '4',
    roles: ALL_PROD_ROLES,
    match: (n, l) => (n === 'ስኳር' || n.includes('ስኳር')) && !n.includes('የዱቄት') && (!l || !l.toLowerCase().includes('powder')),
  },

  // 5. Sugar powder kg -> 3 (CAKE)
  {
    description: 'Sugar powder (የዱቄት ስኳር)',
    pdfNumber: '3',
    roles: CAKE_ONLY,
    match: (n, l) => n.includes('የዱቄት ስኳር') || (!!l && l.toLowerCase().includes('sugar powder')),
  },

  // 6. Egg pcs -> 1,3 (BAKER & CAKE)
  {
    description: 'Egg pcs (እንቁላል)',
    pdfNumber: '1,3',
    roles: BAKER_AND_CAKE,
    match: (n, l) => n.includes('እንቁላል') || (!!l && l.toLowerCase().includes('egg')),
  },

  // 7. Yeast g -> 4 (ALL)
  {
    description: 'Yeast g (እርሾ)',
    pdfNumber: '4',
    roles: ALL_PROD_ROLES,
    match: (n, l) => n.includes('እርሾ') || (!!l && l.toLowerCase().includes('yeast')),
  },

  // 8. Majmex pis -> 1 (BAKER)
  {
    description: 'Majmex pis (ማጂሚክስ)',
    pdfNumber: '1',
    roles: BAKER_ONLY,
    match: (n, l) => n.includes('ማጂሚክስ') || (!!l && l.toLowerCase().includes('majmex')),
  },

  // 9. Baking powder g -> 1,3 (BAKER & CAKE)
  {
    description: 'Baking powder g (ቤኪንግ ፓውደር)',
    pdfNumber: '1,3',
    roles: BAKER_AND_CAKE,
    match: (n, l) => n.includes('ቤኪንግ ፓውደር') || (!!l && l.toLowerCase().includes('baking powder')),
  },

  // 10. Super Gato g -> 3 (CAKE)
  {
    description: 'Super Gato g (ሱፐር ጋቶ)',
    pdfNumber: '3',
    roles: CAKE_ONLY,
    match: (n, l) => n.includes('ሱፐር ጋቶ') || (!!l && l.toLowerCase().includes('super gato')),
  },

  // 11. Vazlico g -> 3 (CAKE)
  {
    description: 'Vazlico g (ቫዝሊኮ)',
    pdfNumber: '3',
    roles: CAKE_ONLY,
    match: (n, l) => n.includes('ቫዝሊኮ') || (!!l && l.toLowerCase().includes('vazlico')),
  },

  // 12. Glaze: Strawberry, Caramel, Chocolate, Vanilla, Banana, Orange, Natural -> 3 (CAKE)
  {
    description: 'Glazes (የእንጆሪ/ካራሜል/ቸኮሌት/ቫኒላ/ሙዝ/ብርቱካን/ናቹራል ግሌዝ)',
    pdfNumber: '3',
    roles: CAKE_ONLY,
    match: (n, l) => n.includes('ግሌዝ') || (!!l && l.toLowerCase().includes('glaze')),
  },

  // 13. Flavors: Orange Flavor, Vanilla Flavor -> 3 (CAKE)
  {
    description: 'Flavors (የቫኒላ/ብርቱካን ፍሌቨር)',
    pdfNumber: '3',
    roles: CAKE_ONLY,
    match: (n, l) => n.includes('ፍሌቨር') || (!!l && l.toLowerCase().includes('flavor')),
  },

  // 14. Cacawa -> 1,3 (BAKER & CAKE)
  {
    description: 'Cacawa (ኮኮዋ)',
    pdfNumber: '1,3',
    roles: BAKER_AND_CAKE,
    match: (n, l) => n.includes('ኮኮዋ') || (!!l && (l.toLowerCase().includes('cacawa') || l.toLowerCase().includes('cocoa'))),
  },

  // 15. Baking soda g -> 3 (CAKE)
  {
    description: 'Baking soda g (ቤኪንግ ሶዳ)',
    pdfNumber: '3',
    roles: CAKE_ONLY,
    match: (n, l) => n.includes('ቤኪንግ ሶዳ') || (!!l && l.toLowerCase().includes('baking soda')),
  },

  // 16. Sinamen / Sinamen powder -> 1,3 or 3 (BAKER & CAKE)
  {
    description: 'Sinamen / Cinnamon (ቀረፋ)',
    pdfNumber: '1,3',
    roles: BAKER_AND_CAKE,
    match: (n, l) => n.includes('ቀረፋ') || (!!l && (l.toLowerCase().includes('sinamen') || l.toLowerCase().includes('cinnamon'))),
  },

  // 17. Pinat g -> 3 (CAKE)
  {
    description: 'Pinat g (ለውዝ)',
    pdfNumber: '3',
    roles: CAKE_ONLY,
    match: (n, l) => n.includes('ለውዝ') || (!!l && (l.toLowerCase().includes('pinat') || l.toLowerCase().includes('peanut'))),
  },

  // 18. Oil 20 L pis -> 4 (ALL)
  {
    description: 'Oil 20 L (የምግብ ዘይት 20 ሊትር)',
    pdfNumber: '4',
    roles: ALL_PROD_ROLES,
    match: (n, l) => (n.includes('ዘይት') && n.includes('20')) || (!!l && l.toLowerCase().includes('20l')),
  },

  // 19. Oil 5 L g -> 1 (BAKER)
  {
    description: 'Oil 5 L (የምግብ ዘይት 5 ሊትር)',
    pdfNumber: '1',
    roles: BAKER_ONLY,
    match: (n, l) => (n.includes('ዘይት') && n.includes('5')) || (!!l && l.toLowerCase().includes('5l')),
  },

  // 20. Salt g -> 4 (ALL)
  {
    description: 'Salt g (ጨው)',
    pdfNumber: '4',
    roles: ALL_PROD_ROLES,
    match: (n, l) => n.includes('ጨው') || (!!l && l.toLowerCase().includes('salt')),
  },

  // 21. Misir kg -> 2 (SAMBUSA)
  {
    description: 'Misir kg (ምስር)',
    pdfNumber: '2',
    roles: SAMBUSA_ONLY,
    match: (n, l) => n.includes('ምስር') || (!!l && l.toLowerCase().includes('misir')),
  },

  // 22. Tikur Azmud g -> 1 (BAKER)
  {
    description: 'Tikur Azmud g (ጥቁር አዝሙድ)',
    pdfNumber: '1',
    roles: BAKER_ONLY,
    match: (n, l) => n.includes('ጥቁር አዝሙድ') || (!!l && l.toLowerCase().includes('tikur azmud')),
  },

  // 23. Selit g -> 1 (BAKER)
  {
    description: 'Selit g (ሰሊጥ)',
    pdfNumber: '1',
    roles: BAKER_ONLY,
    match: (n, l) => n.includes('ሰሊጥ') || (!!l && l.toLowerCase().includes('selit')),
  },

  // 24. Chocolate blok & Chocolate liquid -> 1,3 (BAKER & CAKE)
  {
    description: 'Chocolate block & liquid (ቸኮሌት ብሎክ/ፈሳሽ ቸኮሌት)',
    pdfNumber: '1,3',
    roles: BAKER_AND_CAKE,
    match: (n, l) => (n.includes('ቸኮሌት') && !n.includes('ግሌዝ')) || (!!l && l.toLowerCase().includes('chocolate') && !l.toLowerCase().includes('glaze')),
  },

  // 25. Honey (ማር) -> 2,3 (SAMBUSA & CAKE)
  {
    description: 'Honey (ማር)',
    pdfNumber: '2,3',
    roles: SAMBUSA_AND_CAKE,
    match: (n, l) => n === 'ማር' || n.includes('ማር') || (!!l && l.toLowerCase().includes('honey')),
  },

  // 26. Ketchup (ካቻፕ/ኬቻፕ) -> 2 (SAMBUSA)
  {
    description: 'Ketchup (ካቻፕ/ኬቻፕ)',
    pdfNumber: '2',
    roles: SAMBUSA_ONLY,
    match: (n, l) => n.includes('ካቻፕ') || n.includes('ኬቻፕ') || (!!l && l.toLowerCase().includes('ketchup')),
  },

  // 27. Onions kg (ሽንኩርት) -> 2 (SAMBUSA)
  {
    description: 'Onions kg (ሽንኩርት)',
    pdfNumber: '2',
    roles: SAMBUSA_ONLY,
    match: (n, l) => n.includes('ሽንኩርት') || (!!l && l.toLowerCase().includes('shinkurt')),
  },

  // 28. Tikil Gomen (ጥቅል ጎመን) -> 2 (SAMBUSA)
  {
    description: 'Tikil Gomen (ጥቅል ጎመን)',
    pdfNumber: '2',
    roles: SAMBUSA_ONLY,
    match: (n, l) => n.includes('ጥቅል ጎመን') || (!!l && (l.toLowerCase().includes('gomen') || l.toLowerCase().includes('cabbage'))),
  },

  // 29. Karia g (ቃሪያ) -> 2 (SAMBUSA)
  {
    description: 'Karia g (ቃሪያ)',
    pdfNumber: '2',
    roles: SAMBUSA_ONLY,
    match: (n, l) => n.includes('ቃሪያ') || (!!l && l.toLowerCase().includes('qariya')),
  },

  // 30. Timatim g (ቲማቲም) -> 2 (SAMBUSA)
  {
    description: 'Timatim g (ቲማቲም)',
    pdfNumber: '2',
    roles: SAMBUSA_ONLY,
    match: (n, l) => n.includes('ቲማቲም') || (!!l && l.toLowerCase().includes('timatim')),
  },

  // 31. Berbere (በርበሬ) -> 2 (SAMBUSA)
  {
    description: 'Berbere (በርበሬ)',
    pdfNumber: '2',
    roles: SAMBUSA_ONLY,
    match: (n, l) => n.includes('በርበሬ') || (!!l && l.toLowerCase().includes('berbere')),
  },

  // 32. Shanti g (ሻንቲ ክሬም) -> 3 (CAKE)
  {
    description: 'Shanti cream (ሻንቲ ክሬም)',
    pdfNumber: '3',
    roles: CAKE_ONLY,
    match: (n, l) => n.includes('ሻንቲ') || (!!l && l.toLowerCase().includes('shanti')),
  },

  // 33. Casterd g (ካስተርድ) -> 3 (CAKE)
  {
    description: 'Custard (ካስተርድ)',
    pdfNumber: '3',
    roles: CAKE_ONLY,
    match: (n, l) => n.includes('ካስተርድ') || (!!l && l.toLowerCase().includes('casterd')),
  },

  // 34. Shortening kg (ሾርትኒንግ) -> 3 (CAKE)
  {
    description: 'Shortening (ሾርትኒንግ)',
    pdfNumber: '3',
    roles: CAKE_ONLY,
    match: (n, l) => n.includes('ሾርትኒንግ') || (!!l && l.toLowerCase().includes('shortening')),
  },

  // 35. Cake bord (የኬክ ሰሌዳ) -> 3 (CAKE)
  {
    description: 'Cake board (የኬክ ሰሌዳ)',
    pdfNumber: '3',
    roles: CAKE_ONLY,
    match: (n, l) => n.includes('የኬክ ሰሌዳ') || (!!l && l.toLowerCase().includes('cake bord')),
  },

  // 36. Cup pis (ፕላስቲክ ኩባያ) -> 3 (CAKE)
  {
    description: 'Cup pis (ፕላስቲክ ኩባያ)',
    pdfNumber: '3',
    roles: CAKE_ONLY,
    match: (n, l) => n.includes('ፕላስቲክ ኩባያ') || (!!l && l.toLowerCase().includes('cup')),
  },

  // 37. Stock Keeper Items (5) -> Left empty for production
  {
    description: 'Stock Keeper Items: Festal, Spoon, Nafta, Largo, Samuna, Cake box, Take away, Falcon',
    pdfNumber: '5',
    roles: STOCK_KEEPER_ONLY,
    match: (n, l) =>
      n.includes('ፌስታል') ||
      n.includes('ማንኪያ') ||
      n.includes('ናፍጣ') ||
      n.includes('ላርጎ') ||
      n.includes('ሳሙና') ||
      n.includes('ሳሙን') ||
      n.includes('የኬክ ሳጥን') ||
      n.includes('ቴክ አዌይ') ||
      n.includes('ተከዳኝ') ||
      n.includes('ፎይል') ||
      n.includes('ማገር') ||
      n.includes('ካቻች') ||
      (!!l &&
        (l.toLowerCase().includes('festal') ||
          l.toLowerCase().includes('spun') ||
          l.toLowerCase().includes('nafta') ||
          l.toLowerCase().includes('largo') ||
          l.toLowerCase().includes('samuna') ||
          l.toLowerCase().includes('cake box') ||
          l.toLowerCase().includes('teky away') ||
          l.toLowerCase().includes('tekedagn') ||
          l.toLowerCase().includes('falcon'))),
  },
];

async function main() {
  console.log('🌾 Starting Stock Materials Role Mapping Seed...');
  const items = await prisma.stockItem.findMany();
  console.log(`📦 Found ${items.length} total stock items across all branches.`);

  let updatedCount = 0;
  const roleStats = {
    BAKER: 0,
    SAMBUSA_WORKER: 0,
    CAKE_WORKER: 0,
    STOCK_KEEPER_ONLY: 0,
  };

  for (const item of items) {
    let matchedRule: MappingRule | null = null;

    for (const rule of RULES) {
      if (rule.match(item.name, item.nameLatin)) {
        matchedRule = rule;
        break;
      }
    }

    const assignedRoles: Role[] = matchedRule ? matchedRule.roles : [];

    await prisma.stockItem.update({
      where: { id: item.id },
      data: { allowedRoles: assignedRoles },
    });
    updatedCount++;

    if (assignedRoles.includes(Role.BAKER)) roleStats.BAKER++;
    if (assignedRoles.includes(Role.SAMBUSA_WORKER)) roleStats.SAMBUSA_WORKER++;
    if (assignedRoles.includes(Role.CAKE_WORKER)) roleStats.CAKE_WORKER++;
    if (assignedRoles.length === 0) roleStats.STOCK_KEEPER_ONLY++;

    const roleLabel = assignedRoles.length > 0 ? assignedRoles.join(', ') : 'STOCK_KEEPER_ONLY';
    console.log(`✅ [${matchedRule ? matchedRule.pdfNumber : '5'}] ${item.name} (${item.nameLatin || ''}) -> ${roleLabel}`);
  }

  console.log('\n📊 Seeding Complete Summary:');
  console.log(`Total Stock Items Updated: ${updatedCount}`);
  console.log(`🥖 Baker Accessible Items: ${roleStats.BAKER}`);
  console.log(`🥟 Sambusa Worker Accessible Items: ${roleStats.SAMBUSA_WORKER}`);
  console.log(`🎂 Cake Worker Accessible Items: ${roleStats.CAKE_WORKER}`);
  console.log(`📦 Stock Keeper / Warehouse Only Items: ${roleStats.STOCK_KEEPER_ONLY}`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
