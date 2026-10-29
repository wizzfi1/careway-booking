import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
export function testDatabase(path = ":memory:") {
  const sqlite = new DatabaseSync(path);
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sqlite.exec(
      readFileSync(new URL("../drizzle/" + file, import.meta.url), "utf8"),
    );
  const prepare = (sql, args = []) => ({
    bind(...values) {
      return prepare(sql, values);
    },
    all() {
      return { results: sqlite.prepare(sql).all(...args) };
    },
    first() {
      return sqlite.prepare(sql).get(...args) || null;
    },
  });
  return {
    sqlite,
    prepare,
    async batch(statements) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((s) => s.all());
        sqlite.exec("COMMIT");
        return results;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
