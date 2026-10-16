# Vaa PostgreSQL migration

## Current migration stage

The backend now has a compatibility adapter for its existing record-oriented data access.
When `DATABASE_URL` is absent, it continues using AppDeploy's database so the deployed
marketplace remains available. When `DATABASE_URL` is set, backend records are read and
written in PostgreSQL's `app_records` table. Uploaded product images and AppDeploy
authentication are still managed by AppDeploy.

This is an initial persistence migration layer; it does not automatically copy existing
AppDeploy records into PostgreSQL. Do not switch a live environment to an empty PostgreSQL
database until its records have been exported and imported.

## Prepare local PostgreSQL

1. Create a database and dedicated user for Vaa.
2. From the repository root, apply the schema:

   ```bash
   psql -U vaa_user -d vaa -f database/schema.sql
   ```

3. Copy `.env.example` to `.env` and set `DATABASE_URL` to your local connection string.
4. Install dependencies with `npm install`.

Never commit a real `.env` file or put database credentials in source control.

## Using PostgreSQL with the hosted AppDeploy backend

A database running only on your computer cannot be reached by the hosted Vaa backend.
For hosted PostgreSQL, configure `DATABASE_URL` as an AppDeploy backend secret and use
a database endpoint reachable from AppDeploy. Apply the schema to that database first.

## Compatibility model

The adapter preserves the backend's existing logical table names and record fields in
JSONB, which reduces the risk of changing marketplace workflows during the first step.
The normalized tables already present in `schema.sql` are retained for a later, explicit
relational migration. Keep a backup and verify the export/import before production cutover.
