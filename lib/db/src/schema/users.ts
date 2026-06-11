import { pgTable, text, serial, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Maps to Supabase `public.users` table. role is a Postgres enum
// (user_role) but Drizzle reads it as text via PostgreSQL coercion.
// passwordHash kept as a non-DB virtual field so legacy /auth/login code
// compiles — but it's never read or written against Supabase.
export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  auth0Sub: text("auth0_sub").notNull(),
  name: text("full_name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("trainer"), // admin | coordinator | trainer
  isActive: boolean("is_active").notNull().default(true),
  modifiedBy: integer("modified_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
