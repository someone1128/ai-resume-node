# resume-node

Node.js backend for the Java/Snowy migration.

The project is the compatibility-first Node.js replacement for the Java/Snowy backend. It uses Fastify, TypeScript, Kysely and the existing MySQL tables, and keeps the current frontend paths, token header and response envelope. Business modules are migrated from the inventory in small, independently testable slices.

Internal imports use the `@/` alias (`src/*`); relative internal imports are rejected by ESLint. The production build runs `tsc-alias` so the generated `dist` files remain directly runnable by Node.

## Commands

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

For an explicit provider-only image check, inject `DOUBAO_API_KEY` and run
`pnpm verify:doubao`. The script uses a generated in-memory image, does not
write a file or database record, and only prints the model and returned image
size.

For a read-only latency baseline against a running instance, run
`BENCH_URL=http://127.0.0.1:8823/health BENCH_REQUESTS=100 BENCH_CONCURRENCY=10 pnpm bench:health`.
The benchmark only sends GET requests and reports latency, status counts and
the benchmark process RSS; it does not create or modify application data.

Copy `.env.example` to a local environment and never commit real credentials.

Migration plans, endpoint inventory, environment records, test fixtures and acceptance gates are in [`../docs/node-migration/`](../docs/node-migration/) and [`../docs/migration/`](../docs/migration/). The current implementation status is recorded in [`../docs/migration/progress.md`](../docs/migration/progress.md).

## Mock payment boundary

`PAYMENT_MODE=mock` exposes the compatibility payment and `/test/jsapi/*` diagnostic endpoints only for the configured test account. They create and update clearly prefixed test orders; they never call WeChat or charge a real payment method. Set `PAYMENT_MODE=live` only after the pre-production signature, certificate and callback replay gates in the migration acceptance document pass.
