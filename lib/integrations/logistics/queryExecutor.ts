// Minimal read-only surface the pc_pos adapters depend on. `params` is
// optional and only used by CRM-R1-T13E's coverage lookup (a parameterized
// numeric WHERE comuna_id = ? - safe, no collation concerns, unlike T13C's
// text-matching which deliberately avoids a SQL WHERE - see
// pc-pos-adapter.ts). Kept separate from pool.ts so adapter tests can fake
// this without a real mysql2 pool (T13C section 19: no accidental production
// access from tests).
export type LogisticsQueryExecutor = {
  queryRows<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
};
