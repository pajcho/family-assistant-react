import { describe, expect, it } from "vitest";

import { assignLanes } from "../weekGridLayout";

type B = { id: string; startTime: string; endTime: string };
const b = (id: string, startTime: string, endTime: string): B => ({
  id,
  startTime,
  endTime,
});
const byId = (rows: Array<{ id: string }>) => Object.fromEntries(rows.map((r) => [r.id, r]));

describe("assignLanes", () => {
  it("gives back-to-back, non-overlapping blocks the full width", () => {
    const out = assignLanes([b("a", "08:00", "09:00"), b("b", "09:00", "10:00")]);
    for (const r of out) {
      expect(r.lane).toBe(1);
      expect(r.totalLanes).toBe(1);
      expect(r.laneSpan).toBe(1);
    }
  });

  it("splits two simultaneous blocks into two equal columns", () => {
    const out = byId(assignLanes([b("a", "10:00", "11:00"), b("b", "10:00", "11:00")]));
    expect(out.a).toMatchObject({ lane: 1, totalLanes: 2, laneSpan: 1 });
    expect(out.b).toMatchObject({ lane: 2, totalLanes: 2, laneSpan: 1 });
  });

  it("splits three simultaneous blocks into three columns", () => {
    const out = assignLanes([
      b("a", "10:00", "11:00"),
      b("b", "10:00", "11:00"),
      b("c", "10:00", "11:00"),
    ]);
    expect(out.map((r) => r.lane).sort()).toEqual([1, 2, 3]);
    for (const r of out) expect(r.totalLanes).toBe(3);
  });

  it("divides by PEAK overlap, not group size, for a transitive chain", () => {
    // a–b overlap and b–c overlap, but a and c do not. Group size is 3, yet at
    // most 2 are ever active at once → 2 columns, not 3 (no dead column right).
    const out = assignLanes([
      b("a", "10:00", "10:40"),
      b("b", "10:20", "11:00"),
      b("c", "10:45", "11:30"),
    ]);
    for (const r of out) expect(r.totalLanes).toBe(2);
  });

  it("keeps a 5-block school-period chain at 2 columns (the reported bug)", () => {
    // Sequential 45-min classes interleaved with two activities that straddle
    // them — the production case that left ~60% of the column empty when width
    // was divided by group size (5) instead of peak overlap (2).
    const out = assignLanes([
      b("E", "09:55", "10:40"),
      b("Solfedjo", "10:20", "11:05"),
      b("S", "10:45", "11:30"),
      b("Klavir", "11:10", "11:55"),
      b("F", "11:35", "12:20"),
    ]);
    for (const r of out) expect(r.totalLanes).toBe(2);
  });

  it("expands a block into columns freed by finished neighbours", () => {
    // b & c run early; a spans the whole window; d starts after b & c end.
    // Peak overlap is 3 (a+b+c at 10:00), so 3 columns — but d finds the two
    // lower columns free for its whole span and widens across them.
    const out = byId(
      assignLanes([
        b("a", "10:00", "12:00"),
        b("b", "10:00", "10:30"),
        b("c", "10:00", "10:30"),
        b("d", "11:00", "11:30"),
      ]),
    );
    expect(out.d).toMatchObject({ lane: 1, totalLanes: 3, laneSpan: 2 });
  });
});
