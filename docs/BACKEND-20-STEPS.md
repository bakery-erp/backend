# Backend — 20-step completion plan (commit per step)

Target remote: **https://github.com/bakery-erp/backend.git**

Each step is one **logical change** → one **git commit** (and push). Order respects dependencies.

---

## Prerequisites

- Initialize git in `server/` (or monorepo root) if not already; add remote:
  ```bash
  git remote add origin https://github.com/bakery-erp/backend.git
  ```
- If the GitHub repo should contain **only** the server, work from `server/` as repo root. If it’s the **whole ERP** monorepo, use repo root and commit paths accordingly. Adjust paths below to match your choice.

---

## The 20 steps

### Step 1 — **Repo & quality baseline**
- `.gitignore` (node_modules, `.env`, `dist`, logs, Prisma generated if applicable)
- `README.md` in server: how to run, env vars, `npm run dev`, Prisma migrate
- ESLint/Prettier or `npm run lint` if missing
- **Commit:** `chore: repo baseline, env example, README`

### Step 2 — **Environment & config hardening**
- Document all required env vars (`DATABASE_URL`, `JWT_SECRET`, `PORT`)
- `.env.example` (no secrets)
- Validate config at startup (fail fast if `JWT_SECRET` missing in production)
- **Commit:** `chore: env validation and .env.example`

### Step 3 — **Prisma schema audit & indexes**
- Review models vs product needs; add DB indexes on hot paths (`DailySession.branchId+date`, `Sale.sessionId`, `User.phone`, etc.)
- **Commit:** `perf: prisma indexes for sessions, sales, users`

### Step 4 — **Auth consistency**
- Ensure `POST /auth/login` and `GET /auth/me` return the same user shape
- Optional: refresh token or shorter JWT + doc only (keep scope small)
- **Commit:** `fix: align auth login/me response shape`

### Step 5 — **Role matrix on routes (audit)**
- Single source of truth: document which roles hit which routers; align `requireRole` with `ROLE-BASED-FLOW.md` (analytics OWNER-only already done)
- **Commit:** `docs: route role matrix; fix any mismatched requireRole`

### Step 6 — **FinancialCategory model (foundation)**
- New Prisma model: `FinancialCategory { id, name, type: REVENUE | EXPENSE }` + seed
- CRUD API under `/api/financial-categories` (OWNER/ADMIN) or read-only list + seed-only
- **Commit:** `feat: financial categories model, seed, and list API`

### Step 7 — **Link Product → FinancialCategory**
- `Product.financialCategoryId` (nullable), migration, validate on create/update
- Include in product list/get responses
- **Commit:** `feat: product financialCategoryId optional link`

### Step 8 — **Expense: COMPANY vs OWNER (schema)**
- Migrate `ExpenseType` from `OPERATIONAL|PERSONAL` to `COMPANY|OWNER` **or** add aliases in API while keeping DB (document mapping)
- **Commit:** `feat: expense type company/owner (migration + API)`

### Step 9 — **Expense → FinancialCategory**
- `Expense.financialCategoryId` (nullable), required when `type=COMPANY` (optional rule)
- Update expense create/list/get; filter analytics later
- **Commit:** `feat: expense financialCategoryId`

### Step 10 — **Finalize: sold = produced + opening − closing**
- Load previous calendar day’s session leftovers for same branch as **opening**
- `sold = max(0, produced + opening − currentLeftover)` per product
- Store optional `openingLeftoverSnapshot` on session or derived read model (minimal: compute-only first)
- **Commit:** `feat: finalize sales include previous-day leftover as opening`

### Step 11 — **New session: carry-over leftovers**
- On `POST /daily-sessions`, after create, copy prior closed day’s `leftoverRecords` into new session (or attach `carriedFromSessionId`)
- **Commit:** `feat: auto carry-over leftovers when opening new daily session`

### Step 12 — **Daily analytics: COMPANY expenses only**
- `GET /api/analytics/daily` (and dashboard if needed): sum expenses where `type=COMPANY` only for “operating” line; document OWNER in monthly
- **Commit:** `feat: daily analytics exclude owner withdrawals from operating total`

### Step 13 — **Monthly analytics: full picture**
- Ensure monthly includes all expense types, payroll, loans summary if not present; add category breakdown where `financialCategoryId` exists
- **Commit:** `feat: monthly analytics category and owner-inclusive totals`

### Step 14 — **Loan & Payroll → FinancialCategory**
- Optional `financialCategoryId` on `Loan`, `PayrollRecord`; expose in API
- **Commit:** `feat: loan and payroll optional financial category`

### Step 15 — **Stock movement consistency pass**
- Audit: production `materialUsages`, supplier delivery with `stockItemId`, conversions → ensure each creates expected `StockMovement`
- Extract small service helpers to avoid duplicate logic
- **Commit:** `fix: stock movements aligned with production, delivery, conversion`

### Step 16 — **Immutability guards (finalized data)**
- Block `PATCH` on `Sale` / sale items; block changing `DailySession` from CLOSED to OPEN; restrict edits on supplier delivery after paid (define rules)
- **Commit:** `feat: immutability rules for closed sessions and sales`

### Step 17 — **Validation & error contract**
- Centralize Zod or manual validators for bodies; consistent `{ error: string }` and HTTP codes (400/403/404/409)
- **Commit:** `refactor: request validation and error responses`

### Step 18 — **Pagination & limits**
- Add `limit`/`cursor` or `page` to heavy list endpoints (sales, expenses, stock movements, deliveries)
- **Commit:** `feat: pagination on list endpoints`

### Step 19 — **Tests**
- Integration tests for: auth, daily session create + finalize (with carry-over), analytics daily/monthly, role 403s
- `npm test` in CI-ready script
- **Commit:** `test: core API integration tests`

### Step 20 — **Swagger + release**
- Regenerate/verify OpenAPI matches all routes; tag `v1.0.0` or `v0.9.0`
- **Commit:** `docs: swagger sync and release tag`

---

## After each push

```bash
git add -A
git commit -m "type: short description"
git push -u origin main   # or your default branch
```

---

## Optional splits

If a step is too large, split **Step 10** and **Step 11** into two commits (logic vs migration) or **Step 6** (model only, then API).

---

## Related docs

- `DESIGN-ROADMAP-FINANCIAL.md` — why these features exist  
- `ROLE-BASED-FLOW.md` — who can call what  
- Swagger — `http://localhost:3001/api-docs`
