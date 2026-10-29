import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
export const slots = sqliteTable("slots", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  start: text("start").notNull(),
  end: text("end").notNull(),
});
export const bookings = sqliteTable(
  "bookings",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    id: text("id").notNull().unique(),
    slot_id: text("slot_id")
      .notNull()
      .references(() => slots.id),
    name: text("name").notNull(),
    email: text("email").notNull(),
    status: text("status").notNull(),
    created_at: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("one_confirmed_booking_per_slot")
      .on(t.slot_id)
      .where(sql`${t.status} = 'confirmed'`),
    index("bookings_email_sequence").on(t.email, t.seq),
  ],
);
export const attempts = sqliteTable(
  "attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull(),
    at: integer("at").notNull(),
  },
  (t) => [index("attempts_email_time").on(t.email, t.at)],
);
export const requests = sqliteTable("requests", {
  key: text("key").primaryKey(),
  owner: text("owner").notNull(),
  fingerprint: text("fingerprint").notNull(),
  code: integer("code"),
  response: text("response"),
  retry_after: integer("retry_after"),
});
