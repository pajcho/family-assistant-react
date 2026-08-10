import { describe, expect, it, vi } from "vitest";

import {
  applyPageDecisions,
  decideEvent,
  type EventDecision,
  type GEvent,
  type SyncCalendarRow,
} from "./calendarSync.ts";

/**
 * Two things are pinned here.
 *
 * 1. `decideEvent` - the rules that decide WHICH rows a Google event touches:
 *    cancelled / self-declined / skipped event types are deleted, `visibility`
 *    rides along on every row, and a multi-day event is sliced per day.
 * 2. `applyPageDecisions` - the batched write path. It must land the exact same
 *    rows as the old two-statements-per-event loop (which `applyLegacy` below
 *    reproduces as the reference) while issuing a bounded number of statements.
 */

// Europe/Belgrade is CEST (+02:00) throughout June, so the wall-clock math below
// is stable regardless of where the test runs.
const TZ = "Europe/Belgrade";
const SYNCED_AT = "2026-06-10T08:00:00.000Z";
const TABLE = "external_calendar_events";

const CAL: SyncCalendarRow = {
  id: "cal-1",
  google_calendar_id: "primary@example.com",
  sharing: "family",
  family_id: "fam-1",
  owner_user_id: "user-1",
  sync_token: null,
  color: "blue",
  connection: {
    id: "conn-1",
    access_token: "at",
    refresh_token: "rt",
    token_expires_at: null,
  },
};

function decide(
  ev: GEvent,
  skipTypes = new Set<string>(),
  visibility: "family" | "private" = "family",
) {
  return decideEvent(CAL, visibility, TZ, skipTypes, ev, SYNCED_AT);
}

// --- an in-memory stand-in for the PostgREST client ---------------------------

type Row = Record<string, unknown>;
type Filter =
  | { op: "eq"; column: string; value: unknown }
  | { op: "in"; column: string; values: unknown[] }
  | { op: "notIn"; column: string; values: string[] };

interface Statement {
  kind: "select" | "delete" | "upsert";
  table: string;
  filters: Filter[];
  rows: number;
  onConflict?: string;
}

const CONFLICT_KEY = ["calendar_id", "google_event_id", "local_date"] as const;

function conflictKey(row: Row): string {
  return CONFLICT_KEY.map((c) => String(row[c])).join("|");
}

/** Parses PostgREST's `("2026-06-11","2026-06-12")` value list back to strings. */
function parseInList(value: string): string[] {
  const inner = value.replace(/^\(/, "").replace(/\)$/, "");
  if (inner === "") return [];
  return inner.split(",").map((v) => v.replace(/^"/, "").replace(/"$/, ""));
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    if (f.op === "eq") return row[f.column] === f.value;
    if (f.op === "in") return f.values.includes(row[f.column]);
    return !f.values.includes(row[f.column] as string);
  });
}

type PendingOp =
  | { kind: "select"; columns: string }
  | { kind: "delete" }
  | { kind: "upsert"; rows: Row[]; onConflict: string };

class FakeDb {
  rows: Row[] = [];
  statements: Statement[] = [];
  /** Set to make the next `select` answer like a max-rows truncation (HTTP 206). */
  truncateSelect = false;
  /** Set to make the next `upsert` answer with an error. */
  failUpsert = false;

  seed(rows: Row[]): void {
    for (const row of rows) this.rows.push({ ...row });
  }

  /** Every stored row, ordered so two runs can be compared directly. */
  snapshot(): Row[] {
    return [...this.rows].sort((a, b) =>
      `${a.google_event_id}|${a.local_date}`.localeCompare(`${b.google_event_id}|${b.local_date}`),
    );
  }

  count(kind: Statement["kind"]): number {
    return this.statements.filter((s) => s.kind === kind).length;
  }

  from(table: string) {
    return {
      select: (columns: string) => this.builder(table, { kind: "select", columns }),
      delete: () => this.builder(table, { kind: "delete" }),
      upsert: (rows: Row[], opts: { onConflict: string }) =>
        this.builder(table, { kind: "upsert", rows, onConflict: opts.onConflict }),
    };
  }

  /**
   * A PostgREST-ish builder: chainable filters on a promise that only runs once
   * the caller awaits it, which is after the whole chain has been built.
   */
  private builder(table: string, op: PendingOp) {
    const filters: Filter[] = [];
    const chain = Object.assign(
      new Promise<unknown>((resolve) => {
        queueMicrotask(() => resolve(this.run(table, op, filters)));
      }),
      {
        eq: (column: string, value: unknown) => {
          filters.push({ op: "eq", column, value });
          return chain;
        },
        in: (column: string, values: unknown[]) => {
          filters.push({ op: "in", column, values });
          return chain;
        },
        not: (column: string, operator: string, value: string) => {
          if (operator !== "in") throw new Error(`fake db: unsupported not(${operator})`);
          filters.push({ op: "notIn", column, values: parseInList(value) });
          return chain;
        },
      },
    );
    return chain;
  }

  private run(table: string, op: PendingOp, filters: Filter[]) {
    if (op.kind === "select") {
      const hits = this.rows.filter((r) => matches(r, filters));
      this.statements.push({ kind: "select", table, filters, rows: hits.length });
      if (this.truncateSelect) {
        this.truncateSelect = false;
        return { data: hits.slice(0, 1), error: null, status: 206 };
      }
      return {
        data: hits.map((r) => ({ google_event_id: r.google_event_id, local_date: r.local_date })),
        error: null,
        status: 200,
      };
    }

    if (op.kind === "delete") {
      const before = this.rows.length;
      this.rows = this.rows.filter((r) => !matches(r, filters));
      this.statements.push({ kind: "delete", table, filters, rows: before - this.rows.length });
      return { data: null, error: null, status: 204 };
    }

    this.statements.push({
      kind: "upsert",
      table,
      filters,
      rows: op.rows.length,
      onConflict: op.onConflict,
    });
    if (this.failUpsert) {
      this.failUpsert = false;
      return { data: null, error: { message: "boom" }, status: 500 };
    }
    // Postgres refuses an ON CONFLICT batch that hits the same key twice.
    const seen = new Set<string>();
    for (const row of op.rows) {
      const key = conflictKey(row);
      if (seen.has(key)) {
        return {
          data: null,
          error: { code: "21000", message: "cannot affect row a second time" },
          status: 400,
        };
      }
      seen.add(key);
    }
    for (const row of op.rows) {
      const key = conflictKey(row);
      const at = this.rows.findIndex((r) => conflictKey(r) === key);
      if (at === -1) this.rows.push({ ...row });
      else this.rows[at] = { ...row };
    }
    return { data: null, error: null, status: 201 };
  }
}

/** The fake stands in for the supabase client, whose type comes from a remote
 *  import Deno resolves and vitest does not - so it is cast in at the call. */
type FakeAdmin = Parameters<typeof applyPageDecisions>[0];

/**
 * The pre-batching write path, kept as the reference the batched one must match:
 * two statements per event, issued unconditionally, one event at a time.
 */
async function applyLegacy(
  db: FakeDb,
  calendarId: string,
  decisions: EventDecision[],
): Promise<void> {
  for (const d of decisions) {
    if (d.kind === "skip") continue;
    if (d.kind === "delete") {
      await db
        .from(TABLE)
        .delete()
        .eq("calendar_id", calendarId)
        .eq("google_event_id", d.googleEventId);
      continue;
    }
    await db.from(TABLE).upsert(d.rows as unknown as Row[], { onConflict: CONFLICT_KEY.join(",") });
    const keep = d.keepLocalDates.map((x) => `"${x}"`).join(",");
    await db
      .from(TABLE)
      .delete()
      .eq("calendar_id", calendarId)
      .eq("google_event_id", d.googleEventId)
      .not("local_date", "in", `(${keep})`);
  }
}

/** The stored day-rows a decision should end up with, as the fake db holds them. */
function expectedRows(decisions: EventDecision[]): Row[] {
  const rows: Row[] = [];
  for (const d of decisions) {
    if (d.kind === "upsert") rows.push(...(d.rows as unknown as Row[]));
  }
  return rows.sort((a, b) =>
    `${a.google_event_id}|${a.local_date}`.localeCompare(`${b.google_event_id}|${b.local_date}`),
  );
}

// --- decideEvent --------------------------------------------------------------

describe("decideEvent - what a Google event does to the mirror", () => {
  it("upserts one all-day row and keeps just that day", () => {
    const d = decide({ id: "ev-allday", summary: "Praznik", start: { date: "2026-06-11" } });
    expect(d.kind).toBe("upsert");
    if (d.kind !== "upsert") return;
    expect(d.keepLocalDates).toEqual(["2026-06-11"]);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({
      calendar_id: "cal-1",
      family_id: "fam-1",
      owner_user_id: "user-1",
      visibility: "family",
      google_event_id: "ev-allday",
      title: "Praznik",
      color: "blue",
      event_type: "default",
      local_date: "2026-06-11",
      is_all_day: true,
      start_at: null,
      start_time: null,
      synced_at: SYNCED_AT,
    });
  });

  it("upserts one timed row carrying every Google field the mirror stores", () => {
    const d = decide({
      id: "ev-timed",
      summary: "Zubar",
      description: "kontrola",
      location: "Beograd",
      htmlLink: "https://calendar.google.com/e/1",
      iCalUID: "uid-1",
      recurringEventId: "series-1",
      eventType: "default",
      status: "confirmed",
      source: { url: "https://example.test/x" },
      start: { dateTime: "2026-06-11T09:00:00+02:00" },
      end: { dateTime: "2026-06-11T10:30:00+02:00" },
    });
    expect(d.kind).toBe("upsert");
    if (d.kind !== "upsert") return;
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({
      google_event_id: "ev-timed",
      ical_uid: "uid-1",
      recurring_event_id: "series-1",
      description: "kontrola",
      location: "Beograd",
      html_link: "https://calendar.google.com/e/1",
      source_url: "https://example.test/x",
      status: "confirmed",
      local_date: "2026-06-11",
      start_time: "09:00",
      end_time: "10:30",
      is_all_day: false,
    });
  });

  it("slices a multi-day span into one row per day, all sharing the event fields", () => {
    const d = decide({
      id: "ev-span",
      summary: "Odmor",
      start: { date: "2026-06-11" },
      end: { date: "2026-06-14" },
    });
    expect(d.kind).toBe("upsert");
    if (d.kind !== "upsert") return;
    expect(d.keepLocalDates).toEqual(["2026-06-11", "2026-06-12", "2026-06-13"]);
    expect(d.rows.map((r) => r.local_date)).toEqual(d.keepLocalDates);
    expect(d.rows.every((r) => r.google_event_id === "ev-span" && r.title === "Odmor")).toBe(true);
  });

  it("deletes a cancelled event instead of upserting it", () => {
    const d = decide({
      id: "ev-gone",
      status: "cancelled",
      start: { dateTime: "2026-06-11T09:00:00+02:00" },
    });
    expect(d).toEqual({ kind: "delete", googleEventId: "ev-gone" });
  });

  it("deletes an invite the connecting member declined", () => {
    const d = decide({
      id: "ev-declined",
      start: { dateTime: "2026-06-11T09:00:00+02:00" },
      attendees: [
        { self: false, responseStatus: "declined" },
        { self: true, responseStatus: "declined" },
      ],
    });
    expect(d).toEqual({ kind: "delete", googleEventId: "ev-declined" });
  });

  it("keeps an invite someone else declined", () => {
    const d = decide({
      id: "ev-other-declined",
      start: { dateTime: "2026-06-11T09:00:00+02:00" },
      attendees: [{ self: false, responseStatus: "declined" }, { self: true }],
    });
    expect(d.kind).toBe("upsert");
  });

  it("deletes an event whose type the owner chose not to import", () => {
    const skip = new Set(["birthday", "outOfOffice", "focusTime", "workingLocation"]);
    expect(
      decide({ id: "ev-bday", eventType: "birthday", start: { date: "2026-06-11" } }, skip),
    ).toEqual({ kind: "delete", googleEventId: "ev-bday" });
    // Unknown / future types are never skipped - it is a skip-list, not an allow-list.
    expect(
      decide({ id: "ev-new-type", eventType: "somethingNew", start: { date: "2026-06-11" } }, skip)
        .kind,
    ).toBe("upsert");
  });

  it("skips (writes nothing at all for) an event with no usable start", () => {
    expect(decide({ id: "ev-nostart" })).toEqual({ kind: "skip" });
  });

  it("stamps every row with the calendar's visibility", () => {
    const d = decide({ id: "ev-private", start: { date: "2026-06-11" } }, new Set(), "private");
    expect(d.kind).toBe("upsert");
    if (d.kind !== "upsert") return;
    expect(d.rows.every((r) => r.visibility === "private")).toBe(true);
  });
});

// --- applyPageDecisions: same rows as before ----------------------------------

/** A page mixing every case the sync has to get right. */
function mixedPage(): EventDecision[] {
  return [
    // brand new timed event
    decide({
      id: "ev-new",
      summary: "Novi",
      start: { dateTime: "2026-06-12T09:00:00+02:00" },
      end: { dateTime: "2026-06-12T10:00:00+02:00" },
    }),
    // unchanged event - already stored exactly like this
    decide({
      id: "ev-same",
      summary: "Isti",
      start: { dateTime: "2026-06-11T09:00:00+02:00" },
      end: { dateTime: "2026-06-11T10:00:00+02:00" },
    }),
    // multi-day event shortened from 11-14 to 11-12
    decide({
      id: "ev-short",
      summary: "Skracen",
      start: { date: "2026-06-11" },
      end: { date: "2026-06-13" },
    }),
    // cancelled event that is still stored
    decide({ id: "ev-cancelled", status: "cancelled", start: { date: "2026-06-11" } }),
    // an event whose type the owner stopped importing
    decide(
      { id: "ev-bday", eventType: "birthday", start: { date: "2026-06-11" } },
      new Set(["birthday"]),
    ),
    // no usable start - must not touch the db
    decide({ id: "ev-nostart" }),
  ];
}

/** What the db already holds before that page is applied. */
function seedRows(): Row[] {
  const stored: Row[] = [
    {
      calendar_id: "cal-1",
      google_event_id: "ev-same",
      local_date: "2026-06-11",
      title: "Isti",
      is_all_day: false,
    },
    { calendar_id: "cal-1", google_event_id: "ev-cancelled", local_date: "2026-06-11" },
    { calendar_id: "cal-1", google_event_id: "ev-bday", local_date: "2026-06-11" },
    // a row of another event that must survive untouched
    { calendar_id: "cal-1", google_event_id: "ev-untouched", local_date: "2026-06-11" },
  ];
  for (const day of ["2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"]) {
    stored.push({ calendar_id: "cal-1", google_event_id: "ev-short", local_date: day });
  }
  return stored;
}

describe("applyPageDecisions - the batched writes land the same rows", () => {
  it("matches the old per-event path row for row on a mixed page", async () => {
    const decisions = mixedPage();

    const legacy = new FakeDb();
    legacy.seed(seedRows());
    await applyLegacy(legacy, "cal-1", decisions);

    const batched = new FakeDb();
    batched.seed(seedRows());
    await applyPageDecisions(batched as unknown as FakeAdmin, "cal-1", decisions);

    expect(batched.snapshot()).toEqual(legacy.snapshot());
    // the one batched upsert still carries the day-level conflict key
    expect(batched.statements.find((s) => s.kind === "upsert")?.onConflict).toBe(
      CONFLICT_KEY.join(","),
    );

    // ... and that shared result is the one written out by hand.
    expect(batched.snapshot()).toEqual(
      [
        ...expectedRows(decisions),
        { calendar_id: "cal-1", google_event_id: "ev-untouched", local_date: "2026-06-11" },
      ].sort((a, b) =>
        `${a.google_event_id}|${a.local_date}`.localeCompare(
          `${b.google_event_id}|${b.local_date}`,
        ),
      ),
    );

    const ids = batched.snapshot().map((r) => `${r.google_event_id}@${r.local_date}`);
    // shortened span pruned back to two days; the cancelled event and the
    // no-longer-imported birthday are both gone even though they were stored.
    expect(ids).toEqual([
      "ev-new@2026-06-12",
      "ev-same@2026-06-11",
      "ev-short@2026-06-11",
      "ev-short@2026-06-12",
      "ev-untouched@2026-06-11",
    ]);
    expect(ids).not.toContain("ev-cancelled@2026-06-11");
    expect(ids).not.toContain("ev-bday@2026-06-11");
  });

  it("prunes only the events that actually shrank", async () => {
    const db = new FakeDb();
    db.seed(seedRows());
    await applyPageDecisions(db as unknown as FakeAdmin, "cal-1", mixedPage());

    const prunes = db.statements.filter((s) => s.filters.some((f) => f.op === "notIn"));
    expect(prunes).toHaveLength(1);
    expect(prunes[0].filters).toContainEqual({
      op: "eq",
      column: "google_event_id",
      value: "ev-short",
    });
  });

  it("issues no prune at all when a re-sync changes nothing", async () => {
    const decisions = [
      decide({
        id: "ev-same",
        summary: "Isti",
        start: { dateTime: "2026-06-11T09:00:00+02:00" },
        end: { dateTime: "2026-06-11T10:00:00+02:00" },
      }),
    ];
    const db = new FakeDb();
    db.seed([{ calendar_id: "cal-1", google_event_id: "ev-same", local_date: "2026-06-11" }]);
    await applyPageDecisions(db as unknown as FakeAdmin, "cal-1", decisions);

    expect(db.statements.some((s) => s.filters.some((f) => f.op === "notIn"))).toBe(false);
    expect(db.snapshot()).toEqual(expectedRows(decisions));
  });

  it("falls back to pruning every event when the stored days cannot be read in full", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const decisions = mixedPage();

    const db = new FakeDb();
    db.seed(seedRows());
    db.truncateSelect = true; // answers 206, like a max-rows cut-off
    await applyPageDecisions(db as unknown as FakeAdmin, "cal-1", decisions);

    // every upserted event pruned, exactly like the old unconditional path
    expect(db.statements.filter((s) => s.filters.some((f) => f.op === "notIn"))).toHaveLength(3);

    const legacy = new FakeDb();
    legacy.seed(seedRows());
    await applyLegacy(legacy, "cal-1", decisions);
    expect(db.snapshot()).toEqual(legacy.snapshot());

    warn.mockRestore();
  });

  it("does not prune when the upsert failed - the rows to keep are not in place", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = new FakeDb();
    db.seed(seedRows());
    db.failUpsert = true;
    await applyPageDecisions(db as unknown as FakeAdmin, "cal-1", mixedPage());

    expect(db.statements.some((s) => s.filters.some((f) => f.op === "notIn"))).toBe(false);
    // the shortened event keeps all four stored days rather than losing them
    expect(
      db
        .snapshot()
        .filter((r) => r.google_event_id === "ev-short")
        .map((r) => r.local_date),
    ).toEqual(["2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"]);
    error.mockRestore();
  });

  it("collapses a repeated google_event_id to its last decision", async () => {
    const first = decide({ id: "ev-dup", summary: "Prvi", start: { date: "2026-06-11" } });
    const second = decide({ id: "ev-dup", summary: "Drugi", start: { date: "2026-06-12" } });

    const db = new FakeDb();
    await applyPageDecisions(db as unknown as FakeAdmin, "cal-1", [first, second]);

    // one row, the later one - and no 21000 from a duplicate conflict key
    expect(db.snapshot()).toEqual(expectedRows([second]));

    const cancelledLast = decide({
      id: "ev-dup2",
      status: "cancelled",
      start: { date: "2026-06-11" },
    });
    const db2 = new FakeDb();
    db2.seed([{ calendar_id: "cal-1", google_event_id: "ev-dup2", local_date: "2026-06-10" }]);
    await applyPageDecisions(db2 as unknown as FakeAdmin, "cal-1", [
      decide({ id: "ev-dup2", start: { date: "2026-06-11" } }),
      cancelledLast,
    ]);
    expect(db2.snapshot()).toEqual([]);
  });

  it("writes nothing for a page of skips", async () => {
    const db = new FakeDb();
    await applyPageDecisions(db as unknown as FakeAdmin, "cal-1", [
      decide({ id: "a" }),
      decide({ id: "b" }),
    ]);
    expect(db.statements).toEqual([]);
  });
});

// --- applyPageDecisions: the round-trip reduction -----------------------------

/** A page of N events cycling through new / unchanged / cancelled / multi-day. */
function pageOf(n: number): { decisions: EventDecision[]; seed: Row[] } {
  const decisions: EventDecision[] = [];
  const seed: Row[] = [];
  for (let i = 0; i < n; i++) {
    const id = `ev-${i}`;
    switch (i % 4) {
      case 0:
        decisions.push(decide({ id, start: { dateTime: "2026-06-12T09:00:00+02:00" } }));
        break;
      case 1:
        decisions.push(decide({ id, start: { date: "2026-06-11" } }));
        seed.push({ calendar_id: "cal-1", google_event_id: id, local_date: "2026-06-11" });
        break;
      case 2:
        decisions.push(decide({ id, status: "cancelled", start: { date: "2026-06-11" } }));
        seed.push({ calendar_id: "cal-1", google_event_id: id, local_date: "2026-06-11" });
        break;
      default:
        decisions.push(decide({ id, start: { date: "2026-06-11" }, end: { date: "2026-06-13" } }));
        seed.push({ calendar_id: "cal-1", google_event_id: id, local_date: "2026-06-11" });
        seed.push({ calendar_id: "cal-1", google_event_id: id, local_date: "2026-06-12" });
        break;
    }
  }
  return { decisions, seed };
}

describe("applyPageDecisions - statements per page", () => {
  // [page size, statements batched, statements the old per-event path issued].
  // Batched = one probe select + one upsert + one batched delete (a 1-event page
  // has no cancelled event, hence no delete). The old path is 2 per upserted
  // event + 1 per deleted one, i.e. linear in the page size.
  it.each([
    [1, 2, 2],
    [10, 3, 18],
    [100, 3, 175],
  ])("costs %i events -> %i statements instead of %i", async (n, batchedCount, legacyCount) => {
    const { decisions, seed } = pageOf(n);

    const batched = new FakeDb();
    batched.seed(seed);
    await applyPageDecisions(batched as unknown as FakeAdmin, "cal-1", decisions);

    const legacy = new FakeDb();
    legacy.seed(seed);
    await applyLegacy(legacy, "cal-1", decisions);

    // same rows...
    expect(batched.snapshot()).toEqual(legacy.snapshot());
    // ...at a cost that does not grow with the page size.
    expect(batched.statements).toHaveLength(batchedCount);
    expect(legacy.statements).toHaveLength(legacyCount);
    expect(batched.count("upsert")).toBe(1);
    expect(batched.count("select")).toBe(1);
    expect(batched.count("delete")).toBe(n >= 3 ? 1 : 0);
  });

  it("adds exactly one statement per event that really shrank", async () => {
    const { decisions, seed } = pageOf(40);
    // give three of the unchanged all-day events a stale extra day
    for (const id of ["ev-1", "ev-5", "ev-9"]) {
      seed.push({ calendar_id: "cal-1", google_event_id: id, local_date: "2026-06-20" });
    }
    const db = new FakeDb();
    db.seed(seed);
    await applyPageDecisions(db as unknown as FakeAdmin, "cal-1", decisions);

    expect(db.statements).toHaveLength(3 + 3);
    expect(db.snapshot().some((r) => r.local_date === "2026-06-20")).toBe(false);
  });
});
