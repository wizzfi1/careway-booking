import assert from "node:assert/strict";
export async function liveCheck(base, key) {
  let checks = 0;
  async function call(path, method = "GET", body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        "X-API-Key": key,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json(), headers: res.headers };
  }
  const eq = (actual, expected) => {
    assert.deepEqual(actual, expected);
    checks++;
  };
  const start = Date.now() + 86400000;
  const slots = Array.from({ length: 12 }, (_, i) => ({
    id: "test-" + i,
    provider: i % 2 ? "Dr B" : "Dr A",
    start: new Date(start + i * 1800000).toISOString(),
    end: new Date(start + (i + 1) * 1800000).toISOString(),
  }));
  eq((await call("/slots", "GET", undefined, { "X-API-Key": "" })).status, 401);
  eq((await call("/reset", "POST", { slots })).status, 200);
  eq((await call("/slots")).body.slots.length, 12);
  eq((await call("/slots?provider=Dr%20B")).body.slots.length, 6);
  const payload = (id, email) => ({
    slot_id: id,
    name: " Demo Patient ",
    email,
  });
  const race = await Promise.all(
    Array.from({ length: 15 }, (_, i) =>
      call("/bookings", "POST", payload("test-0", `race-${i}@example.com`)),
    ),
  );
  eq(race.filter((r) => r.status === 201).length, 1);
  eq(race.filter((r) => r.status === 409).length, 14);
  const won = race.find((r) => r.status === 201).body;
  eq((await call("/bookings/" + won.id)).body, won);
  eq((await call("/bookings/" + won.id, "DELETE")).body.status, "cancelled");
  eq((await call("/bookings/" + won.id, "DELETE")).status, 409);
  eq((await call("/slots")).body.slots[0].available, true);
  const retries = await Promise.all(
    Array.from({ length: 10 }, () =>
      call("/bookings", "POST", payload("test-1", "idem@example.com"), {
        "Idempotency-Key": "live-retry",
      }),
    ),
  );
  eq(
    retries.every((r) => r.status === 201),
    true,
  );
  eq(new Set(retries.map((r) => r.body.id)).size, 1);
  eq(
    (
      await call("/bookings", "POST", payload("test-2", "idem@example.com"), {
        "Idempotency-Key": "live-retry",
      })
    ).status,
    422,
  );
  for (let i = 0; i < 5; i++)
    eq(
      (await call("/bookings", "POST", payload("missing", "rate@example.com")))
        .status,
      404,
    );
  const limited = await call(
    "/bookings",
    "POST",
    payload("test-2", "RATE@EXAMPLE.COM"),
  );
  eq(limited.status, 429);
  eq(
    Number.isInteger(Number(limited.headers.get("Retry-After"))) &&
      Number(limited.headers.get("Retry-After")) > 0,
    true,
  );
  eq(
    (await call("/bookings", "POST", payload("test-2", "separate@example.com")))
      .status,
    201,
  );
  for (let i = 3; i < 6; i++)
    eq(
      (
        await call(
          "/bookings",
          "POST",
          payload("test-" + i, "pages@example.com"),
        )
      ).status,
      201,
    );
  const page1 = await call("/bookings?email=PAGES%40EXAMPLE.COM&limit=2");
  eq(page1.body.bookings.length, 2);
  const page2 = await call(
    "/bookings?email=pages%40example.com&limit=2&cursor=" +
      encodeURIComponent(page1.body.next_cursor),
  );
  eq(page2.body.bookings.length, 1);
  eq(page2.body.next_cursor, null);
  eq((await call("/bookings?email=pages%40example.com&limit=51")).status, 400);
  eq((await call("/bookings", "POST", {})).status, 400);
  return {
    checks,
    concurrentBookings: "1 created, 14 conflicts",
    concurrentRetries: "10 responses, 1 booking",
  };
}
if (process.argv[1]?.endsWith("live-check.mjs"))
  console.log(
    await liveCheck(
      process.env.BASE_URL || "http://127.0.0.1:5173",
      process.env.API_KEY || "careway-local-test-key",
    ),
  );
