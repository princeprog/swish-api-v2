/**
 * node-postgres treats a top-level JavaScript array as a PostgreSQL array.
 * JSONB array columns therefore need an explicit JSON string at write time.
 */
export function serializeJsonArray(value: readonly unknown[]): string {
  return JSON.stringify(value);
}
