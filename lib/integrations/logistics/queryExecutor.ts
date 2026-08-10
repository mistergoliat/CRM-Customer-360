// Minimal read-only surface pc-pos-adapter.ts depends on - deliberately just
// one method (no params, no WHERE clause: the adapter fetches the small
// comuna table once and matches in application code, see pc-pos-adapter.ts).
// Kept separate from pool.ts so adapter tests can fake this without a real
// mysql2 pool (T13C section 19: no accidental production access from tests).
export type LogisticsQueryExecutor = {
  queryRows<T extends Record<string, unknown> = Record<string, unknown>>(sql: string): Promise<T[]>;
};
