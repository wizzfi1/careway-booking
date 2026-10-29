const fields = "id, slot_id, name, email, status, created_at";
const emailValid = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const json = (body, status = 200, headers = {}) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
const error = (message, status) => json({ error: message }, status);
const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );

export async function handleApi(request, env, clock = Date.now) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (!env.API_KEY || request.headers.get("X-API-Key") !== env.API_KEY)
    return error("unauthorized", 401);
  const db = env.DB;
  const q = (sql, ...args) => db.prepare(sql).bind(...args);
  try {
    if (path === "/reset" && request.method === "POST") {
      const body = await request.json();
      if (!Array.isArray(body?.slots))
        return error("slots must be an array", 400);
      const ids = new Set();
      for (const s of body.slots) {
        if (
          !s ||
          !["id", "provider", "start", "end"].every(
            (k) => typeof s[k] === "string" && s[k].trim(),
          ) ||
          !Number.isFinite(Date.parse(s.start)) ||
          !Number.isFinite(Date.parse(s.end)) ||
          Date.parse(s.end) <= Date.parse(s.start) ||
          ids.has(s.id)
        )
          return error("invalid or duplicate slot", 400);
        ids.add(s.id);
      }
      await db.batch([
        q("DELETE FROM requests"),
        q("DELETE FROM attempts"),
        q("DELETE FROM bookings"),
        q("DELETE FROM slots"),
        q(
          "INSERT INTO slots(id,provider,start,end) SELECT json_extract(value,'$.id'),json_extract(value,'$.provider'),json_extract(value,'$.start'),json_extract(value,'$.end') FROM json_each(?)",
          JSON.stringify(body.slots),
        ),
      ]);
      return json({ ok: true });
    }
    if (path === "/slots" && request.method === "GET") {
      const provider = url.searchParams.get("provider");
      const { results } = await q(
        `SELECT s.*, NOT EXISTS(SELECT 1 FROM bookings b WHERE b.slot_id=s.id AND b.status='confirmed') AS available FROM slots s WHERE (? IS NULL OR provider=?) ORDER BY julianday(start),id`,
        provider,
        provider,
      ).all();
      return json({
        slots: results.map((s) => ({ ...s, available: !!s.available })),
      });
    }
    if (path === "/bookings" && request.method === "POST") {
      const body = await request.json();
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const email =
        typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
      const slot = typeof body?.slot_id === "string" ? body.slot_id : "";
      const invalid = !slot.trim() || !name || !emailValid(email);
      const owner = crypto.randomUUID();
      const idem = request.headers.get("Idempotency-Key");
      const key = idem ? `idem:${idem}` : `request:${owner}`;
      const fingerprint = canonical(body);
      const now = clock();
      const bookingId = crypto.randomUUID();
      // All decisions and writes share one D1 transaction. A retry cannot
      // interleave them, and the owner guard preserves the original response.
      const results = await db.batch([
        q("DELETE FROM attempts WHERE at <= ?", now - 60000),
        q(
          "INSERT INTO requests(key,owner,fingerprint) VALUES(?,?,?) ON CONFLICT(key) DO NOTHING",
          key,
          owner,
          fingerprint,
        ),
        q(
          `UPDATE requests SET code=CASE
          WHEN ? != '' AND (SELECT count(*) FROM attempts WHERE email=?) >= 5 THEN 429
          WHEN ? THEN 400
          WHEN NOT EXISTS(SELECT 1 FROM slots WHERE id=?) THEN 404
          WHEN (SELECT julianday(start) FROM slots WHERE id=?) <= julianday(?) THEN 400
          WHEN EXISTS(SELECT 1 FROM bookings WHERE slot_id=? AND status='confirmed') THEN 409
          ELSE 201 END WHERE key=? AND owner=?`,
          email,
          email,
          invalid ? 1 : 0,
          slot,
          slot,
          new Date(now).toISOString(),
          slot,
          key,
          owner,
        ),
        q(
          `UPDATE requests SET retry_after=MAX(1,CAST(((SELECT MIN(at) FROM attempts WHERE email=?)+60000-?+999)/1000 AS INTEGER)) WHERE key=? AND owner=? AND code=429`,
          email,
          now,
          key,
          owner,
        ),
        q(
          `INSERT INTO attempts(email,at) SELECT ?,? FROM requests WHERE key=? AND owner=? AND code != 429 AND ? != ''`,
          email,
          now,
          key,
          owner,
          email,
        ),
        q(
          `INSERT INTO bookings(id,slot_id,name,email,status,created_at) SELECT ?,?,?,?,'confirmed',? FROM requests WHERE key=? AND owner=? AND code=201`,
          bookingId,
          slot,
          name,
          email,
          new Date(now).toISOString(),
          key,
          owner,
        ),
        q(
          `UPDATE requests SET response=CASE code
          WHEN 201 THEN (SELECT json_object('id',id,'slot_id',slot_id,'name',name,'email',email,'status',status,'created_at',created_at) FROM bookings WHERE id=?)
          WHEN 400 THEN json_object('error',?) WHEN 404 THEN json_object('error','slot not found')
          WHEN 409 THEN json_object('error','slot already booked') WHEN 429 THEN json_object('error','too many booking attempts') END
          WHERE key=? AND owner=?`,
          bookingId,
          invalid
            ? "missing or invalid booking details"
            : "slot has already started",
          key,
          owner,
        ),
        q(
          "SELECT fingerprint,code,response,retry_after FROM requests WHERE key=?",
          key,
        ),
        q("DELETE FROM requests WHERE key=? AND ?=0", key, idem ? 1 : 0),
      ]);
      const saved = results[7].results[0];
      if (saved.fingerprint !== fingerprint)
        return error("idempotency key reused with a different body", 422);
      return json(
        JSON.parse(saved.response),
        saved.code,
        saved.code === 429 ? { "Retry-After": String(saved.retry_after) } : {},
      );
    }
    if (path === "/bookings" && request.method === "GET") {
      const email = (url.searchParams.get("email") || "").trim().toLowerCase();
      const rawLimit = url.searchParams.get("limit") ?? "10";
      if (
        !emailValid(email) ||
        !/^\d+$/.test(rawLimit) ||
        +rawLimit < 1 ||
        +rawLimit > 50
      )
        return error("invalid email or limit", 400);
      let sequence = 0;
      const cursor = url.searchParams.get("cursor");
      if (cursor) {
        try {
          const parsed = JSON.parse(atob(cursor));
          if (
            parsed.email !== email ||
            !Number.isSafeInteger(parsed.seq) ||
            parsed.seq < 1
          )
            throw Error();
          sequence = parsed.seq;
        } catch {
          return error("invalid cursor", 400);
        }
      }
      const { results } = await q(
        `SELECT seq,${fields} FROM bookings WHERE email=? AND seq>? ORDER BY seq LIMIT ?`,
        email,
        sequence,
        +rawLimit + 1,
      ).all();
      const more = results.length > +rawLimit;
      const page = results.slice(0, +rawLimit);
      return json({
        bookings: page.map(({ seq, ...b }) => b),
        next_cursor: more
          ? btoa(JSON.stringify({ email, seq: page.at(-1).seq }))
          : null,
      });
    }
    const match = path.match(/^\/bookings\/([^/]+)$/);
    if (match && ["GET", "DELETE"].includes(request.method)) {
      const id = decodeURIComponent(match[1]);
      if (request.method === "GET") {
        const found = await q(
          `SELECT ${fields} FROM bookings WHERE id=?`,
          id,
        ).first();
        return found ? json(found) : error("booking not found", 404);
      }
      const results = await db.batch([
        q(
          `UPDATE bookings SET status='cancelled' WHERE id=? AND status='confirmed' RETURNING ${fields}`,
          id,
        ),
        q("SELECT id FROM bookings WHERE id=?", id),
      ]);
      return results[0].results.length
        ? json(results[0].results[0])
        : error(
            results[1].results.length
              ? "already cancelled"
              : "booking not found",
            results[1].results.length ? 409 : 404,
          );
    }
    return error("not found", 404);
  } catch (e) {
    if (e instanceof SyntaxError || e instanceof URIError)
      return error("invalid JSON or URL", 400);
    console.error(
      "Booking API failure",
      e instanceof Error ? e.message : "unknown",
    );
    return error("internal server error", 500);
  }
}
