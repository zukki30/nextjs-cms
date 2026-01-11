import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// サンプルのユーザーテーブル (Better Auth で使用されるテーブルは別途定義されます)
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
