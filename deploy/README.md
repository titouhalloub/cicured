# Deploying cicured

Production deployment for a single Linux host running the whole stack in
Docker: Postgres, Redis, Silo (S3-compatible object storage), the API and the
worker. This is an MVP runbook, not a hardened operations guide — see "What is
not in this MVP" at the bottom.

## Prerequisites

- A Linux host (Ubuntu 22.04 or newer) with at least 4 GB of RAM free. Each run
  launches a sandbox container capped at 4 GB / 2 CPU, so budget for the
  busiest moment, not the average.
- Docker Engine 24+ and the Compose v2 plugin (`docker compose version`).
- A domain name with an A record pointing at the host. The API sets
  `API_PUBLIC_URL`-derived cookie and OAuth redirect URLs, so it must know its
  own public address.
- A GitHub App (App ID, private key, webhook secret) registered for the
  repositories you intend to run against.
- The sandbox image built **on the host itself** — it is never pulled from a
  registry.

## Setup

```bash
git clone <your-fork> && cd cicured

cp .env.example .env
chmod 600 .env          # the file holds every secret in the system
$EDITOR .env            # see "Production overrides" at the bottom of the file

./docker/sandbox/build.sh

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  exec api node -r @swc-node/register src/db/migrate-cli.ts

curl -fsS http://localhost:4000/health
```

The compose overlay adds the `api` and `worker` services and depends on
`service_healthy` for `postgres`, `redis` and `minio`, so the app services only
start once their dependencies actually answer. Migrations are a separate,
deliberate step: the container never migrates itself on boot.

If `/health` does not answer, read the API logs before touching anything else —
the most common cause is a missing `SESSION_SECRET` or `SFT_ENCRYPTION_KEY`,
which fails fast at boot rather than at first request.

## Common operations

```bash
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

$COMPOSE logs -f api worker        # follow app logs
$COMPOSE logs --tail 200 worker    # last 200 worker lines
$COMPOSE restart api               # restart one service
$COMPOSE ps                        # service state
```

To update to a new revision: `git pull`, rebuild the changed image
(`$COMPOSE build api` or `build worker`), then `$COMPOSE up -d`. Compose
recreates only the services whose definition or image changed. Run
`migrate-cli` again after pulling — migrations are additive and re-running a
no-op migration is safe.

## Security notes

- **The Docker socket is root on the host.** The worker mounts
  `/var/run/docker.sock` so it can launch sandboxes, which means anything that
  compromises the worker owns the machine. In production, put
  `tecnativa/docker-socket-proxy` in front of it and point the worker at the
  proxy (`DOCKER_HOST=tcp://docker-socket-proxy:2375`) instead of mounting the
  socket. The Dockerfile deliberately does not hard-code a socket path.
- **`.env` must be `chmod 600`** and owned by the deploying user. It contains
  the session secret, the encryption key, the GitHub App private key and the S3
  credentials. Never commit it, and never reuse the dev values from
  `.env.example`.
- **`API_PUBLIC_URL` and `WEB_APP_URL` must be the real public URLs**, not
  `localhost`. OAuth redirects and cookie scoping are derived from them, and a
  wrong value produces silent login failures that look like CORS problems.
- **Build the sandbox image on the host.** `cicured/sandbox:node20` is built
  locally from `docker/sandbox/` and bind-mounted into each run; pulling it
  from a third party would hand that party arbitrary code execution inside
  every build.
- Set `LOG_FORMAT=json` so the worker's structured lines (including the
  per-run `runId`) can be shipped to a log collector. Token-shaped strings are
  redacted in both formats, but JSON makes them greppable.
- Leave `S3_ENDPOINT` unset for real AWS S3; set it only for MinIO. The API and
  worker must agree, because presigned URLs are signed with the client config
  and a mismatch fails verification.

## What is not in this MVP

- **No HTTPS.** Nothing terminates TLS. Put Caddy, nginx or a cloud load
  balancer in front of port 4000 before exposing this to the internet.
- **No backups.** `pgdata`, `redisdata` and `minio_data` are plain Docker
  volumes with no snapshot schedule. Losing them loses every project, run and
  archived log.
- **No metrics or alerting.** `/health` is a liveness check, not an SLO. There
  is no dashboard for queue depth, run duration or disk growth.
- **No log shipping or rotation.** JSON logs go to the Docker JSON log driver
  only; on a busy host that file grows without bound.
- **No egress allowlist.** Spec §8 calls for a proxy that restricts sandbox
  network access; until it lands, sandboxes can reach anything the host can.
