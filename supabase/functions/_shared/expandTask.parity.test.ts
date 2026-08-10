import { describe, expect, it } from "vitest";

import {
  expandTaskOccurrences as expandServer,
  isMissedOccurrence as missedServer,
  isTaskDoneOn as doneServer,
  isTaskOverdue as overdueServer,
  type TaskOccurrenceRecord,
  type TaskSeries,
} from "./expandTask.ts";
import {
  expandTaskOccurrences as expandClient,
  isMissedOccurrence as missedClient,
  isTaskDoneOn as doneClient,
  isTaskOverdue as overdueClient,
} from "@/utils/task";
import type { Task, TaskOccurrence } from "@/types/database";

/**
 * The recurrence engine exists twice: once in `src/utils/task.ts` for the app,
 * once here in Deno for the digest and the reminder pushes. They cannot import
 * each other (different runtimes, no bundler on the edge), so the only thing
 * keeping them honest is this file.
 *
 * It matters because the two halves answer the same question in a user's hand.
 * The morning digest says "Danas: 3 zadatka" and then the Danas screen has to
 * show three. A divergence is not a failing test somewhere - it is the app
 * lying to somebody before breakfast.
 *
 * They already guard the runaway walk differently on purpose (the client
 * fast-forwards to the window before walking, the server caps returned
 * instances rather than visited dates), which is exactly the kind of
 * independently-reasonable choice that produces different output at the edges.
 * So this compares OUTPUT over a generated corpus, not implementations.
 */

/** Deterministic LCG - a seeded corpus fails reproducibly, unlike Math.random. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const PERIODS = ["one-time", "daily", "weekly", "monthly", null] as const;

function isoDay(base: Date, offsetDays: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * One generated series. Returned as the two structural shapes the halves take -
 * the server's `TaskSeries` is a subset of the client's `Task`, so a single
 * literal satisfies both and there is no chance of feeding them different data.
 */
function makeSeries(rand: () => number, base: Date): { client: Task; server: TaskSeries } {
  const period = PERIODS[Math.floor(rand() * PERIODS.length)];
  // Anchors reach far back on purpose: a chore created two years ago is where
  // the two runaway guards are most likely to part company.
  const anchorOffset = -Math.floor(rand() * 800);
  const interval = 1 + Math.floor(rand() * 4);
  const weekdayCount = Math.floor(rand() * 4);
  const weekdays =
    period === "weekly" && weekdayCount > 0
      ? [...new Set(Array.from({ length: weekdayCount }, () => Math.floor(rand() * 7)))].sort(
          (a, b) => a - b,
        )
      : null;
  const hasUntil = rand() < 0.3;
  const recurring = period !== null && period !== "one-time";
  const shape = {
    id: `task-${Math.floor(rand() * 1e9)}`,
    due_date: rand() < 0.08 ? null : isoDay(base, anchorOffset),
    recurrence_period: period,
    recurrence_interval: interval,
    recurrence_weekdays: weekdays,
    recurrence_until: hasUntil ? isoDay(base, Math.floor(rand() * 120) - 30) : null,
    completion_mode: rand() < 0.25 ? ("per_assignee" as const) : ("shared" as const),
    // A recurring task may never carry is_completed - the database CHECK
    // `tasks_recurring_not_completed` forbids it, so generating it here would
    // compare behaviour on rows that cannot exist.
    is_completed: recurring ? false : rand() < 0.2,
  };

  return {
    client: {
      ...shape,
      list_id: null,
      family_id: "fam",
      owner_id: "owner",
      scope: "family",
      name: "generated",
      description: null,
      completed_at: null,
      completed_by_person_id: null,
      due_time: null,
      remind_minutes_before: null,
      remind_days_before: null,
      sort_order: 0,
      created_by_id: null,
      updated_by_id: null,
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-01-01T00:00:00.000Z",
    } as Task,
    server: shape as TaskSeries,
  };
}

/** Occurrence rows for a series, keyed the way both halves expect. */
function makeOccurrences(
  rand: () => number,
  taskId: string,
  base: Date,
): {
  client: Map<string, TaskOccurrence[]>;
  server: Map<string, TaskOccurrenceRecord[]>;
} {
  const client = new Map<string, TaskOccurrence[]>();
  const server = new Map<string, TaskOccurrenceRecord[]>();
  const count = Math.floor(rand() * 5);

  for (let i = 0; i < count; i += 1) {
    const occurrenceDate = isoDay(base, Math.floor(rand() * 60) - 30);
    const roll = rand();
    const status = roll < 0.55 ? "done" : roll < 0.8 ? "skipped" : "moved";
    const personId = rand() < 0.3 ? "person-1" : null;
    const row = {
      task_id: taskId,
      occurrence_date: occurrenceDate,
      person_id: personId,
      status: status as "done" | "skipped" | "moved",
      moved_to_date: status === "moved" ? isoDay(base, Math.floor(rand() * 20) - 5) : null,
    };
    const key = `${taskId}|${occurrenceDate}`;

    const clientRows = client.get(key) ?? [];
    clientRows.push({
      ...row,
      id: `occ-${i}`,
      family_id: "fam",
      completed_at: status === "done" ? "2026-08-01T00:00:00.000Z" : null,
      completed_by_person_id: null,
      note: null,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    } as TaskOccurrence);
    client.set(key, clientRows);

    const serverRows = server.get(key) ?? [];
    serverRows.push(row);
    server.set(key, serverRows);
  }

  return { client, server };
}

/** Only the fields both halves promise. Extra client-only fields are not parity. */
function comparable(instances: { occurrenceDate: string; effectiveDate: string }[]) {
  return instances.map((i) => `${i.occurrenceDate}->${i.effectiveDate}`);
}

describe("expandTask parity: the app and the digest must agree", () => {
  // A month-long window, which is what the agenda and the digest both ask for.
  const base = new Date(2026, 7, 10);
  const from = isoDay(base, 0);
  const to = isoDay(base, 30);

  it("returns the same instances for 600 generated series", () => {
    const rand = lcg(20260811);
    const divergences: string[] = [];

    for (let n = 0; n < 600; n += 1) {
      const { client, server } = makeSeries(rand, base);
      const occ = makeOccurrences(rand, client.id, base);

      const clientOut = expandClient(client, from, to, occ.client);
      const serverOut = expandServer(server, from, to, occ.server);

      const c = comparable(clientOut);
      const s = comparable(serverOut);
      if (JSON.stringify(c) !== JSON.stringify(s)) {
        divergences.push(
          [
            `series ${n}: period=${client.recurrence_period} interval=${client.recurrence_interval}`,
            `anchor=${client.due_date} weekdays=${JSON.stringify(client.recurrence_weekdays)}`,
            `until=${client.recurrence_until}`,
            `  client(${c.length}): ${c.slice(0, 8).join(", ")}`,
            `  server(${s.length}): ${s.slice(0, 8).join(", ")}`,
          ].join("\n"),
        );
      }
    }

    expect(divergences.slice(0, 5).join("\n\n")).toBe("");
  });

  it("agrees on done, overdue and missed for 600 generated series", () => {
    const rand = lcg(777);
    const today = isoDay(base, 5);
    const divergences: string[] = [];

    for (let n = 0; n < 600; n += 1) {
      const { client, server } = makeSeries(rand, base);
      const occ = makeOccurrences(rand, client.id, base);

      for (const personId of [null, "person-1"]) {
        for (let d = 0; d <= 30; d += 7) {
          const date = isoDay(base, d);
          const cd = doneClient(client, date, occ.client, personId);
          const sd = doneServer(server, date, occ.server, personId);
          if (cd !== sd) {
            divergences.push(
              `series ${n} isTaskDoneOn(${date}, ${personId}): client=${cd} server=${sd} mode=${client.completion_mode}`,
            );
          }
        }
      }

      if (overdueClient(client, today) !== overdueServer(server, today)) {
        divergences.push(
          `series ${n} isTaskOverdue: client=${overdueClient(client, today)} server=${overdueServer(server, today)}`,
        );
      }

      const clientOut = expandClient(client, from, to, occ.client);
      const serverOut = expandServer(server, from, to, occ.server);
      const len = Math.min(clientOut.length, serverOut.length);
      for (let i = 0; i < len; i += 1) {
        if (missedClient(clientOut[i], today) !== missedServer(serverOut[i], today)) {
          divergences.push(
            `series ${n} instance ${i} isMissedOccurrence: client=${missedClient(clientOut[i], today)} server=${missedServer(serverOut[i], today)}`,
          );
        }
      }
    }

    expect(divergences.slice(0, 5).join("\n")).toBe("");
  });

  it("agrees on a daily chore anchored two years back, the case both guards handle differently", () => {
    const anchor = isoDay(base, -730);
    const shape = {
      id: "old-daily",
      due_date: anchor,
      recurrence_period: "daily" as const,
      recurrence_interval: 1,
      recurrence_weekdays: null,
      recurrence_until: null,
      completion_mode: "shared" as const,
      is_completed: false,
    };
    const empty = new Map();

    const c = comparable(expandClient({ ...shape } as Task, from, to, empty));
    const s = comparable(expandServer(shape as TaskSeries, from, to, empty));

    // 31 inclusive days in the window, and neither half may run out of budget
    // before it gets there.
    expect(c).toHaveLength(31);
    expect(s).toEqual(c);
  });

  it("agrees on a weekday chore anchored two years back", () => {
    const shape = {
      id: "old-weekly",
      due_date: isoDay(base, -730),
      recurrence_period: "weekly" as const,
      recurrence_interval: 1,
      recurrence_weekdays: [0, 1, 2, 3, 4],
      recurrence_until: null,
      completion_mode: "shared" as const,
      is_completed: false,
    };
    const empty = new Map();

    const c = comparable(expandClient({ ...shape } as Task, from, to, empty));
    const s = comparable(expandServer(shape as TaskSeries, from, to, empty));

    expect(c.length).toBeGreaterThan(19);
    expect(s).toEqual(c);
  });
});
