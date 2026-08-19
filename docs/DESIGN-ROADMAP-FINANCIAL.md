# Bakery ERP — Financial design roadmap & system feedback

This document captures the **target financial architecture** and maps it to the **current codebase**, so you can implement changes in phases without losing context.

**Related:** `ROLE-BASED-FLOW.md`, `RUNNING-AND-INTEGRATION.md`, Swagger at `/api-docs`.

---

## 1. System direction (big picture)

| From | To |
|------|-----|
| Storing operations only | **Structured financial model**: performance, separation of business vs owner money, daily vs monthly views, scalable reporting |

---

## 2. Expense system — COMPANY vs OWNER

**Proposal:** Replace unclear many-type semantics with two clear buckets:

| Type | Meaning | Daily profit | Monthly / full picture |
|------|---------|--------------|------------------------|
| **COMPANY** | Operational business spend (ingredients, utilities, small ops) | **Included** | Included |
| **OWNER** | Owner personal withdrawals | **Excluded** | **Included** |

**Current code:** Prisma `ExpenseType` is `OPERATIONAL` | `PERSONAL` — conceptually close to COMPANY | OWNER.

**Implementation path:**

1. **Option A (minimal):** Keep DB enum; document mapping `OPERATIONAL` → COMPANY, `PERSONAL` → OWNER; rename labels in UI/API docs.
2. **Option B (clean):** Migrate enum to `COMPANY` | `OWNER` (breaking change for clients; migration script).

**Analytics change:** Daily aggregates should sum only **COMPANY** (or `OPERATIONAL`) expenses for “operating profit”; monthly includes all expense types.

---

## 3. Financial categories (core)

**Proposal:** New `FinancialCategory` model:

```text
FinancialCategory { id, name, type }
  type: REVENUE | EXPENSE
```

Examples: Bread/Injera/Milk as REVENUE; Salary/Loan/Utilities as EXPENSE.

**Current code:** No unified category table. Expense uses free-text `category`; products/loans/payroll are not linked to a shared dimension.

**Implementation path:**

1. Add `FinancialCategory` + seed defaults.
2. Add optional `financialCategoryId` on: `Product`, `Expense`, `Loan`, `PayrollRecord` (nullable at first, backfill later).
3. Extend analytics to group by category (revenue from sale line items → product → category).

---

## 4. Link categories across the system

| Entity | Field | Notes |
|--------|--------|------|
| Expense | `type` (COMPANY/OWNER) + `financialCategoryId` | Category only for COMPANY or both — product decision |
| Product | `financialCategoryId` | Drives revenue reporting by line |
| Loan | `financialCategoryId` | e.g. “Loan” expense category |
| PayrollRecord | `financialCategoryId` | e.g. “Salary” |

**Result:** One reporting dimension across money movements.

---

## 5. Daily summary (accurate profit)

**Target formula (operational day):**

```text
Profit (daily ops) ≈ Revenue (by product/category) − COMPANY expenses only
```

Exclude OWNER withdrawals from daily business performance.

**Current code:** `GET /api/analytics/daily` sums **all** expenses for the day — should be filtered once expense types are aligned.

---

## 6. Monthly analysis

**Target:** Monthly view includes **everything**: all revenue, COMPANY + OWNER expenses, loans, payroll, supplier flows as needed.

**Current code:** Monthly analytics already includes `payrollTotal` and `netMonthly`; extend with category breakdowns and OWNER vs COMPANY once schema exists.

---

## 7. Sales calculation — produced + opening − closing

**Target:**

```text
Sold = Produced + Previous leftover (opening) − Current leftover (closing)
```

**Current code (`POST /api/daily-sessions/:id/finalize`):**

```text
Sold = max(0, produced − leftover)
```

**Gap:** **Previous-day leftover is not added** as opening stock. This matches your “leftover carry-over” item.

**Implementation path:**

1. When **finalizing** session for date *D*, load **prior calendar day** session for same branch; read that session’s `leftoverRecords` as `openingByProduct`.
2. `sold = max(0, produced + opening − currentLeftover)`.
3. Optionally persist “opening” on the session for audit (new table or JSON field).

---

## 8. Leftover carry-over on new session

**Proposal:** `POST /api/daily-sessions` copies **previous closed day’s** leftovers into the new session as initial leftover rows (or stores opening snapshot).

**Current code:** New session is empty; no auto-copy.

**Implementation path:** After creating `DailySession` for date *D*, find session for *D−1* (same branch, CLOSED), copy `leftoverRecords` into new session (or reference prior session ID).

---

## 9. Stock movement automation

**Target:** Auto movements for production usage, supplier IN, conversion IN/OUT.

**Current code:** Production batch can record `materialUsages`; supplier delivery may link `stockItemId`; conversions exist — **audit** each path to ensure every action creates movements consistently.

**Implementation path:** Centralize in services (“domain events”) so each write path always emits stock movements.

---

## 10. Role & permission — Analytics OWNER-only

**Proposal:** `/api/analytics/*` → **OWNER only**; ADMIN has everything else for operations.

**Status: implemented**

- Server: `server/src/routes/analytics.ts` uses `requireRole('OWNER')`.
- Web: `client/src/lib/permissions.ts` — ADMIN cannot open `/analytics`; nav and dashboard shortcuts hide Analytics for ADMIN.
- Swagger: Analytics tag and operations documented as OWNER-only with `403` where noted.

---

## 11. Audit & data safety

**Proposal:** Lock or flag finalized data (`isFinalized` / no PATCH on closed session sales, immutable sale lines, restricted edits on paid deliveries).

**Current code:** Finalize replaces sales for session; some entities remain editable — **harden incrementally** (soft rules first, then DB constraints).

---

## 12. Event-oriented architecture

**Proposal:** Model **business events** (ProductionRecorded, DeliveryReceived, SessionFinalized, LoanPaid) → side effects (stock, ledger, aggregates).

**Benefit:** Clearer backend, easier testing, future queue/audit.

**Current code:** Route handlers call Prisma directly — refactor toward modules/services per aggregate over time.

---

## 13. Suggested implementation phases

| Phase | Scope |
|-------|--------|
| **P0** | Analytics OWNER-only ✅; document expense mapping (OPERATIONAL/PERSONAL vs COMPANY/OWNER) |
| **P1** | Finalize formula: add **previous-day leftover**; optional persist opening quantities |
| **P2** | New session: **auto carry-over** leftovers from previous day |
| **P3** | `FinancialCategory` + link to Product; revenue by category in reports |
| **P4** | Expense `financialCategoryId`; daily analytics filter COMPANY-only |
| **P5** | Loan/Payroll category links; monthly dashboard by category |
| **P6** | Stock automation audit + event layer; immutable finalized records |

---

## 14. Final outcome (when complete)

- Simpler daily workflow for staff  
- Clear separation of business vs owner money  
- Accurate daily vs monthly views  
- Reporting by business line (category)  
- Closer to real ERP practice  

*This file is the living roadmap; update it as you ship each phase.*
