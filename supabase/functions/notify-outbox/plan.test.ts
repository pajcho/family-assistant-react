import { describe, expect, it } from "vitest";

import {
  batchBody,
  batchTitle,
  planOutboxPushes,
  recipientsFor,
  type PlanInput,
} from "../notify-outbox/plan";

const MILAN = "milan";
const JELENA = "jelena";
const ANA = "ana";
const VUK = "vuk";
const FAMILY = "family-1";

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    rows: [],
    tasksById: new Map(),
    assigneesByTask: new Map(),
    membersByFamily: new Map([[FAMILY, [MILAN, JELENA, ANA, VUK]]]),
    kidProfileIds: new Set([VUK]),
    pushableIds: new Set([MILAN, JELENA, ANA, VUK]),
    optedOut: new Set(),
    nameById: new Map([
      [MILAN, "Milan"],
      [JELENA, "Jelena"],
    ]),
    ...overrides,
  };
}

function task(id: string, name: string) {
  return { id, name, family_id: FAMILY };
}

describe("recipientsFor", () => {
  it("sends an assigned task to its assignees only", () => {
    const it_ = input({ assigneesByTask: new Map([["t1", [ANA]]]) });
    expect(recipientsFor("t1", FAMILY, MILAN, it_)).toEqual([ANA]);
  });

  it("drops the creator even when the task is assigned to them", () => {
    const it_ = input({ assigneesByTask: new Map([["t1", [MILAN, ANA]]]) });
    expect(recipientsFor("t1", FAMILY, MILAN, it_)).toEqual([ANA]);
  });

  it("falls back to the whole family when nobody is assigned", () => {
    expect(recipientsFor("t1", FAMILY, MILAN, input())).toEqual([JELENA, ANA]);
  });

  it("leaves kid-login children out of the family-wide fan-out", () => {
    expect(recipientsFor("t1", FAMILY, MILAN, input())).not.toContain(VUK);
  });

  it("still reaches a child the task was assigned to", () => {
    const it_ = input({ assigneesByTask: new Map([["t1", [VUK]]]) });
    expect(recipientsFor("t1", FAMILY, MILAN, it_)).toEqual([VUK]);
  });

  it("respects the per-kind opt-out", () => {
    const it_ = input({ optedOut: new Set([JELENA]) });
    expect(recipientsFor("t1", FAMILY, MILAN, it_)).toEqual([ANA]);
  });

  it("skips a member no push can reach - a profile with no login behind it", () => {
    const it_ = input({ pushableIds: new Set([JELENA]) });
    expect(recipientsFor("t1", FAMILY, MILAN, it_)).toEqual([JELENA]);
  });

  it("skips an unreachable member even when the task is theirs", () => {
    const it_ = input({
      assigneesByTask: new Map([["t1", [ANA]]]),
      pushableIds: new Set([JELENA]),
    });
    expect(recipientsFor("t1", FAMILY, MILAN, it_)).toEqual([]);
  });

  it("notifies everybody when there is no actor (a service-role insert)", () => {
    expect(recipientsFor("t1", FAMILY, null, input())).toEqual([MILAN, JELENA, ANA]);
  });
});

describe("planOutboxPushes", () => {
  it("collapses a burst into one push per person", () => {
    const batches = planOutboxPushes(
      input({
        rows: [
          { id: "r1", entity_id: "t1", actor_id: MILAN },
          { id: "r2", entity_id: "t2", actor_id: MILAN },
          { id: "r3", entity_id: "t3", actor_id: MILAN },
        ],
        tasksById: new Map([
          ["t1", task("t1", "Kupiti hleb")],
          ["t2", task("t2", "Zvati servis")],
          ["t3", task("t3", "Uplatiti struju")],
        ]),
      }),
    );

    expect(batches).toHaveLength(2); // Jelena and Ana, not Milan and not Vuk
    expect(batches[0].taskIds).toEqual(["t1", "t2", "t3"]);
    // The copy the sender composes from that batch.
    expect(batchTitle(batches[0].taskNames.length)).toBe("3 nova zadatka");
    expect(batchBody(batches[0].taskNames, batches[0].actorName)).toBe(
      "Milan je dodao(la): Kupiti hleb, Zvati servis, Uplatiti struju",
    );
  });

  it("skips a task that was deleted inside the window", () => {
    const batches = planOutboxPushes(
      input({
        rows: [
          { id: "r1", entity_id: "t1", actor_id: MILAN },
          { id: "r2", entity_id: "gone", actor_id: MILAN },
        ],
        tasksById: new Map([["t1", task("t1", "Kupiti hleb")]]),
      }),
    );
    expect(batches[0].taskIds).toEqual(["t1"]);
    expect(batchTitle(batches[0].taskNames.length)).toBe("Novi zadatak");
  });

  it("routes each task by its own assignment inside one flush", () => {
    const batches = planOutboxPushes(
      input({
        rows: [
          { id: "r1", entity_id: "t1", actor_id: MILAN },
          { id: "r2", entity_id: "t2", actor_id: MILAN },
        ],
        tasksById: new Map([
          ["t1", task("t1", "Ani: sudovi")],
          ["t2", task("t2", "Nikom posebno")],
        ]),
        assigneesByTask: new Map([["t1", [ANA]]]),
      }),
    );

    const byUser = new Map(batches.map((batch) => [batch.userId, batch]));
    // Ana is on both: hers by name, and the unassigned one as family.
    expect(byUser.get(ANA)?.taskIds).toEqual(["t1", "t2"]);
    // Jelena only sees the family-wide one.
    expect(byUser.get(JELENA)?.taskIds).toEqual(["t2"]);
  });

  it("drops the actor's name when a batch came from two people", () => {
    const batches = planOutboxPushes(
      input({
        rows: [
          { id: "r1", entity_id: "t1", actor_id: MILAN },
          { id: "r2", entity_id: "t2", actor_id: JELENA },
        ],
        tasksById: new Map([
          ["t1", task("t1", "Hleb")],
          ["t2", task("t2", "Mleko")],
        ]),
      }),
    );
    const ana = batches.find((batch) => batch.userId === ANA);
    expect(ana?.actorName).toBe("");
    expect(batchBody(ana?.taskNames ?? [], ana?.actorName ?? "")).toBe("Hleb, Mleko");
  });

  it("sends nothing when the only recipient is the creator", () => {
    const batches = planOutboxPushes(
      input({
        rows: [{ id: "r1", entity_id: "t1", actor_id: MILAN }],
        tasksById: new Map([["t1", task("t1", "Sam sebi")]]),
        assigneesByTask: new Map([["t1", [MILAN]]]),
      }),
    );
    expect(batches).toEqual([]);
  });
});

describe("batchTitle", () => {
  it("counts the noun off the last digit, teens excepted", () => {
    expect(batchTitle(1)).toBe("Novi zadatak");
    expect(batchTitle(2)).toBe("2 nova zadatka");
    expect(batchTitle(4)).toBe("4 nova zadatka");
    expect(batchTitle(5)).toBe("5 novih zadataka");
    expect(batchTitle(12)).toBe("12 novih zadataka");
    expect(batchTitle(13)).toBe("13 novih zadataka");
    expect(batchTitle(22)).toBe("22 nova zadatka");
    expect(batchTitle(25)).toBe("25 novih zadataka");
  });
});

describe("batchBody", () => {
  it("caps the list at three and counts the rest", () => {
    expect(batchBody(["A", "B", "C", "D", "E"], "")).toBe("A, B, C i još 2");
  });

  it("names the author when there is exactly one", () => {
    expect(batchBody(["A"], "Milan")).toBe("Milan je dodao(la): A");
  });
});
