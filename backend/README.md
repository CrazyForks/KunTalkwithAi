# EveryTalk API (Google Login + Postgres)

## Env

Create `backend/.env` (do not commit):

- `DATABASE_URL` (used by Prisma)
- `JWT_SECRET` (random long string)
- `GOOGLE_CLIENT_IDS` (comma-separated web+android oauth client IDs)
- `CORS_ORIGINS` (comma-separated)

## Docker Compose

From repo root:

- `docker compose up -d --build`

API will listen on `http://localhost:3001` (container port 3000).

## Notes

- Run migrations in production by executing inside the api container:
  - `npx prisma migrate deploy`

This repo intentionally ignores `.env`.
