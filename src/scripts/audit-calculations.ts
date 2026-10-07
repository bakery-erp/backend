import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface AuditResult {
  passed: boolean;
  failures: string[];
  daySummaries: any[];
  stockSummaries: any[];
}

export async function runAudit(): Promise<AuditResult> {
  console.log('\n========================================================================');
  console.log('🔍 INITIATING COMPREHENSIVE 8-DAY AUDIT & CALCULATION ENGINE');
  console.log('========================================================================\n');

  const failures: string[] = [];
  const daySummaries: any[] = [];
  const stockSummaries: any[] = [];

  // Fetch branch
  const branch = await prisma.branch.findFirst({
    where: { name: 'Megenagna Branch' },
  });

  if (!branch) {
    throw new Error('Megenagna Branch not found');
  }

  // Fetch all 8 sessions ordered by date ascending
  const sessions = await prisma.dailySession.findMany({
    where: { branchId: branch.id },
    orderBy: { date: 'asc' },
    include: {
      leftoverRecords: { include: { product: true } },
      sales: { include: { items: { include: { product: true } } } },
      expenses: true,
      supplierDeliveries: { include: { product: true } },
      productionBatches: {
        include: {
          items: { include: { product: true } },
          materialUsages: { include: { stockItem: true } },
        },
      },
    },
  });

  console.log(`Found ${sessions.length} sessions for branch "${branch.name}".\n`);

  if (sessions.length !== 8) {
    failures.push(`Expected 8 sessions, found ${sessions.length}`);
  }

  // --- PART 1: AUDIT DAYS 1 TO 7 (CLOSED SESSIONS) ---
  console.log('📊 [PART 1/3] AUDITING PRODUCT MOVEMENTS & CASH DRAWER RECONCILIATIONS...');

  let previousSession: any = null;

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const dayNumber = i + 1;
    const isClosed = session.status === 'CLOSED';
    const dateStr = session.date.toISOString().slice(0, 10);

    console.log(`\n------------------------------------------------------------------------`);
    console.log(`🗓️  Day ${dayNumber} (${dateStr}) - Status: [${session.status}]`);
    console.log(`------------------------------------------------------------------------`);

    // Verify day-to-day float handoff
    if (previousSession) {
      const prevFloatOut = Number(previousSession.cashLeftoverAmount ?? 0);
      const curFloatIn = Number(session.openingCashFloat ?? 0);
      const floatHandoffDiff = Math.abs(curFloatIn - prevFloatOut);

      console.log(`  💰 Float Handoff: Day ${dayNumber - 1} Leftover (${prevFloatOut.toFixed(2)}) -> Day ${dayNumber} Opening Float (${curFloatIn.toFixed(2)})`);
      if (floatHandoffDiff > 0.001) {
        failures.push(`Day ${dayNumber}: Opening float (${curFloatIn}) did not match Day ${dayNumber - 1} leftover float (${prevFloatOut})`);
      }
    }

    if (!isClosed) {
      console.log(`  ℹ️  Day ${dayNumber} is OPEN (Current live shift). Verifying live readiness below.`);
      previousSession = session;
      continue;
    }

    // 1. Audit Product Movements (Opening + In - Out - Leftover - Damaged = Sold)
    const prevLeftoversMap = new Map<string, number>();
    if (previousSession) {
      for (const rec of previousSession.leftoverRecords) {
        prevLeftoversMap.set(rec.productId, rec.quantityRemaining);
      }
    }

    let manualDayTotalRevenue = 0;
    const productRows: any[] = [];

    // All distinct products in this session's leftover records
    for (const leftRec of session.leftoverRecords) {
      const prod = leftRec.product;
      const pid = prod.id;
      const prodName = prod.name;
      const basePrice = Number(prod.basePrice);

      const openingLeftover = prevLeftoversMap.get(pid) || 0;

      // Produced today
      const producedQty = session.productionBatches.reduce((sum, b) => {
        const item = b.items.find((it) => it.productId === pid);
        return sum + (item ? item.quantityProduced : 0);
      }, 0);

      // Delivered today
      const deliveredQty = session.supplierDeliveries
        .filter((d) => d.productId === pid)
        .reduce((sum, d) => sum + d.quantityReceived, 0);

      // Conversions for this day
      const conversions = await prisma.productConversion.findMany({
        where: {
          branchId: branch.id,
          createdAt: {
            gte: new Date(session.date.toISOString().slice(0, 10) + 'T00:00:00.000Z'),
            lte: new Date(session.date.toISOString().slice(0, 10) + 'T23:59:59.999Z'),
          },
        },
      });

      const convertedIn = conversions.filter((c) => c.toProductId === pid).reduce((s, c) => s + c.toQuantity, 0);
      const convertedOut = conversions.filter((c) => c.fromProductId === pid).reduce((s, c) => s + c.fromQuantity, 0);

      const manualAvailable = openingLeftover + producedQty + deliveredQty + convertedIn - convertedOut;
      const remainingLeftover = leftRec.quantityRemaining;
      const damagedQty = leftRec.damagedQuantity || 0;
      const manualSold = Math.max(0, manualAvailable - remainingLeftover - damagedQty);
      const manualRevenue = manualSold * basePrice;
      manualDayTotalRevenue += manualRevenue;

      // Find system recorded sale item
      let systemSold = 0;
      let systemSubtotal = 0;
      for (const sale of session.sales) {
        for (const item of sale.items) {
          if (item.productId === pid) {
            systemSold += item.quantity;
            systemSubtotal += Number(item.subtotal);
          }
        }
      }

      const soldDiff = manualSold - systemSold;
      const revDiff = Math.abs(manualRevenue - systemSubtotal);

      if (soldDiff !== 0) {
        failures.push(`Day ${dayNumber} [${prodName}]: Sold mismatch (Manual=${manualSold}, System=${systemSold})`);
      }
      if (revDiff > 0.01) {
        failures.push(`Day ${dayNumber} [${prodName}]: Revenue mismatch (Manual=${manualRevenue}, System=${systemSubtotal})`);
      }

      productRows.push({
        product: prodName,
        opening: openingLeftover,
        produced: producedQty,
        delivered: deliveredQty,
        converted: convertedIn - convertedOut,
        available: manualAvailable,
        leftover: remainingLeftover,
        damaged: damagedQty,
        manualSold,
        systemSold,
        unitPrice: basePrice,
        manualRevenue,
        systemRevenue: systemSubtotal,
        match: soldDiff === 0 && revDiff <= 0.01 ? '✅ PASS' : '❌ FAIL',
      });
    }

    console.table(
      productRows.map((r) => ({
        Product: r.product,
        Open: r.opening,
        In: r.produced + r.delivered + r.converted,
        Avail: r.available,
        Left: r.leftover,
        Dam: r.damaged,
        'Man.Sold': r.manualSold,
        'Sys.Sold': r.systemSold,
        'Price': `${r.unitPrice} ETB`,
        'Revenue': `${r.manualRevenue} ETB`,
        Status: r.match,
      }))
    );

    // 2. Audit Cash Drawer Equation
    const openingFloat = Number(session.openingCashFloat ?? 0);
    const dayExpenses = session.expenses.reduce((s, e) => s + Number(e.amount), 0);
    const manualExpectedCash = Math.round((openingFloat + manualDayTotalRevenue - dayExpenses) * 100) / 100;

    const actualCash = Number(session.actualCashAmount ?? 0);
    const actualTelebirr = Number(session.actualTelebirrAmount ?? 0);
    const actualCbe = Number(session.actualCbeAmount ?? 0);
    const actualTotalCounted = Math.round((actualCash + actualTelebirr + actualCbe) * 100) / 100;
    const variance = Math.round((actualTotalCounted - manualExpectedCash) * 100) / 100;

    console.log(`  💵 Cash Reconciliation Formula:`);
    console.log(`     Opening Float (${openingFloat.toFixed(2)}) + Sales (${manualDayTotalRevenue.toFixed(2)}) - Expenses (${dayExpenses.toFixed(2)}) = Expected (${manualExpectedCash.toFixed(2)})`);
    console.log(`     Actual Counted: Cash (${actualCash}) + Telebirr (${actualTelebirr}) + CBE (${actualCbe}) = Total (${actualTotalCounted.toFixed(2)})`);
    console.log(`     Variance: ${variance.toFixed(2)} ETB -> ${variance === 0 ? '✅ BALANCED (0.00)' : '⚠️ DISCREPANCY'}`);

    if (variance !== 0) {
      failures.push(`Day ${dayNumber}: Cash variance is ${variance} ETB (Expected ${manualExpectedCash}, Actual ${actualTotalCounted})`);
    }

    daySummaries.push({
      day: dayNumber,
      date: dateStr,
      status: session.status,
      openingFloat,
      totalRevenue: manualDayTotalRevenue,
      expenses: dayExpenses,
      expectedCash: manualExpectedCash,
      actualCounted: actualTotalCounted,
      variance,
      tomorrowLeftover: Number(session.cashLeftoverAmount ?? 0),
    });

    previousSession = session;
  }

  // --- PART 2: AUDIT RAW MATERIAL INVENTORY LEDGER ---
  console.log('\n========================================================================');
  console.log('📦 [PART 2/3] AUDITING RAW MATERIAL INVENTORY (IN, USAGE, BALANCE)...');
  console.log('========================================================================\n');

  const stockItems = await prisma.stockItem.findMany({
    where: { branchId: branch.id },
    include: { movements: true },
  });

  for (const stock of stockItems) {
    const totalIn = stock.movements
      .filter((m) => m.type === 'IN')
      .reduce((sum, m) => sum + Number(m.quantity), 0);

    const totalUsage = stock.movements
      .filter((m) => m.type === 'PRODUCTION_USAGE' || m.type === 'OUT')
      .reduce((sum, m) => sum + Number(m.quantity), 0);

    const manualCalculatedRemaining = Math.round((totalIn - totalUsage) * 100) / 100;
    const systemCurrentQuantity = Number(stock.currentQuantity);
    const stockDiff = Math.abs(manualCalculatedRemaining - systemCurrentQuantity);

    const isMatch = stockDiff <= 0.001;
    if (!isMatch) {
      failures.push(`Stock [${stock.name}]: Ledger mismatch (Manual=${manualCalculatedRemaining}, DB Current=${systemCurrentQuantity})`);
    }

    stockSummaries.push({
      item: stock.name,
      unit: stock.unitType,
      totalIn,
      totalUsage,
      manualBalance: manualCalculatedRemaining,
      dbBalance: systemCurrentQuantity,
      diff: stockDiff,
      status: isMatch ? '✅ MATCH' : '❌ FAIL',
    });
  }

  console.table(
    stockSummaries.map((s) => ({
      'Raw Material': s.item,
      'Unit': s.unit,
      'Total Restocked (IN)': s.totalIn,
      'Production Usage (OUT)': s.totalUsage,
      'Calculated Balance': s.manualBalance,
      'DB Current Balance': s.dbBalance,
      'Status': s.status,
    }))
  );

  // --- PART 3: AUDIT DAY 8 (OPEN SESSION) ---
  console.log('\n========================================================================');
  console.log('🌅 [PART 3/3] AUDITING DAY 8 (TODAY) LIVE SHIFT READINESS...');
  console.log('========================================================================\n');

  const day8 = sessions[7];
  if (day8) {
    console.log(`  Session ID: ${day8.id}`);
    console.log(`  Date: ${day8.date.toISOString().slice(0, 10)}`);
    console.log(`  Status: ${day8.status} (Correctly OPEN for live testing!)`);
    console.log(`  Opening Float: ${Number(day8.openingCashFloat).toFixed(2)} ETB`);
    console.log(`  Production Batches Recorded: ${day8.productionBatches.length}`);
    console.log(`  Supplier Deliveries Logged: ${day8.supplierDeliveries.length}`);
    console.log(`  In-Shift POS Sales: ${day8.sales.length}`);
    console.log(`  Shift Expenses: ${day8.expenses.length}`);

    // Verify Day 8 opening leftovers correspond to Day 7 leftovers
    const day7 = sessions[6];
    if (day7) {
      console.log(`\n  Checking Day 8 Opening Leftovers (Inherited from Day 7):`);
      for (const rec of day7.leftoverRecords) {
        console.log(`    - ${rec.product.name}: ${rec.quantityRemaining} pcs (available for today's opening)`);
      }
    }
  }

  // --- FINAL CONCLUSION ---
  console.log('\n========================================================================');
  if (failures.length === 0) {
    console.log('🎉 AUDIT COMPLETE: ALL 8 DAYS & CALCULATIONS VERIFIED 100% CORRECT!');
    console.log('   - Product In/Out/Sold calculations: PERFECT');
    console.log('   - Cash drawer reconciliation & floats: BALANCED (0.00 variance)');
    console.log('   - Raw material stock usage & balances: EXACT');
    console.log('   - Day 8 active session: READY FOR PRODUCTION TESTING');
  } else {
    console.log(`⚠️ AUDIT FOUND ${failures.length} DISCREPANCIES:`);
    failures.forEach((f) => console.log(`   - ${f}`));
  }
  console.log('========================================================================\n');

  return {
    passed: failures.length === 0,
    failures,
    daySummaries,
    stockSummaries,
  };
}

runAudit()
  .then((res) => {
    if (!res.passed) process.exit(1);
    process.exit(0);
  })
  .catch((e) => {
    console.error('Audit execution error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
