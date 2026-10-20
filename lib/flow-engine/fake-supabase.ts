/**
 * A recording stand-in for the Supabase client, for testing the engine.
 *
 * The engine's hardest bugs are ordering bugs: a guard that returns after the
 * session has already been cleared, a query against a table nothing writes to.
 * None of them are visible in a pure function, and none of them were caught,
 * because the engine had no test that could run it at all. This exists so
 * they can be.
 *
 * Deliberately dumb. It records every call and answers each table from a
 * fixture, which is enough to assert what the engine wrote, in what order,
 * and what it read. It does not implement filtering: a test that depends on a
 * `.eq()` actually narrowing rows should set the fixture to the narrowed
 * result and assert the filters were asked for.
 */

export interface RecordedCall {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete";
  /** Filters in the order they were chained, as "method:arg". */
  filters: string[];
  /** The row(s) passed to insert, update or upsert. */
  payload?: unknown;
}

export interface FakeOptions {
  /** Rows a select on each table resolves to. */
  rows?: Record<string, unknown[]>;
  /** Error a select on each table resolves with, instead of rows. */
  errors?: Record<string, { code: string; message: string }>;
}

const TERMINAL = new Set(["single", "maybeSingle"]);

export function createFakeSupabase(options: FakeOptions = {}) {
  const calls: RecordedCall[] = [];
  const rows = options.rows ?? {};
  const errors = options.errors ?? {};

  function builder(table: string, op: RecordedCall["op"], payload?: unknown) {
    const call: RecordedCall = { table, op, filters: [], payload };
    calls.push(call);

    const settle = (single: boolean) => {
      const error = errors[table];
      if (error && op === "select") return { data: null, error };
      const found = rows[table] ?? [];
      return single
        ? {
            data: found[0] ?? null,
            error: found.length
              ? null
              : { code: "PGRST116", message: "no rows" },
          }
        : { data: found, error: null };
    };

    // Every chain method records itself and returns the same object, so the
    // engine can chain in any order. Awaiting resolves to the fixture.
    const chain: Record<string, unknown> = {
      then(resolve: (value: unknown) => unknown, reject?: () => unknown) {
        return Promise.resolve(settle(false)).then(resolve, reject);
      },
    };

    for (const method of [
      "select", "eq", "neq", "is", "in", "gte", "lte", "gt", "lt",
      "contains", "order", "limit", "range", "or", "ilike", "filter",
    ]) {
      chain[method] = (...args: unknown[]) => {
        // JSON, not String(): a `.contains({payload, sessionId})` filter
        // stringifies to "[object Object]" and the test can see nothing.
        call.filters.push(
          `${method}:${args
            .map((a) => (typeof a === "object" && a !== null ? JSON.stringify(a) : String(a)))
            .join(",")}`
        );
        return chain;
      };
    }

    for (const method of TERMINAL) {
      chain[method] = () => Promise.resolve(settle(true));
    }

    return chain;
  }

  const client = {
    from(table: string) {
      return {
        select: (...args: unknown[]) => {
          const b = builder(table, "select");
          (b as { select: (...a: unknown[]) => unknown }).select(...args);
          return b;
        },
        insert: (payload: unknown) => builder(table, "insert", payload),
        update: (payload: unknown) => builder(table, "update", payload),
        upsert: (payload: unknown) => builder(table, "upsert", payload),
        delete: () => builder(table, "delete"),
      };
    },
    rpc: () => ({ then: (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(r) }),
  };

  return {
    client,
    calls,
    /** Every call to one table, optionally narrowed to one operation. */
    on(table: string, op?: RecordedCall["op"]) {
      return calls.filter((c) => c.table === table && (!op || c.op === op));
    },
    /** True when any call to a table carried a filter containing `text`. */
    asked(table: string, text: string) {
      return calls.some(
        (c) => c.table === table && c.filters.some((f) => f.includes(text))
      );
    },
  };
}
