# Database Migrations

Run migration files in filename order.

From the repo root:

```bash
psql "$DATABASE_URL" -f app/db/migratins/20260425_001_uuid_forum_constraints.sql
```

These files are written to be idempotent where possible, so they are safe to re-run.
