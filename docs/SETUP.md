# Production setup

## 1. Supabase database

Create a Supabase project. In **Connect**, obtain its Postgres **Session pooler** connection string for a persistent Node server (IPv4-compatible). Use a dedicated server-side database role with ownership/permissions for the `helm` schema and migrations. Keep that schema out of the project's exposed API schemas; do not grant `anon` or `authenticated` schema/table access. No browser Supabase key is required.

Set `DATABASE_URL` in the private environment. URL-encode special characters in its password. Use `DATABASE_SCHEMA=helm`. Download the database root certificate from Supabase and mount it read-only into the app; set `DATABASE_CA_FILE` to that path if the CA is not in the runtime trust store. Certificate verification remains enabled. Do not disable it to work around a connection failure.

```sh
npm run migrate
```

`server/db.ts` contains versioned Knex migrations, including foreign keys and indexes. The application DB user needs migration permissions. Run migrations as a one-off deployment step before starting the services. A restore from a tested backup is the rollback strategy; destructive down-migrations are intentionally not supplied.

Official references:
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://supabase.com/docs/guides/database/psql

## 2. Private screenshot storage

Create a **private** Supabase Storage bucket named `helm-screenshots`. Enable S3 access and create S3-compatible credentials in Storage settings. Set these only on the server:

- `S3_ENDPOINT`: exact endpoint shown in Supabase, normally `https://PROJECT_REF.storage.supabase.co/storage/v1/s3`.
- `S3_REGION`: your project's region.
- `S3_BUCKET`: `helm-screenshots`.
- `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`: S3 credentials, not the Supabase browser key.

Keep the bucket private. The server first verifies issue access and supplies a session-bound 60-second link; S3 redirects use another 60-second signed URL. Anyone with a copied S3 URL could use it until expiry, so do not share it. Email only links to authenticated issue pages.

Reference: https://supabase.com/docs/guides/storage/s3/authentication

## 3. App configuration and first admin

Set `NODE_ENV=production`, `APP_URL=https://your-domain`, and a random `SESSION_SECRET` of at least 32 characters. Use `openssl rand -hex 32` to generate secrets. Never commit them.

Provision the first admin by setting `ADMIN_EMAIL`, `ADMIN_NAME`, and `ADMIN_PASSWORD` (16+ characters) in your private environment, then run:

```sh
node --import tsx scripts/create-admin.ts
```

Remove `ADMIN_PASSWORD` immediately afterward. This owner-operated bootstrap trusts the owner-provided email; subsequent testers join through emailed invitations. The command refuses to overwrite an existing administrator. Create the first project in Settings, then invite testers.

## 4. Hosting

Deploy the Node web service and worker to a Node/Docker host. This is not a static-only website. `Dockerfile` and `compose.yaml` are provided; Docker deployment has not been executed in this session.

```sh
docker compose build
docker compose run --rm web npm run migrate
docker compose up -d
```

Put an HTTPS reverse proxy in front of `127.0.0.1:3001`. Set `TRUST_PROXY_HOPS=1` only when exactly one trusted proxy is directly in front of the app; otherwise preserve the default. Mount the database certificate in both services if needed. Ensure the named data volume is writable by container user `node`. The runtime directory is used for local process metadata even with Postgres/S3.

Health endpoint: `GET /api/health`. Never expose local demo credentials or seed data as production data. Back up Postgres and the storage bucket; test a restore before inviting the team. Configure monitoring for web/worker health and failed/uncertain delivery counts. Keep one worker for a small team; application CAS updates protect overlapping claims, but higher-volume queue/load testing is still required before scaling.

## 5. Email and n8n

Follow `docs/N8N.md`. Set `EMAIL_FROM` to a verified Resend sender, e.g. `Your Team <bugs@your-domain>`. Set `EMAIL_SENDER_NAME` for the signature. In Resend, verify the sending domain and required DNS records before testing real messages.

The n8n server must reach `INTEGRATION_BASE_URL`, which must be the app's public HTTPS origin. Cloud n8n cannot call this laptop's `localhost` URL. Do not publish until the real origin and credential entries have been configured.

## Credentials still needed for a live installation

- Supabase Postgres session-pooler URI, database CA as needed, and private S3 credentials.
- Public HTTPS app domain / deployment host.
- Owner/admin email, sender display name, verified Resend sender and sending API key.
- n8n webhook Header Auth secret and a separate scheduler Bearer secret.
- Resend/Svix signing secret for delivery/bounce reporting (optional but recommended).

Enter secrets in `.env`, your host's secret manager, or the n8n credential UI; do not paste them into chat or workflow code.
