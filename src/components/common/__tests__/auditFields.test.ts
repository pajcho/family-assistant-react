import { describe, expect, it } from "vitest";

import { AUDIT_FIELDS, renderChanges, type AuditResolvers } from "@/components/common/auditFields";

/**
 * The registry is the whole difference between a change log and a dump of the
 * audit table, so what is pinned here is the reading, not the plumbing: that a
 * UUID becomes a name, that money and minutes are not both bare numbers, and
 * that a value nobody can resolve any more produces no line at all rather than
 * a row of dashes.
 *
 * It is also the only test that can catch the registry drifting away from
 * `audit_columns()` in 20260814150000_audit_log.sql, which is why the two lists
 * are compared field for field at the bottom.
 */

const resolvers: AuditResolvers = {
  member: (id) => (id === "p1" ? "Marija Perić" : null),
  category: (id) => (id === "c1" ? "Režije" : id === "c2" ? "Ostalo" : null),
  list: (id) => (id === "l1" ? "Kupovina" : null),
};

describe("renderChanges", () => {
  it("reads money as money, not as a bare number", () => {
    const rows = renderChanges("payments", { amount: [3500, 4200] }, resolvers);
    expect(rows).toEqual([{ label: "Iznos", from: "3.500 RSD", to: "4.200 RSD" }]);
  });

  it("accepts the numeric strings PostgREST returns for NUMERIC columns", () => {
    // jsonb from a NUMERIC column arrives as 3500.00, and JSON.parse can hand
    // that back as a string depending on the column type.
    const rows = renderChanges("payments", { amount: ["3500.00", "4200.00"] }, resolvers);
    expect(rows[0]).toMatchObject({ from: "3.500 RSD", to: "4.200 RSD" });
  });

  it("turns a category id into the category's name", () => {
    const rows = renderChanges("expenses", { category_id: ["c2", "c1"] }, resolvers);
    expect(rows).toEqual([{ label: "Kategorija", from: "Ostalo", to: "Režije" }]);
  });

  it("turns a person id into a member's name", () => {
    const rows = renderChanges("expenses", { person_id: [null, "p1"] }, resolvers);
    expect(rows).toEqual([{ label: "Za koga", from: null, to: "Marija Perić" }]);
  });

  it("drops a change whose two ends are both unresolvable", () => {
    // Both categories deleted since: "Kategorija: - -> -" says nothing.
    const rows = renderChanges("expenses", { category_id: ["gone", "also-gone"] }, resolvers);
    expect(rows).toEqual([]);
  });

  it("keeps a change when only one end is unresolvable", () => {
    const rows = renderChanges("expenses", { category_id: ["gone", "c1"] }, resolvers);
    expect(rows).toEqual([{ label: "Kategorija", from: null, to: "Režije" }]);
  });

  it("formats dates the way the rest of the app does", () => {
    const rows = renderChanges("payments", { due_date: ["2026-08-01", "2026-09-05"] }, resolvers);
    expect(rows).toEqual([{ label: "Dospeva", from: "01.08.2026", to: "05.09.2026" }]);
  });

  it("reads a reminder as a phrase, including its absence", () => {
    const rows = renderChanges("payments", { remind_days_before: [null, 2] }, resolvers);
    expect(rows).toEqual([{ label: "Podsetnik", from: "bez podsetnika", to: "2 dana ranije" }]);
  });

  it("agrees the reminder noun with its count", () => {
    const one = renderChanges("payments", { remind_days_before: [2, 1] }, resolvers);
    expect(one[0]?.to).toBe("1 dan ranije");
    const five = renderChanges("payments", { remind_days_before: [1, 5] }, resolvers);
    expect(five[0]?.to).toBe("5 dana ranije");
  });

  it("reads booleans and enums in Serbian", () => {
    const rows = renderChanges(
      "payments",
      { is_paused: [false, true], recurrence_period: ["one-time", "monthly"] },
      resolvers,
    );
    expect(rows).toEqual([
      { label: "Pauzirano", from: "ne", to: "da" },
      { label: "Ponavljanje", from: "jednokratno", to: "mesečno" },
    ]);
  });

  it("renders in registry order, not in the order the trigger serialized", () => {
    // `changes` is a jsonb object, so its key order is Postgres's business.
    // The same edit must always read the same way.
    const rows = renderChanges(
      "payments",
      { due_date: ["2026-08-01", "2026-09-05"], name: ["A", "B"], amount: [1, 2] },
      resolvers,
    );
    expect(rows.map((r) => r.label)).toEqual(["Naziv", "Iznos", "Dospeva"]);
  });

  it("skips a column the registry does not know", () => {
    const rows = renderChanges("payments", { some_new_column: [1, 2] }, resolvers);
    expect(rows).toEqual([]);
  });

  it("returns nothing for a create or a delete, which carry no diff", () => {
    expect(renderChanges("payments", null, resolvers)).toEqual([]);
  });

  it("returns nothing for a table it has no registry for", () => {
    expect(renderChanges("task_occurrences", { status: ["a", "b"] }, resolvers)).toEqual([]);
  });
});

describe("AUDIT_FIELDS vs audit_columns() in the migration", () => {
  // Transcribed from public.audit_columns() in
  // supabase/migrations/20260814150000_audit_log.sql. A column recorded by the
  // database and missing here renders as nothing, which looks like "nobody
  // edited that" - the failure this pins.
  const RECORDED: Record<string, string[]> = {
    payments: [
      "name",
      "description",
      "amount",
      "currency",
      "due_date",
      "category_id",
      "is_paid",
      "is_paused",
      "is_recurring",
      "recurrence_period",
      "recurrence_interval",
      "remind_days_before",
    ],
    events: [
      "name",
      "description",
      "notes",
      "date",
      "end_date",
      "start_time",
      "end_time",
      "canceled_at",
      "cancel_reason",
      "remind_minutes_before",
    ],
    expenses: ["amount", "currency", "spent_on", "category_id", "person_id", "note", "merchant"],
    activities: [
      "name",
      "description",
      "notes",
      "active_from",
      "active_to",
      "is_paused",
      "remind_minutes_before",
    ],
    birthdays: ["name", "description", "birth_date"],
    incomes: ["name", "amount", "person_id", "day_of_month", "is_recurring", "active"],
    income_entries: ["name", "amount", "month", "received_on", "person_id", "note", "is_one_time"],
    tasks: [
      "name",
      "description",
      "due_date",
      "due_time",
      "list_id",
      "recurrence_period",
      "recurrence_interval",
      "recurrence_until",
      "completion_mode",
      "remind_minutes_before",
      "remind_days_before",
    ],
    lists: [
      "name",
      "description",
      "scope",
      "smart_sort_enabled",
      "auto_delete_completed_after_hours",
    ],
    expense_categories: ["name", "color", "icon", "monthly_limit"],
  };

  it("covers every table the trigger is attached to", () => {
    expect(Object.keys(AUDIT_FIELDS).toSorted()).toEqual(Object.keys(RECORDED).toSorted());
  });

  it.each(Object.entries(RECORDED))("renders every column recorded for %s", (table, columns) => {
    expect(Object.keys(AUDIT_FIELDS[table] ?? {}).toSorted()).toEqual(columns.toSorted());
  });
});
