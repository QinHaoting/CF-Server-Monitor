# Private monitoring deployment

This branch is prepared for a private Cloudflare Workers deployment. Source
hardening and local checks do not establish that a live deployment is protected.

## Deployment configuration

- Production branch: `secure-monitor`; do not configure production builds from `main`.
- Worker: `cf-server-monitor` on the account's `workers.dev` hostname.
- No custom domain is configured. Preview URLs are disabled.
- Root directory: `/`; Node.js: 24.
- Build: `npm ci && npm run test:all && npm run build:frontend`.
- Deploy: `npx wrangler deploy`.
- Create a separate D1 database named `cf-server-monitor-db`, then add its actual
  `database_id` to `wrangler.toml`. The `DB` binding and SQLite Durable Object
  migration must remain present.
- GitHub Actions validates this branch only. Cloudflare Workers Builds owns
  production releases; GitHub Pages deployment and upstream sync are absent
  from this branch. Workflows on other branches are not changed by this branch.

## Configure before production use

1. Determine the account's actual `workers.dev` hostname. Configure a hostname
   based Cloudflare Access application for the full production hostname, using
   an explicit individual email allowlist. Hostname based Access supports the
   dashboard's WebSocket connection. Do not use a blanket public bypass.
2. Configure the more specific `/update` path for probe ingestion. Cloudflare
   path matching can include descendants, so verify the exact Worker route:
   only `POST /update` should ingest reports; all other paths must remain
   protected or return no private data. Probe WebSocket reporting stays off.
3. Check the Worker has no additional routes, custom domains or accessible
   preview URLs. Recheck this after changing deployment settings.
4. Generate at least 32 random bytes for `API_SECRET` and store it with
   Cloudflare's encrypted Worker secret facility. Do not put credentials in
   source, build commands, plaintext Worker variables or GitHub workflow files.
5. Initialize a separate administrator password behind Access. The application
   persists a separate randomly generated JWT signing key in its D1 settings.
   Authentication fails if that key is unavailable; it cannot fall back to the
   reporting secret or a built-in key.
6. Keep `is_public=false`, `wss_report_enabled=false`, built-in theme only, and
   empty custom HTML/script/theme URL settings. Settings read errors return 503.
7. Configure a dedicated low privilege agent for HTTPS reports every 60 seconds,
   with automatic updates disabled. Limit keepalive to explicitly selected
   existing machine IDs; keep the cloud provider key away from the Worker and
   the monitored guest.
8. Configure Telegram private-chat notifications, a five-minute offline
   threshold, and recovery notifications. Keep its token out of source/logs.

## Validation and rollback

- Test anonymous access to nodes, history and administration, including every
  alternative deployment hostname and Access path exception.
- An incorrect report secret must fail. Bodies larger than 512 KiB must return
  413 even without Content-Length or with an understated length.
- Verify real reports and metrics. Stop the agent to test offline notification,
  restart it to test recovery, and inspect logs without exposing credentials.
- Observe the selected existing machine for at least 70 real minutes without
  keeping an SSH session open. Compare lifecycle state, running time and
  heartbeat evidence. Successful API requests alone do not prove uptime.
- Keep a previous Worker deployment and database backup before upgrades. Stop
  newly added timers if validation fails; preserve lifecycle backups and report
  unfinished acceptance checks. Changing code does not restore D1 data.

## Local checks performed

The hardened source passed 97 main-suite tests, agent-configuration assertions,
six history-query tests, the production frontend build and a Worker bundle dry
run on Node.js 24. The resolved lockfile had zero matches in the npm advisory
bulk API at the time checked; this is not a complete security guarantee.

The frontend test server ignores the development Vite configuration so running
the test suite cannot invoke its local certificate generation plugin.

Official references: [Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/),
[workers.dev routing](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/),
[application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/),
[Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
