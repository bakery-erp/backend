# Bakery ERP — API server

Express + TypeScript + Prisma (MySQL). Serves REST JSON for web, mobile, and Swagger UI.

## Requirements

- Node.js 18+
- MySQL 8+

## Setup

```bash
cp .env.example .env
# Edit .env: DATABASE_URL, JWT_SECRET, PORT
npm install
npx prisma migrate deploy   # see "Migrations & P3005" below if this errors
npm run dev
```

- API: `http://localhost:3001` (default `PORT`)
- Health: `GET /api/health`
- Swagger: `http://localhost:3001/api-docs`

## Migrations & error **P3005** (database not empty)

This appears when the DB **already has tables** (e.g. you used `prisma db push` before) but **`_prisma_migrations`** has no history. Prisma will not run `migrate deploy` until you **baseline** or **apply SQL then mark applied**.

### Option A — Schema already matches `schema.prisma` (e.g. after `db push`)

Tell Prisma the existing migrations are already satisfied (no SQL run):

```bash
npx prisma migrate resolve --applied 20260307183000_add_query_indexes
npx prisma migrate resolve --applied 20260308120000_financial_categories_and_expense_refactor
npx prisma migrate deploy   # should say "No pending migrations"
```

If a **new** migration appears later, `migrate deploy` will apply only that one.

### Option B — DB is old; migration changes are NOT applied yet

1. Run each `prisma/migrations/*/migration.sql` against MySQL (e.g. `mysql -u... bakery_erp < prisma/migrations/.../migration.sql`), **or** use `npx prisma db push` once to align the schema.
2. Then mark those migrations as applied (same `migrate resolve --applied ...` as in Option A).

### Option C — Dev only: start clean

Drop/recreate the database, then:

```bash
npx prisma migrate deploy
npm run db:seed
```

## Scripts

| Command | Description |
|--------|-------------|
| `npm run dev` | Watch mode (tsx) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled server |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run db:migrate` | Create/apply migrations (dev) |
| `npm run db:push` | Push schema without migration files (quick dev) |
| `npm run db:seed` | Run seed |

## Environment variables

| Variable | Required | Notes |
|----------|----------|--------|
| `DATABASE_URL` | Yes | MySQL connection string |
| `JWT_SECRET` | Yes in production | Must not be `dev-secret` or placeholder in `NODE_ENV=production` |
| `PORT` | No | Default `3001` |
| `NODE_ENV` | No | `production` enables stricter JWT checks at startup |

## Remote

Pushes go to: `https://github.com/bakery-erp/backend.git` (configure `git remote` if needed).
