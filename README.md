# Careway clinic booking

A clinic booking API and responsive React page implementing all five levels of the Koya assessment. Built with JavaScript, React, Vinext and Cloudflare D1 (persistent SQLite). `openapi.json` is the supplied assessment contract.

## Run locally

Requires Node.js 22.13+ (Node 24 recommended).

```sh
npm ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_watery_paladin.sql
```

Create an ignored `.dev.vars` file containing `API_KEY=your-local-key`, then run `npm run dev`. Set `API_KEY` to the same value in your shell and run `node scripts/seed-demo.mjs` once to populate demonstration appointments. It calls `/reset`, which deletes all current bookings. Never run it after submission.

Open the printed localhost URL and enter the key using Connect API. The key stays in sessionStorage for that browser tab, never in tracked code. All API calls include `X-API-Key`.

## Endpoints

| Method | Path | Behaviour |
| --- | --- | --- |
| POST | `/reset` | Atomically replace slots and clear bookings, attempts and replay records |
| GET | `/slots?provider=Dr%20Ade` | Every slot, chronologically sorted, optional exact provider filter |
| POST | `/bookings` | Validate, normalize, rate-limit and book atomically |
| GET | `/bookings/:id` | Look up a persisted booking |
| DELETE | `/bookings/:id` | Cancel once and free the slot |
| GET | `/bookings?email=ada@example.com&limit=10&cursor=...` | Case-insensitive email lookup with cursor pagination |

All API endpoints require the key. The public HTML page is not an API endpoint. Errors are JSON objects with an `error` string. The page and API share an origin.

## Correctness decisions

- **Double booking:** a partial unique database index allows only one confirmed booking per slot. The complete booking decision and writes run in one transactional D1 batch, not a check in application memory. Multiple worker instances share the same database.
- **Cancellation:** a conditional update changes confirmed to cancelled, with a transaction distinguishing missing from already cancelled. Cancelled rows remain queryable.
- **Idempotency:** each nonempty `Idempotency-Key` has a unique database row. A request ownership guard ensures only the first caller executes the booking steps. The original HTTP status and JSON response are stored atomically with the booking, including errors. Canonical JSON ignores object property ordering but preserves field values, so changed values return 422. Replaying a booking after cancellation returns the original response; lookup returns the current state.
- **Rate limits:** at most five fresh attempts per normalized email in a rolling 60-second window, including validation failures with an email, missing slots and conflicts. The check and admission happen inside the same transaction. Rejected requests return 429 with whole-second Retry-After. Exact idempotent replays bypass counting to preserve the required original response. Requests without an email cannot be attributed to a person and return 400.
- **Pagination:** a monotonically increasing database sequence orders creation, including identical timestamps. Cursors contain the email and last sequence, so a cursor cannot accidentally cross email queries. Cancelled bookings remain in the list. Defaults to 10, maximum 50.
- **Persistence:** D1 stores slots, bookings, replay responses and rate-limit attempts. No in-memory persistence or automatic startup reset. Deployment migrations contain schema only.
- **Reset:** transactional clearing includes replay and limiter state so each assessment fixture starts clean. Past slots are accepted by reset but rejected when booked.

## Testing

```sh
node --test tests/api.test.mjs
```

Thirteen tests execute the real API handler against SQLite using a small D1 adapter. Coverage includes simultaneous booking requests, retries, a direct unique-constraint check, rate limiting, cancellation, normalization, errors, reset and pagination. Live HTTP checks also exercise the deployed D1 implementation. The SQLite adapter is test-only.

## Source map

- `lib/booking-api.mjs`: API contract and transactional booking workflow.
- `db/schema.ts`: schema and unique/index definitions.
- `drizzle/`: generated database migrations.
- `app/[...path]/route.ts`: thin HTTP route adapter.
- `app/page.tsx`: slot picker, booking, confirmation, lookup, pagination and cancellation.
- `app/globals.css`: responsive visual system.
- `tests/`: focused API regression tests.
- `scripts/seed-demo.mjs`: explicit, destructive demo fixture reset.

## Deployment and limitations

Hosted through Sites on Cloudflare Workers with a provisioned D1 database. `.openai/hosting.json` contains nonsecret hosting metadata. Set API_KEY as a runtime secret; never commit it. No paid service is required by the implementation.

This is an assessment demo, not a production patient-record system. The shared API key intentionally authorizes all contract operations, including reset and email lookup. A real clinic would need patient-specific authentication, separate administrator permissions, audit logging and stronger privacy controls. Use sample details only. Per-email limiting follows the assessment but does not prevent an attacker from rotating email addresses.

After submission, freeze the deployed source and data setup until the assessor responds. Do not reset, seed, redeploy or disable hosting during that period.
