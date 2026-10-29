import { test } from "node:test";
import assert from "node:assert/strict";
import { handleApi } from "../lib/booking-api.mjs";
import { testDatabase } from "./database.mjs";
const now = Date.parse("2026-10-29T12:00:00Z");
const slot = (id, start = "2026-12-10T09:00:00Z", provider = "Dr Ade") => ({
  id,
  provider,
  start,
  end: new Date(Date.parse(start) + 1800000).toISOString(),
});
function fixture() {
  const DB = testDatabase();
  const env = { DB, API_KEY: "test-secret" };
  let time = now;
  return {
    DB,
    setTime: (n) => (time = n),
    async call(path, method = "GET", body, headers = {}) {
      const res = await handleApi(
        new Request("https://test.local" + path, {
          method,
          headers: { "X-API-Key": "test-secret", ...headers },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        env,
        () => time,
      );
      return {
        status: res.status,
        body: await res.json(),
        headers: res.headers,
      };
    },
    async seed(slots = [slot("s1"), slot("s2")]) {
      await this.call("/reset", "POST", { slots });
    },
  };
}
const book = (id = "s1", email = "ada@example.com") => ({
  slot_id: id,
  name: " Ada Obi ",
  email,
});
test("all API routes require the supplied key", async () => {
  const f = fixture();
  for (const path of ["/slots", "/bookings", "/bookings/a", "/reset"])
    assert.equal(
      (await f.call(path, "GET", undefined, { "X-API-Key": "" })).status,
      401,
    );
});
test("reset accepts past slots, sorting and exact provider filter", async () => {
  const f = fixture();
  await f.seed([slot("late"), slot("past", "2020-01-01T00:00:00Z", "Dr B")]);
  const result = await f.call("/slots");
  assert.deepEqual(
    result.body.slots.map((s) => s.id),
    ["past", "late"],
  );
  assert.equal((await f.call("/slots?provider=Dr%20B")).body.slots.length, 1);
  assert.equal((await f.call("/slots?provider=dr%20b")).body.slots.length, 0);
});
test("booking normalizes identity and lookup persists it", async () => {
  const f = fixture();
  await f.seed();
  const result = await f.call(
    "/bookings",
    "POST",
    book("s1", " ADA@EXAMPLE.COM "),
  );
  assert.equal(result.status, 201);
  assert.equal(result.body.name, "Ada Obi");
  assert.equal(result.body.email, "ada@example.com");
  assert.deepEqual(
    (await f.call("/bookings/" + result.body.id)).body,
    result.body,
  );
  assert.equal((await f.call("/slots")).body.slots[0].available, false);
});
test("invalid fields, unknown slots, started slots and missing IDs", async () => {
  const f = fixture();
  await f.seed([slot("past", "2020-01-01T00:00:00Z")]);
  for (const b of [
    {},
    null,
    { slot_id: "past", name: " ", email: "x" },
    book("past", "invalid"),
  ])
    assert.equal((await f.call("/bookings", "POST", b)).status, 400);
  assert.equal(
    (await f.call("/bookings", "POST", book("unknown"))).status,
    404,
  );
  assert.equal((await f.call("/bookings", "POST", book("past"))).status, 400);
  assert.equal((await f.call("/bookings/missing")).status, 404);
});
test("twenty concurrent requests produce exactly one booking", async () => {
  const f = fixture();
  await f.seed();
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      f.call("/bookings", "POST", book("s1", `patient${i}@example.com`)),
    ),
  );
  assert.equal(results.filter((r) => r.status === 201).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 19);
});
test("cancellation frees slot, repeated cancellation is 409", async () => {
  const f = fixture();
  await f.seed();
  const result = await f.call("/bookings", "POST", book());
  const id = result.body.id;
  assert.equal(
    (await f.call("/bookings/" + id, "DELETE")).body.status,
    "cancelled",
  );
  assert.equal((await f.call("/bookings/" + id, "DELETE")).status, 409);
  assert.equal((await f.call("/bookings/unknown", "DELETE")).status, 404);
  assert.equal((await f.call("/slots")).body.slots[0].available, true);
  assert.equal((await f.call("/bookings", "POST", book())).status, 201);
});
test("concurrent idempotent retries preserve status and booking ID", async () => {
  const f = fixture();
  await f.seed();
  const results = await Promise.all(
    Array.from({ length: 15 }, () =>
      f.call("/bookings", "POST", book(), { "Idempotency-Key": "same" }),
    ),
  );
  assert.ok(results.every((r) => r.status === 201));
  assert.equal(new Set(results.map((r) => r.body.id)).size, 1);
  assert.equal(
    (
      await f.call("/bookings", "POST", book("s2"), {
        "Idempotency-Key": "same",
      })
    ).status,
    422,
  );
});
test("failed idempotent results are replayed", async () => {
  const f = fixture();
  await f.seed();
  const headers = { "Idempotency-Key": "invalid" };
  assert.equal(
    (await f.call("/bookings", "POST", book("missing"), headers)).status,
    404,
  );
  assert.equal(
    (await f.call("/bookings", "POST", book("missing"), headers)).status,
    404,
  );
  assert.equal(
    f.DB.sqlite.prepare("SELECT count(*) AS n FROM attempts").get().n,
    1,
  );
});
test("five failures count against rate limit, email case is normalized, expires after minute", async () => {
  const f = fixture();
  await f.seed();
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await f.call("/bookings", "POST", book("missing"))).status,
      404,
    );
  const blocked = await f.call(
    "/bookings",
    "POST",
    book("s1", " ADA@EXAMPLE.COM "),
  );
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("Retry-After"), "60");
  assert.equal(
    (await f.call("/bookings", "POST", book("s1", "other@example.com"))).status,
    201,
  );
  f.setTime(now + 60000);
  assert.equal((await f.call("/bookings", "POST", book("s2"))).status, 201);
});
test("parallel attempts cannot bypass rate limit", async () => {
  const f = fixture();
  await f.seed();
  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      f.call("/bookings", "POST", book("missing")),
    ),
  );
  assert.equal(results.filter((r) => r.status === 404).length, 5);
  assert.equal(results.filter((r) => r.status === 429).length, 15);
});
test("pagination is stable for equal timestamps and includes cancelled bookings", async () => {
  const f = fixture();
  await f.seed(Array.from({ length: 5 }, (_, i) => slot("s" + i)));
  for (let i = 0; i < 5; i++) await f.call("/bookings", "POST", book("s" + i));
  const first = await f.call("/bookings?email=ADA%40EXAMPLE.COM&limit=2");
  assert.equal(first.body.bookings.length, 2);
  const second = await f.call(
    "/bookings?email=ada%40example.com&limit=2&cursor=" +
      encodeURIComponent(first.body.next_cursor),
  );
  const third = await f.call(
    "/bookings?email=ada%40example.com&limit=2&cursor=" +
      encodeURIComponent(second.body.next_cursor),
  );
  assert.equal(third.body.next_cursor, null);
  assert.equal(
    new Set(
      [
        ...first.body.bookings,
        ...second.body.bookings,
        ...third.body.bookings,
      ].map((b) => b.id),
    ).size,
    5,
  );
  for (const limit of ["0", "51", "x", "1.5", ""])
    assert.equal(
      (await f.call("/bookings?email=ada%40example.com&limit=" + limit)).status,
      400,
    );
  assert.equal(
    (await f.call("/bookings?email=ada%40example.com&cursor=garbage")).status,
    400,
  );
});
test("reset clears bookings, rate limits and idempotency", async () => {
  const f = fixture();
  await f.seed();
  await f.call("/bookings", "POST", book(), { "Idempotency-Key": "reset" });
  await f.seed();
  assert.equal(
    (await f.call("/bookings?email=ada%40example.com")).body.bookings.length,
    0,
  );
  assert.equal(
    (await f.call("/bookings", "POST", book(), { "Idempotency-Key": "reset" }))
      .status,
    201,
  );
});
test("database constraint prevents a second active booking directly", async () => {
  const f = fixture();
  await f.seed();
  await f.call("/bookings", "POST", book());
  assert.throws(
    () =>
      f.DB.sqlite
        .prepare(
          "INSERT INTO bookings(id,slot_id,name,email,status,created_at) VALUES('bad','s1','X','x@x.com','confirmed','2026-10-29')",
        )
        .run(),
    /UNIQUE/,
  );
});
