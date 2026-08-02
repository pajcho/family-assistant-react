import { describe, expect, it } from "vitest";

import {
  type ActivityOverrideRow,
  type ActivityRow,
  type BirthdayRow,
  type DispatchInput,
  type EventRow,
  eventLocalFireTime,
  type ExternalEventRow,
  type ExternalLocalRow,
  type ParticipantRow,
  type PaymentRow,
  type PlannedClaim,
  planDispatch,
  type PrefsRow,
  type ProfileRow,
  type PushSubRow,
  type ScheduleRuleRow,
  type ShiftAnchorRow,
} from "./plan.ts";

// Europe/Belgrade is CEST (+02:00) from late March to late October, so every
// instant below is written as UTC and read as local +2. Zagreb shares the
// offset; Europe/London is +01:00 in the same period, which is what the
// multi-timezone cases lean on.
const BG = "Europe/Belgrade";
const LDN = "Europe/London";

const FAMILY = "fam-1";
const OTHER_FAMILY = "fam-2";
const PARENT = "user-parent";
const OTHER_PARENT = "user-other-parent";
const KID = "person-kid";

function at(iso: string): Date {
  return new Date(iso);
}

function prefs(over: Partial<PrefsRow> & { user_id: string }): PrefsRow {
  return {
    morning_enabled: false,
    morning_time: "08:00:00",
    evening_enabled: false,
    evening_time: "20:00:00",
    timezone: BG,
    ...over,
  };
}

function profile(id: string, family_id = FAMILY, first_name: string | null = null): ProfileRow {
  return { id, family_id, first_name, last_name: null };
}

function sub(user_id: string, id = `sub-${user_id}`): PushSubRow {
  return { id, user_id, endpoint: `https://push.test/${id}`, p256dh: "p", auth: "a" };
}

function input(over: Partial<DispatchInput> & { now: Date }): DispatchInput {
  return {
    force: null,
    prefs: [],
    profiles: [],
    subs: [],
    events: [],
    payments: [],
    birthdays: [],
    externalLocals: [],
    externalEvents: [],
    activities: [],
    schedule: [],
    participants: [],
    overrides: [],
    anchors: [],
    ...over,
  };
}

/** Compact view of a claim, which is what the assertions care about. */
function shape(c: PlannedClaim) {
  return {
    userId: c.userId,
    kind: c.kind,
    refId: c.refId,
    title: c.push?.title ?? null,
    body: c.push?.body ?? null,
    status: c.emptyStatus,
  };
}

describe("eventLocalFireTime", () => {
  it("subtracts the offset from the start time", () => {
    expect(eventLocalFireTime("2026-07-29", "18:00:00", 30)).toEqual({
      date: "2026-07-29",
      time: "17:30",
    });
  });

  it("rolls back to the previous day when the offset crosses midnight", () => {
    expect(eventLocalFireTime("2026-07-29", "00:15:00", 30)).toEqual({
      date: "2026-07-28",
      time: "23:45",
    });
  });

  it("treats a zero offset as the start time itself", () => {
    expect(eventLocalFireTime("2026-03-01", "07:05:00", 0)).toEqual({
      date: "2026-03-01",
      time: "07:05",
    });
  });
});

// ---------------------------------------------------------------------------
// Digests
// ---------------------------------------------------------------------------

describe("digests", () => {
  const base = {
    profiles: [profile(PARENT)],
    subs: [sub(PARENT)],
    events: [
      {
        id: "ev-1",
        family_id: FAMILY,
        name: "Sastanak",
        date: "2026-07-29",
        start_time: "18:00:00",
        remind_minutes_before: null,
      } satisfies EventRow,
    ],
  };

  it("fires at the configured local minute and counts today's items", () => {
    const claims = planDispatch(
      input({
        // 06:00 UTC = 08:00 in Belgrade
        now: at("2026-07-29T06:00:30Z"),
        prefs: [prefs({ user_id: PARENT, morning_enabled: true, morning_time: "08:00:00" })],
        ...base,
      }),
    );
    expect(claims.map(shape)).toEqual([
      {
        userId: PARENT,
        kind: "morning_digest",
        refId: "2026-07-29",
        title: "Dobro jutro",
        body: "Danas: 1 događaj.",
        status: null,
      },
    ]);
  });

  it("stays quiet a minute before and a minute after", () => {
    for (const iso of ["2026-07-29T05:59:00Z", "2026-07-29T06:01:00Z"]) {
      const claims = planDispatch(
        input({
          now: at(iso),
          prefs: [prefs({ user_id: PARENT, morning_enabled: true, morning_time: "08:00:00" })],
          ...base,
        }),
      );
      expect(claims).toHaveLength(0);
    }
  });

  it("uses the user's own timezone, not the server's", () => {
    // 07:00 UTC is 08:00 in London but 09:00 in Belgrade.
    const claims = planDispatch(
      input({
        now: at("2026-07-29T07:00:00Z"),
        prefs: [
          prefs({ user_id: PARENT, morning_enabled: true, timezone: LDN }),
          prefs({ user_id: OTHER_PARENT, morning_enabled: true, timezone: BG }),
        ],
        profiles: [profile(PARENT), profile(OTHER_PARENT)],
        subs: [sub(PARENT), sub(OTHER_PARENT)],
        events: base.events,
      }),
    );
    expect(claims.map((c) => c.userId)).toEqual([PARENT]);
  });

  it("targets tomorrow for the evening digest", () => {
    const claims = planDispatch(
      input({
        // 18:00 UTC = 20:00 in Belgrade
        now: at("2026-07-28T18:00:00Z"),
        prefs: [prefs({ user_id: PARENT, evening_enabled: true, evening_time: "20:00:00" })],
        ...base,
      }),
    );
    expect(claims.map(shape)).toEqual([
      {
        userId: PARENT,
        kind: "evening_digest",
        refId: "2026-07-29",
        title: "Pregled za sutra",
        body: "Sutra: 1 događaj.",
        status: null,
      },
    ]);
  });

  it("counts events, payments and birthdays together with Serbian plurals", () => {
    const claims = planDispatch(
      input({
        now: at("2026-07-29T06:00:00Z"),
        prefs: [prefs({ user_id: PARENT, morning_enabled: true })],
        profiles: [profile(PARENT)],
        subs: [sub(PARENT)],
        events: [
          base.events[0],
          { ...base.events[0], id: "ev-2", name: "Drugi" } satisfies EventRow,
        ],
        payments: [
          {
            id: "pay-1",
            family_id: FAMILY,
            name: "Struja",
            amount: 3500,
            due_date: "2026-07-29",
            remind_days_before: null,
          } satisfies PaymentRow,
        ],
        birthdays: [
          {
            id: "bd-1",
            family_id: FAMILY,
            name: "Baka",
            birth_date: "1955-07-29",
          } satisfies BirthdayRow,
        ],
      }),
    );
    expect(claims[0].push?.body).toBe("Danas: 2 događaja, 1 plaćanje, 1 rođendan.");
  });

  it("still claims the slot when the day is empty", () => {
    const claims = planDispatch(
      input({
        now: at("2026-07-29T06:00:00Z"),
        prefs: [prefs({ user_id: PARENT, morning_enabled: true })],
        profiles: [profile(PARENT)],
        subs: [sub(PARENT)],
      }),
    );
    expect(claims.map(shape)).toEqual([
      {
        userId: PARENT,
        kind: "morning_digest",
        refId: "2026-07-29",
        title: null,
        body: null,
        status: "nothing_to_send",
      },
    ]);
  });

  it("reports no_family for a user without a profile", () => {
    const claims = planDispatch(
      input({
        now: at("2026-07-29T06:00:00Z"),
        prefs: [prefs({ user_id: "orphan", morning_enabled: true })],
      }),
    );
    expect(claims.map(shape)[0].status).toBe("no_family");
  });

  it("ignores other families' items", () => {
    const claims = planDispatch(
      input({
        now: at("2026-07-29T06:00:00Z"),
        prefs: [prefs({ user_id: PARENT, morning_enabled: true })],
        profiles: [profile(PARENT, OTHER_FAMILY)],
        subs: [sub(PARENT)],
        events: base.events,
      }),
    );
    expect(claims.map(shape)[0].status).toBe("nothing_to_send");
  });

  it("force=morning skips the clock check but not the opt-in", () => {
    const claims = planDispatch(
      input({
        now: at("2026-07-29T13:37:00Z"),
        force: "morning_digest",
        prefs: [
          // Opted into the evening digest only: force still reaches them,
          // matching the pre-refactor `.or(morning.eq.true,evening.eq.true)`.
          prefs({ user_id: PARENT, evening_enabled: true }),
          // Opted out of both: never a candidate.
          prefs({ user_id: OTHER_PARENT }),
        ],
        profiles: [profile(PARENT), profile(OTHER_PARENT)],
        subs: [sub(PARENT), sub(OTHER_PARENT)],
        events: base.events,
      }),
    );
    expect(claims.map((c) => c.userId)).toEqual([PARENT]);
    expect(claims[0].kind).toBe("morning_digest");
  });
});

// ---------------------------------------------------------------------------
// Event reminders
// ---------------------------------------------------------------------------

describe("event reminders", () => {
  const event: EventRow = {
    id: "ev-1",
    family_id: FAMILY,
    name: "Trening",
    date: "2026-07-29",
    start_time: "18:00:00",
    remind_minutes_before: 30,
  };

  it("fires once per subscribed family member at start minus offset", () => {
    const claims = planDispatch(
      input({
        // 15:30 UTC = 17:30 Belgrade = 18:00 minus 30 min
        now: at("2026-07-29T15:30:00Z"),
        prefs: [prefs({ user_id: PARENT }), prefs({ user_id: OTHER_PARENT })],
        profiles: [profile(PARENT), profile(OTHER_PARENT)],
        subs: [sub(PARENT), sub(OTHER_PARENT)],
        events: [event],
      }),
    );
    expect(claims.map(shape)).toEqual([
      {
        userId: PARENT,
        kind: "event_reminder",
        refId: "ev-1",
        title: "Trening",
        body: "Počinje za 30 min (u 18:00).",
        status: null,
      },
      {
        userId: OTHER_PARENT,
        kind: "event_reminder",
        refId: "ev-1",
        title: "Trening",
        body: "Počinje za 30 min (u 18:00).",
        status: null,
      },
    ]);
  });

  it("never claims a slot for a member without a push subscription", () => {
    // Kid profiles have no auth.users row, so a claim for them trips the
    // notification_log user_id FK - and the batched claim upsert then voids
    // the whole tick. They must be filtered out before the claim.
    const claims = planDispatch(
      input({
        now: at("2026-07-29T15:30:00Z"),
        profiles: [profile(PARENT), profile(KID)],
        subs: [sub(PARENT)],
        events: [event],
      }),
    );
    expect(claims.map((c) => c.userId)).toEqual([PARENT]);
  });

  it("falls back to Europe/Belgrade when the member has no preferences row", () => {
    const claims = planDispatch(
      input({
        now: at("2026-07-29T15:30:00Z"),
        profiles: [profile(PARENT)],
        subs: [sub(PARENT)],
        events: [event],
      }),
    );
    expect(claims).toHaveLength(1);
  });

  it("reaches members in different timezones at different instants", () => {
    const shared = {
      prefs: [
        prefs({ user_id: PARENT, timezone: BG }),
        prefs({ user_id: OTHER_PARENT, timezone: LDN }),
      ],
      profiles: [profile(PARENT), profile(OTHER_PARENT)],
      subs: [sub(PARENT), sub(OTHER_PARENT)],
      events: [event],
    };
    expect(
      planDispatch(input({ now: at("2026-07-29T15:30:00Z"), ...shared })).map((c) => c.userId),
    ).toEqual([PARENT]);
    expect(
      planDispatch(input({ now: at("2026-07-29T16:30:00Z"), ...shared })).map((c) => c.userId),
    ).toEqual([OTHER_PARENT]);
  });

  it("skips events without a reminder or without a start time", () => {
    const claims = planDispatch(
      input({
        now: at("2026-07-29T15:30:00Z"),
        profiles: [profile(PARENT)],
        subs: [sub(PARENT)],
        events: [
          { ...event, id: "no-offset", remind_minutes_before: null },
          { ...event, id: "all-day", start_time: null },
        ],
      }),
    );
    expect(claims).toHaveLength(0);
  });

  it("ignores events outside the reminder window even though the digest loaded them", () => {
    const claims = planDispatch(
      input({
        // Belgrade local date is 2026-07-29, so 07-31 is two days out: inside
        // the bulk read window, outside the reminder window.
        now: at("2026-07-29T15:30:00Z"),
        profiles: [profile(PARENT)],
        subs: [sub(PARENT)],
        events: [{ ...event, id: "far", date: "2026-07-31" }],
      }),
    );
    expect(claims).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Payment reminders
// ---------------------------------------------------------------------------

describe("payment reminders", () => {
  const payment: PaymentRow = {
    id: "pay-1",
    family_id: FAMILY,
    name: "Infostan",
    amount: 12500,
    due_date: "2026-07-31",
    remind_days_before: 2,
  };

  it("fires at the recipient's morning time, remind_days_before the due date", () => {
    const claims = planDispatch(
      input({
        // 05:30 UTC = 07:30 Belgrade, and 07-29 is 07-31 minus 2 days
        now: at("2026-07-29T05:30:00Z"),
        prefs: [prefs({ user_id: PARENT, morning_time: "07:30:00" })],
        profiles: [profile(PARENT)],
        subs: [sub(PARENT)],
        payments: [payment],
      }),
    );
    expect(claims.map(shape)).toEqual([
      {
        userId: PARENT,
        kind: "payment_reminder",
        refId: "pay-1:2026-07-31",
        title: "Infostan",
        body: "Dospeva za 2 dana: 12.500 RSD.",
        status: null,
      },
    ]);
  });

  it("defaults to 08:00 Europe/Belgrade for a member with no preferences row", () => {
    const claims = planDispatch(
      input({
        now: at("2026-07-29T06:00:00Z"),
        profiles: [profile(PARENT)],
        subs: [sub(PARENT)],
        payments: [payment],
      }),
    );
    expect(claims).toHaveLength(1);
  });

  it("words today and tomorrow specially", () => {
    const bodyFor = (remind_days_before: number, due_date: string) =>
      planDispatch(
        input({
          now: at("2026-07-29T06:00:00Z"),
          profiles: [profile(PARENT)],
          subs: [sub(PARENT)],
          payments: [{ ...payment, remind_days_before, due_date }],
        }),
      )[0]?.push?.body;

    expect(bodyFor(0, "2026-07-29")).toBe("Dospeva danas: 12.500 RSD.");
    expect(bodyFor(1, "2026-07-30")).toBe("Dospeva sutra: 12.500 RSD.");
  });

  it("never claims a slot for a member without a push subscription", () => {
    const claims = planDispatch(
      input({
        now: at("2026-07-29T06:00:00Z"),
        profiles: [profile(PARENT), profile(KID)],
        subs: [sub(PARENT)],
        payments: [payment],
      }),
    );
    expect(claims.map((c) => c.userId)).toEqual([PARENT]);
  });

  it("skips payments without a reminder offset", () => {
    const claims = planDispatch(
      input({
        now: at("2026-07-29T06:00:00Z"),
        profiles: [profile(PARENT)],
        subs: [sub(PARENT)],
        payments: [{ ...payment, remind_days_before: null, due_date: "2026-07-29" }],
      }),
    );
    expect(claims).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Activity reminders
// ---------------------------------------------------------------------------

describe("activity reminders", () => {
  // 2026-07-29 is a Wednesday -> Monday-first day_of_week 2.
  const activity: ActivityRow = {
    id: "act-1",
    family_id: FAMILY,
    name: "Trening fudbala",
    active_from: null,
    active_to: null,
    is_paused: false,
    remind_minutes_before: 30,
    created_at: "2026-01-01T00:00:00Z",
  };
  const rule: ScheduleRuleRow = {
    id: "rule-1",
    activity_id: "act-1",
    day_of_week: 2,
    start_time: "18:00:00",
    end_time: "19:00:00",
    week_pattern: "every",
    recurrence_interval_weeks: 1,
  };
  const participants: ParticipantRow[] = [{ activity_id: "act-1", person_id: KID }];
  const family = {
    prefs: [prefs({ user_id: PARENT })],
    profiles: [profile(PARENT, FAMILY, "Mama"), profile(KID, FAMILY, "Lucija")],
    subs: [sub(PARENT)],
    activities: [activity],
    schedule: [rule],
    participants,
  };

  it("names the participant when the recipient is somebody else", () => {
    const claims = planDispatch(input({ now: at("2026-07-29T15:30:00Z"), ...family }));
    expect(claims.map(shape)).toEqual([
      {
        userId: PARENT,
        kind: "activity_reminder",
        refId: "rule-1:2026-07-29:person-kid",
        title: "Lucija • Trening fudbala",
        body: "Počinje za 30 min (u 18:00).",
        status: null,
      },
    ]);
  });

  it("drops the name prefix when the recipient is the participant", () => {
    const claims = planDispatch(
      input({
        now: at("2026-07-29T15:30:00Z"),
        ...family,
        participants: [{ activity_id: "act-1", person_id: PARENT }],
      }),
    );
    expect(claims[0].push?.title).toBe("Trening fudbala");
  });

  it("never claims a slot for a member without a push subscription", () => {
    const claims = planDispatch(input({ now: at("2026-07-29T15:30:00Z"), ...family, subs: [] }));
    expect(claims).toHaveLength(0);
  });

  it("respects the active window", () => {
    expect(
      planDispatch(
        input({
          now: at("2026-07-29T15:30:00Z"),
          ...family,
          activities: [{ ...activity, active_to: "2026-07-28" }],
        }),
      ),
    ).toHaveLength(0);
    expect(
      planDispatch(
        input({
          now: at("2026-07-29T15:30:00Z"),
          ...family,
          activities: [{ ...activity, active_from: "2026-07-30" }],
        }),
      ),
    ).toHaveLength(0);
  });

  it("honours every-N-weeks intervals from the activity anchor", () => {
    const fortnightly = {
      ...family,
      activities: [{ ...activity, active_from: "2026-07-15" }], // Wednesday
      schedule: [{ ...rule, recurrence_interval_weeks: 2 }],
    };
    // 2026-07-29 is two weeks after the 07-15 anchor -> fires.
    expect(planDispatch(input({ now: at("2026-07-29T15:30:00Z"), ...fortnightly }))).toHaveLength(
      1,
    );
    // 2026-07-22 is one week after -> silent.
    expect(planDispatch(input({ now: at("2026-07-22T15:30:00Z"), ...fortnightly }))).toHaveLength(
      0,
    );
  });

  it("matches A/B week patterns against the person's shift anchor", () => {
    const anchors: ShiftAnchorRow[] = [
      {
        person_id: KID,
        anchor_week_start: "2026-07-27", // Monday of the current week
        anchor_shift: "morning",
        flip_interval_weeks: 1,
        is_alternating: true,
      },
    ];
    expect(
      planDispatch(
        input({
          now: at("2026-07-29T15:30:00Z"),
          ...family,
          schedule: [{ ...rule, week_pattern: "A" }],
          anchors,
        }),
      ),
    ).toHaveLength(1);
    expect(
      planDispatch(
        input({
          now: at("2026-07-29T15:30:00Z"),
          ...family,
          schedule: [{ ...rule, week_pattern: "B" }],
          anchors,
        }),
      ),
    ).toHaveLength(0);
  });

  it("skips a canceled occurrence", () => {
    const overrides: ActivityOverrideRow[] = [
      {
        id: "ov-1",
        schedule_id: "rule-1",
        person_id: KID,
        date: "2026-07-29",
        action: "cancel",
        override_start_time: null,
        override_end_time: null,
        override_date: null,
      },
    ];
    expect(
      planDispatch(input({ now: at("2026-07-29T15:30:00Z"), ...family, overrides })),
    ).toHaveLength(0);
  });

  it("uses the rescheduled start time on the same day", () => {
    const overrides: ActivityOverrideRow[] = [
      {
        id: "ov-1",
        schedule_id: "rule-1",
        person_id: KID,
        date: "2026-07-29",
        action: "reschedule",
        override_start_time: "19:00:00",
        override_end_time: "20:00:00",
        override_date: null,
      },
    ];
    // Old time is silent...
    expect(
      planDispatch(input({ now: at("2026-07-29T15:30:00Z"), ...family, overrides })),
    ).toHaveLength(0);
    // ...the new one fires (16:30 UTC = 18:30 Belgrade = 19:00 minus 30).
    const moved = planDispatch(input({ now: at("2026-07-29T16:30:00Z"), ...family, overrides }));
    expect(moved[0]?.push?.body).toBe("Počinje za 30 min (u 19:00).");
  });

  it("fires an occurrence moved onto today from another day", () => {
    const overrides: ActivityOverrideRow[] = [
      {
        id: "ov-1",
        schedule_id: "rule-1",
        person_id: KID,
        date: "2026-07-22",
        action: "reschedule",
        override_start_time: "17:00:00",
        override_end_time: "18:00:00",
        override_date: "2026-07-29",
      },
    ];
    // 14:30 UTC = 16:30 Belgrade = 17:00 minus 30.
    const claims = planDispatch(input({ now: at("2026-07-29T14:30:00Z"), ...family, overrides }));
    expect(claims.map(shape)).toEqual([
      {
        userId: PARENT,
        kind: "activity_reminder",
        refId: "rule-1:2026-07-29:person-kid",
        title: "Lucija • Trening fudbala",
        body: "Počinje za 30 min (u 17:00).",
        status: null,
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// External (mirrored Google) reminders
// ---------------------------------------------------------------------------

describe("external reminders", () => {
  const local: ExternalLocalRow = {
    family_id: FAMILY,
    ical_uid: "uid-1",
    remind_minutes_before: 15,
  };
  const mirrored: ExternalEventRow = {
    id: "x-1",
    family_id: FAMILY,
    title: "Zubar",
    local_date: "2026-07-29",
    start_time: "09:00:00",
    ical_uid: "uid-1",
  };

  it("keys the claim on ical_uid and local date, not the mirrored row id", () => {
    // 06:45 UTC = 08:45 Belgrade = 09:00 minus 15.
    const claims = planDispatch(
      input({
        now: at("2026-07-29T06:45:00Z"),
        profiles: [profile(PARENT)],
        subs: [sub(PARENT)],
        externalLocals: [local],
        externalEvents: [mirrored],
      }),
    );
    expect(claims.map(shape)).toEqual([
      {
        userId: PARENT,
        kind: "external_reminder",
        refId: "uid-1:2026-07-29",
        title: "Zubar",
        body: "Počinje za 15 min (u 09:00).",
        status: null,
      },
    ]);
  });

  it("falls back to a generic title and ignores uids from other families", () => {
    const claims = planDispatch(
      input({
        now: at("2026-07-29T06:45:00Z"),
        profiles: [profile(PARENT)],
        subs: [sub(PARENT)],
        externalLocals: [local],
        externalEvents: [
          { ...mirrored, title: null },
          { ...mirrored, id: "x-2", family_id: OTHER_FAMILY },
        ],
      }),
    );
    expect(claims).toHaveLength(1);
    expect(claims[0].push?.title).toBe("Google događaj");
  });

  it("never claims a slot for a member without a push subscription", () => {
    const claims = planDispatch(
      input({
        now: at("2026-07-29T06:45:00Z"),
        profiles: [profile(PARENT), profile(KID)],
        subs: [sub(PARENT)],
        externalLocals: [local],
        externalEvents: [mirrored],
      }),
    );
    expect(claims.map((c) => c.userId)).toEqual([PARENT]);
  });
});
