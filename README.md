# Bakery ERP — API Server

Express + TypeScript + Prisma (PostgreSQL). Serves REST JSON for web, mobile, and Swagger UI.

## Requirements

- Node.js 18+
- PostgreSQL 14+ (Neon Cloud DB or Local PostgreSQL)

## Quick Start (1-Command Database Setup)

1. **Configure Environment**:
   ```bash
   cp .env.example .env
   ```
   Set your `DATABASE_URL` in `server/.env` (e.g. Neon connection string or local PostgreSQL URL).

2. **Initialize Database & Seed Everything**:
   ```bash
   npm run db:setup
   ```
   *This single command automatically syncs all tables to your PostgreSQL database, generates the Prisma client, and seeds all core entities with realistic test data (sessions, sales, production, expenses, and credits).*

3. **Start the Development Server**:
   ```bash
   npm run dev
   ```

- API: `http://localhost:3001` (default `PORT`)
- Health: `GET /api/health`
- Swagger Docs: `http://localhost:3001/api-docs`

---

## Default Login Credentials

All seeded accounts use password: `password123`

| Role | Phone | Access Level |
|:-----|:------|:-------------|
| **OWNER** | `0912345678` | Full system access, unified ledger, printable executive financial reports |
| **ADMIN** | `0910000001` | Inventory, stock adjustments, staff management, approvals |
| **CASHIER** | `0910000002` | POS sales, opening/closing daily sessions, customer credits |
| **BAKER** | `0910000003` | Daily production batch logging, ingredient usage |
| **SAMBUSA** | `0910000004` | Sambusa and pastry production |
| **CAKE** | `0910000005` | Cake worker production |
| **EMPLOYEE**| `0910000006` | Self-service profile, personal salary, loans, penalties |

---

## Database Commands

| Command | Description |
|:--------|:------------|
| `npm run db:setup` | **Recommended for new DBs**: Pushes schema, generates client, and seeds test data in 1 step. |
| `npm run db:push` | Synchronizes `schema.prisma` directly to your PostgreSQL database without migration locks. |
| `npm run db:seed` | Runs the idempotent seed script (`prisma/seed.ts`). Safe to re-run at any time. |
| `npm run db:reset` | **Fresh Start**: Wipes the DB, pushes the latest schema, and re-seeds clean test data. |
| `npm run db:generate` | Regenerates the Prisma Client TypeScript definitions. |
| `npm run db:studio` | Opens Prisma Studio GUI in the browser. |

---

## Switching Databases

Whenever you switch to a new database (e.g., from local PostgreSQL to Neon Cloud, or a new cloud database branch):
1. Update `DATABASE_URL` in `server/.env`.
2. Run `npm run db:setup`.
3. That's it! Your tables, schema, and sample data will be ready immediately.
