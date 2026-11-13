# Correctional Healthcare Risk and Compliance Management

Rust (Axum/Tokio/SQLx), PostgreSQL, and React/Vite. Accounts and permissions protect
the API; database triggers provide auditing; Redis and PostGIS are optional integrations.

## Start or upgrade your existing local project

Stop the running backend with **Control+C**. Keep your existing `backend/.env`.
The Python virtual environment is no longer needed.

```sh
cd backend
source "$HOME/.cargo/env"
# Only if no .env exists yet:
[ -f .env ] || cp .env.example .env
# DATABASE_URL must point to your PostgreSQL database.
cargo run --locked --release -- --migrate
cargo run --locked --release -- --enable-postgis
cargo run --locked --release -- --create-admin
cargo run --locked --release
```

`--create-admin` asks for a username, password, and confirmation without echoing
credentials. Choose a password of at least 12 characters. It creates the first
administrator only; afterward, use **User accounts** in the app to create other users.
If an administrator already exists, skip that command. Never put your password in
source code, command-line arguments, or a committed `.env`.

`--enable-postgis` requires PostGIS installed on your PostgreSQL server and permission
to enable the extension. The rest of the application works without it; nearby search
will explain that spatial setup is needed. Postgres.app on this Mac supports it.

The server remains running at `http://127.0.0.1:8000`. In another terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open the printed Vite URL and sign in. For a different API address, set `VITE_API_URL`
in `frontend/.env`. Set `CORS_ORIGINS` in `backend/.env` to the exact frontend origin.
Both `postgresql://` and the prior psycopg/psycopg2 URL prefixes are supported.
If Cargo is unavailable, install stable Rust from https://rustup.rs and source its env.

## Implemented priorities

| Priority | Feature | Implementation |
|---|---|---|
| 1 | Accounts/login | Argon2id password hashing, random opaque tokens stored only as hashes in PostgreSQL, 8-hour sessions, logout, password changes, login throttling |
| 2 | Role-based access | Viewer/editor/admin authorization on the server, matching controls in React, admin-managed account activation and roles |
| 3 | Database audit logging | PostgreSQL triggers, actor attribution, old/new JSON values, password-hash redaction, append-only audit history, administrator audit page |
| 4 | Performance/testing/indexing | Query indexes, latest staffing selection in SQL, consistent dashboard snapshots, request coalescing, cached serialized responses, repeatable benchmark and integration tests |
| 5 | Docker | Rust API and React/Nginx Dockerfiles; Compose with PostgreSQL/PostGIS and Redis |
| 6 | Cloud deployment | Prepared optional Render Blueprint for API, static site, hosted PostgreSQL and Redis; no cloud resources deployed |
| 7 | Redis caching | Optional shared dashboard cache, database-trigger revision keys, bounded cache timeouts and database fallback |
| 8 | Risk analysis | Weighted component contributions, measurement counts, missing-data explanations, latest staffing snapshots, monthly hospital trends and interpretation limits |
| 9 | PostGIS | Generated geography points, GiST index, distance/radius endpoint, nearby-facility search UI |

## Permissions

| Action | Viewer | Editor | Admin |
|---|---|---|---|
| Read dashboard, records, risk analysis, spatial results | Yes | Yes | Yes |
| Add/update records | No | Yes | Yes |
| Delete records | No | No | Yes |
| Manage users/roles and view audit history | No | No | Yes |
| Change own password / sign out | Yes | Yes | Yes |

Accounts are created by an administrator, not through public registration. Changing
an account's role/status or password revokes its sessions. Administrators cannot
change their own role/status; another administrator must do that. The browser keeps
the bearer token in tab session storage; the API checks the current user and session
for every request. Use HTTPS when hosting the application.

## Database audit details

Triggers audit INSERT/UPDATE/DELETE on facility, compliance, hospital, staffing, and
user tables. Audit records commit or roll back with the operation. Direct SQL writes
are captured with the database username and a null application actor unless one is
set. Login and logout events are also recorded. Failed transactions do not create
committed data-change entries. Reads and DDL are not logged. Historical changes made
before this migration cannot be reconstructed.

Audit rows reject UPDATE, DELETE, and TRUNCATE. For a deployed environment, use
`backend/sql/runtime_role.sql` to separate the API role from the migration owner.
A database owner/superuser can disable triggers; this is not tamper-proof against a
privileged DBA. See [deployment instructions](docs/DEPLOYMENT.md).

## Cache behavior

Without `REDIS_URL`, each API process keeps a local cache. Set `REDIS_URL` to a Redis
or TLS Redis connection string to share responses between processes. Docker Compose
configures it automatically. Default TTL: 15 seconds (`CACHE_TTL_SECONDS`). A zero TTL
disables caching. PostgreSQL triggers increment a revision in the same transaction
as data writes. Each cache read checks that revision, so successful writes—including
direct SQL and another API process—make older cache entries unreachable. Old Redis
keys expire naturally. The database must remain available for authentication and
revision checks even on cache hits.

Redis failures fall back to PostgreSQL, with a 300 ms timeout per cache read/write.
Cache misses are coalesced within each process. No user credentials or sessions are
stored in Redis. All application roles currently share dataset read access; introduce
user/facility-specific cache keys if that access model changes.

## API additions

All data routes now require `Authorization: Bearer <token>`. `/`, `/health`, and
`POST /auth/login` remain public. Existing CRUD routes are preserved.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/auth/login` | Username/password → token and public user profile |
| GET | `/auth/me` | Current user |
| POST | `/auth/logout` | Revoke current session |
| POST | `/auth/password` | Change password and revoke all own sessions |
| GET, POST | `/auth/users` | List/create users (admin) |
| PATCH | `/auth/users/{id}` | Set role and active status (admin) |
| GET | `/audit-logs?before=ID&limit=50` | Audit history, cursor pagination (admin) |
| GET | `/risk-analysis/{facility_id}` | Score explanations and hospital trends |
| GET | `/facilities-nearby?latitude=36&longitude=-86&radius_km=25` | Nearby facilities ordered by distance |
| GET | `/dashboard` | Facilities, compliance, and risks in one consistent snapshot |

Risk scores preserve the demonstration formula: 40% flagged compliance checks, 30%
measured hospital stays of at least five days, 30% staffing vacancies relative to a
30% vacancy reference. Missing components are excluded and weights renormalized.
These are operational demonstration scores, not validated clinical predictions.
Trend results use the latest 12 **recorded** months, not necessarily consecutive months.

## Tests and deployment

```sh
cd backend
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked --lib
# Use a disposable PostGIS-capable database server and Redis instance:
DATABASE_URL=postgres://testuser@localhost:5432/postgres \
TEST_REDIS_URL=redis://127.0.0.1:6379/ \
cargo test --locked --test api --test security -- --ignored --nocapture
cd ../frontend
npm run build
npm run lint
```

Integration tests create isolated databases and require a role with CREATEDB and,
for the restricted-role test, CREATEROLE. Never point them at a production server.
See [performance notes](docs/PERFORMANCE.md) and [Docker/cloud setup](docs/DEPLOYMENT.md).
Docker images and the complete local stack have now been built and verified, including Redis cache reuse across an API restart. Cloud deployment remains pending.

Implementation references: [Axum](https://docs.rs/axum/0.8.9/axum/),
[Argon2](https://docs.rs/argon2/0.5.3/argon2/),
[PostGIS distance queries](https://postgis.net/docs/ST_DWithin.html).
