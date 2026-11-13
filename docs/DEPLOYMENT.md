# Docker and hosted deployment

## Local Docker stack

Requires Docker Desktop / Docker Compose. From the repository root:

```sh
# Preserve any existing root .env. This is separate from backend/.env.
[ -f .env ] || cp .env.example .env
# Replace POSTGRES_PASSWORD with the output of: openssl rand -hex 24
# Use a hexadecimal password so it can be embedded in the database URL without escaping.
docker compose up --build -d
docker compose exec api /app/api --create-admin
```

Open http://localhost:8080. Nginx serves React and proxies `/api` to Rust. PostgreSQL
and Redis have no published host ports. Only the web interface is published, bound
to loopback. Redis stores disposable cached responses with TTLs, not sessions or
passwords. Database data lives in the `postgres_data` volume. `docker compose down`
preserves it; do not add `--volumes` unless you intend to delete that database.

Compose starts a **new, empty database**, not your existing local database. It runs
migrations and enables PostGIS. To bring your course data over, export the four data
tables and import them into the new database, preserving parent-before-child order.
Do not overwrite populated tables or import account/session tables unintentionally.

The local Docker stack was built and verified on November 13, 2026. Existing course
records, account credentials, and audit history were copied into its database and
compared against the source. No active login sessions were copied. Sign in with your
existing account at http://localhost:8080; do not create another first administrator.
The original PostgreSQL database remains unchanged. These two databases do not sync.

From the project root:

```sh
docker compose up -d       # start again later
docker compose ps          # service status
docker compose logs --tail=50 api
docker compose stop        # stop, preserving data
```

Keep Docker Desktop running while using this version. You may stop the old local Rust
and Vite servers with Control+C when you no longer need the separate original app.
Never use `docker compose down --volumes` unless you intend to erase the Docker database.

Redis reuse was verified across an API restart with an identical authenticated
dashboard response; anonymous access returns 401 and PostGIS queries succeed.

## Cloud-ready files

`render.yaml` is an optional example Blueprint for a Rust Docker API, a React static
site, hosted PostgreSQL, and a Redis-compatible Key Value service. No resources have
been created. The template specifies paid resource plans; review the provider's
current plans before applying it. You can instead use the Dockerfiles with another
provider that supplies PostgreSQL and Redis.

For Render:

1. Commit the code to your repository, excluding `.env` files, credentials, database
   dumps, and build outputs. Link that repository to a Render account when ready.
2. Apply the Blueprint after reviewing the proposed resources and costs.
3. Set the API's `CORS_ORIGINS` to the exact HTTPS frontend origin, without a trailing
   slash. Set the frontend's `VITE_API_URL` to the API's HTTPS origin. If the provider
   assigns different hostnames, update these settings and rebuild the frontend.
4. The pre-deploy command runs core migrations. In an API service shell, run
   `/app/api --enable-postgis` if the hosted database supports the extension, then
   `/app/api --create-admin` to choose the first administrator's credentials.
5. Run `backend/sql/runtime_role.sql` using the database-owner connection; set that
   role's password with `psql`'s `\password healthcare_runtime`. Change the API's
   `DATABASE_URL` to that restricted role. Run later migrations through the owner
   connection in a separate migration job, not the runtime role. Remove/adjust the
   Blueprint's owner-URL binding and pre-deploy command before syncing it again.
6. Import course data through a controlled database connection. The Blueprint blocks
   public database/Redis access. Use the provider's shell/private network, or a
   temporary tightly scoped allowlist while importing, then remove it.
7. Verify sign-in, each role, CRUD auditing, spatial results, backups, and restore
   procedures before directing users to the deployment.

The default Blueprint initially uses the database owner to bootstrap migrations.
That is convenient for initial setup but should be replaced by the restricted runtime
role before a hosted release. An owner/superuser can disable triggers; append-only
audit behavior is enforced against the runtime role, not against the database owner.

Provider documentation: [Render Blueprint reference](https://render.com/docs/blueprint-spec),
[Docker on Render](https://render.com/docs/docker).
