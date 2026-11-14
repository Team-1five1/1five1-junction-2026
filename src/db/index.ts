import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL || "postgres://shield:shield_local_password@127.0.0.1:5432/shield_db";
export const sql = postgres(connectionString, { max: 10 });
export const db = drizzle(sql, { schema });
export * from "./schema";
