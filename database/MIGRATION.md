# Vaa PostgreSQL migration

## Current state

Vaa remains on the AppDeploy database until a hosted PostgreSQL database has been prepared, imported and verified. The backend compatibility adapter stores existing logical records in PostgreSQL's `app_records` JSONB table when `DATABASE_URL` is configured; otherwise it safely falls back to AppDeploy. Authentication and uploaded images remain on AppDeploy.

## 1. Prepare PostgreSQL

1. Create a hosted PostgreSQL database reachable by the AppDeploy backend. A database listening only on `localhost` on your PC cannot be reached by the hosted app.
2. Apply `database/schema.sql`.
3. Back up the target before importing.

## 2. Export Vaa records

1. Sign in to Vaa as the administrator and open the Admin dashboard.
2. Click **Export database for PostgreSQL**.
3. Keep the downloaded JSON private. It contains account, messaging and marketplace data.

The export uses an administrator-allowlisted, paginated API and is available only while the current database mode is AppDeploy.

## 3. Import

Run this from the repository root on a machine with Node.js:

```bash
npm install
DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/DATABASE' node scripts/import-appdeploy-export.mjs ./vaa-appdeploy-export.json
```

The importer validates the export format and table names, runs inside a transaction, and upserts by the original logical table and record ID. Back up an existing database before re-importing.

## 4. Verify before switching the live app

Compare the row counts in PostgreSQL `app_records` with the export for every table. Specifically verify `account_profiles`, `brand_owners`, `brands`, `products`, `brand_subscriptions`, `journal_stories`, `messages` and `notifications`. Test customer browsing, brand workspace, admin dashboard, messages, subscriptions and public Journal against a staging database first.

## 5. Configure the hosted backend

After verification, add `DATABASE_URL` as an AppDeploy backend secret and deploy/restart. Confirm the backend is using PostgreSQL before treating cutover as complete. Keep the JSON export and a rollback backup.

## Important

- Do not expose a home PostgreSQL server directly to the public internet. Use a managed hosted database or a secure network arrangement.
- Do not commit `.env`, exports, credentials or connection strings to GitHub.
- This first migration preserves the existing record shapes in JSONB. Moving to normalized relational tables is a separate later optimization.
