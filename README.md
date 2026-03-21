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
npx prisma migrate deploy   # applies migrations (e.g. query indexes); or `npx prisma db push` for quick dev

If you previously used **only** `db push` and have no `_prisma_migrations` table, either start using `migrate deploy` after a one-time baseline, or apply `prisma/migrations/*/migration.sql` manually for indexes.
npm run dev
```

- API: `http://localhost:3001` (default `PORT`)
- Health: `GET /api/health`
- Swagger: `http://localhost:3001/api-docs`

## Scripts

| Command | Description |
|--------|-------------|
| `npm run dev` | Watch mode (tsx) |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run compiled server |
| `npm run prisma:generate` | Regenerate Prisma client |
| `npm run prisma:migrate` | Create/apply migrations (dev) |

## Environment variables

| Variable | Required | Notes |
|----------|----------|--------|
| `DATABASE_URL` | Yes | MySQL connection string |
| `JWT_SECRET` | Yes in production | Must not be `dev-secret` or placeholder in `NODE_ENV=production` |
| `PORT` | No | Default `3001` |
| `NODE_ENV` | No | `production` enables stricter JWT checks at startup |

## Remote

Pushes go to: `https://github.com/bakery-erp/backend.git` (configure `git remote` if needed).
