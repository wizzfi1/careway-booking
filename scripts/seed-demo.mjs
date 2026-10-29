// Explicit demo setup only. Never runs automatically on startup or deployment.
const base = process.env.BASE_URL || "http://127.0.0.1:5173";
const key = process.env.API_KEY || "careway-local-test-key";
const start = new Date();
start.setUTCDate(start.getUTCDate() + 1);
start.setUTCHours(8, 0, 0, 0);
const slots = [];
for (let day = 0; day < 12; day++)
  for (let i = 0; i < 9; i++) {
    const date = new Date(+start + day * 7 * 86400000 + i * 1800000);
    slots.push({
      id: `demo-${day}-${i}`,
      provider: i % 2 ? "Dr Tunde Bello" : "Dr Ada Okafor",
      start: date.toISOString(),
      end: new Date(+date + 1800000).toISOString(),
    });
  }
const res = await fetch(base + "/reset", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-API-Key": key },
  body: JSON.stringify({ slots }),
});
if (!res.ok) throw Error(`${res.status}: ${await res.text()}`);
console.log(`Seeded ${slots.length} demo slots.`);
