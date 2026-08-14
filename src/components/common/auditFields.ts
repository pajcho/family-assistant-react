import { formatDate } from "@/utils/date";
import { normalizeTime } from "@/utils/activity";
import { serbianPlural } from "@/utils/plural";

/**
 * Turns `{"category_id": ["a3f...", "9b1..."]}` into
 * `Kategorija: Ostalo -> Režije`.
 *
 * This registry is the whole difference between a change log and a dump of the
 * audit table. The trigger stores raw column values because that is the only
 * thing a generic trigger CAN store; every bit of meaning - what the column is
 * called in Serbian, whether the number is money or minutes, which UUID names a
 * person and which names a category - lives here.
 *
 * Anything not listed is simply not rendered, which is the same rule the
 * database applies: `audit_columns()` in 20260814150000_audit_log.sql decides
 * what gets recorded, and this decides what gets shown. The two lists should
 * agree; if this one is missing an entry the row is skipped rather than printed
 * as a raw column name.
 */

/** Looks up the names only the client has: members, categories, lists. */
export type AuditResolvers = {
  member: (id: string) => string | null;
  category: (id: string) => string | null;
  list: (id: string) => string | null;
};

/**
 * How one column's value is read out. Returns null when there is nothing to
 * show (an empty note, a cleared date), which the renderer prints as a dash
 * rather than as "null".
 */
type Formatter = (value: unknown, resolvers: AuditResolvers) => string | null;

export type AuditFieldSpec = { label: string; format: Formatter };

const text: Formatter = (v) => {
  if (typeof v !== "string" || v.trim() === "") return null;
  // Long notes make the diff unreadable and the useful part is the head of it.
  return v.length > 60 ? `${v.slice(0, 60)}…` : v;
};

const money: Formatter = (v) => {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || Number.isNaN(n)) return null;
  return `${n.toLocaleString("sr-Latn-RS")} RSD`;
};

const date: Formatter = (v) => (typeof v === "string" && v ? formatDate(v) : null);

const time: Formatter = (v) => (typeof v === "string" && v ? normalizeTime(v) : null);

/** A timestamp column used as a flag (`canceled_at`): when, or "ne". */
const timestampFlag: Formatter = (v) =>
  typeof v === "string" && v ? formatDate(v.slice(0, 10)) : "ne";

const bool: Formatter = (v) => (v === true ? "da" : v === false ? "ne" : null);

const number: Formatter = (v) => (typeof v === "number" ? String(v) : null);

const member: Formatter = (v, r) => (typeof v === "string" && v ? r.member(v) : null);
const category: Formatter = (v, r) => (typeof v === "string" && v ? r.category(v) : null);
const list: Formatter = (v, r) => (typeof v === "string" && v ? r.list(v) : null);

/** "2 dana ranije" / "30 minuta ranije" / "bez podsetnika". */
function reminder(unit: "days" | "minutes"): Formatter {
  return (v) => {
    if (v == null) return "bez podsetnika";
    if (typeof v !== "number") return null;
    if (v === 0) return unit === "days" ? "na dan roka" : "u zakazano vreme";
    const noun =
      unit === "days"
        ? serbianPlural(v, { one: "dan", few: "dana", many: "dana" })
        : serbianPlural(v, { one: "minut", few: "minuta", many: "minuta" });
    return `${v} ${noun} ranije`;
  };
}

/** "svake 2 nedelje" is the caller's business; here it is just the number. */
const interval: Formatter = (v) => (typeof v === "number" ? `svaki ${v}.` : null);

/** Retention in hours, stored as a number, read as a sentence. */
const retentionHours: Formatter = (v) => {
  if (v == null) return "nikad";
  if (typeof v !== "number") return null;
  if (v % 24 === 0) {
    const d = v / 24;
    return `posle ${d} ${serbianPlural(d, { one: "dan", few: "dana", many: "dana" })}`;
  }
  return `posle ${v} ${serbianPlural(v, { one: "sat", few: "sata", many: "sati" })}`;
};

function enumOf(map: Record<string, string>): Formatter {
  return (v) => (typeof v === "string" ? (map[v] ?? v) : null);
}

const PAYMENT_RECURRENCE = enumOf({
  monthly: "mesečno",
  weekly: "nedeljno",
  limited: "na rate",
  "one-time": "jednokratno",
});

const TASK_RECURRENCE = enumOf({
  "one-time": "jednokratno",
  daily: "dnevno",
  weekly: "nedeljno",
  monthly: "mesečno",
});

const COMPLETION_MODE = enumOf({ shared: "zajednički", per_assignee: "svako za sebe" });

const SCOPE = enumOf({ personal: "lična", family: "porodična" });

const f = (label: string, format: Formatter): AuditFieldSpec => ({ label, format });

/**
 * Keyed by TABLE NAME, matching `audit_log.entity_type` and what the realtime
 * trigger sends - one vocabulary for "which table", not two.
 */
export const AUDIT_FIELDS: Record<string, Record<string, AuditFieldSpec>> = {
  payments: {
    name: f("Naziv", text),
    description: f("Opis", text),
    amount: f("Iznos", money),
    currency: f("Valuta", text),
    due_date: f("Dospeva", date),
    category_id: f("Kategorija", category),
    is_paid: f("Plaćeno", bool),
    is_paused: f("Pauzirano", bool),
    is_recurring: f("Ponavlja se", bool),
    recurrence_period: f("Ponavljanje", PAYMENT_RECURRENCE),
    recurrence_interval: f("Razmak", interval),
    remind_days_before: f("Podsetnik", reminder("days")),
  },
  events: {
    name: f("Naziv", text),
    description: f("Opis", text),
    notes: f("Beleška", text),
    date: f("Datum", date),
    end_date: f("Završava se", date),
    start_time: f("Počinje", time),
    end_time: f("Završava", time),
    canceled_at: f("Otkazano", timestampFlag),
    cancel_reason: f("Razlog otkazivanja", text),
    remind_minutes_before: f("Podsetnik", reminder("minutes")),
  },
  expenses: {
    amount: f("Iznos", money),
    currency: f("Valuta", text),
    spent_on: f("Datum", date),
    category_id: f("Kategorija", category),
    person_id: f("Za koga", member),
    note: f("Beleška", text),
    merchant: f("Prodavac", text),
  },
  activities: {
    name: f("Naziv", text),
    description: f("Opis", text),
    notes: f("Beleška", text),
    active_from: f("Počinje", date),
    active_to: f("Završava se", date),
    is_paused: f("Pauzirano", bool),
    remind_minutes_before: f("Podsetnik", reminder("minutes")),
  },
  birthdays: {
    name: f("Ime", text),
    description: f("Opis", text),
    birth_date: f("Datum rođenja", date),
  },
  incomes: {
    name: f("Naziv", text),
    amount: f("Iznos", money),
    person_id: f("Za koga", member),
    day_of_month: f("Dan u mesecu", number),
    is_recurring: f("Ponavlja se", bool),
    active: f("Aktivno", bool),
  },
  income_entries: {
    name: f("Naziv", text),
    amount: f("Iznos", money),
    month: f("Mesec", text),
    received_on: f("Primljeno", date),
    person_id: f("Za koga", member),
    note: f("Beleška", text),
    is_one_time: f("Jednokratno", bool),
  },
  tasks: {
    name: f("Naziv", text),
    description: f("Opis", text),
    due_date: f("Rok", date),
    due_time: f("Vreme", time),
    list_id: f("Lista", list),
    recurrence_period: f("Ponavljanje", TASK_RECURRENCE),
    recurrence_interval: f("Razmak", interval),
    recurrence_until: f("Ponavlja do", date),
    completion_mode: f("Način završetka", COMPLETION_MODE),
    remind_minutes_before: f("Podsetnik", reminder("minutes")),
    remind_days_before: f("Podsetnik", reminder("days")),
  },
  lists: {
    name: f("Naziv", text),
    description: f("Opis", text),
    scope: f("Vidljivost", SCOPE),
    smart_sort_enabled: f("Pametno sortiranje", bool),
    auto_delete_completed_after_hours: f("Brisanje završenih", retentionHours),
  },
  expense_categories: {
    name: f("Naziv", text),
    color: f("Boja", text),
    icon: f("Ikonica", text),
    monthly_limit: f("Mesečni limit", money),
  },
};

export type RenderedChange = { label: string; from: string | null; to: string | null };

/**
 * One entry's `changes` object as rows a person can read, in the registry's
 * order rather than the object's - so the same edit always reads the same way
 * regardless of which column the trigger happened to serialize first.
 *
 * Columns the registry does not know are dropped. That is on purpose: a column
 * added to `audit_columns()` and forgotten here should show nothing rather than
 * a raw identifier, and the missing row is easier to notice than a wrong one.
 */
export function renderChanges(
  entityType: string,
  changes: Record<string, [unknown, unknown]> | null | undefined,
  resolvers: AuditResolvers,
): RenderedChange[] {
  if (!changes) return [];
  const specs = AUDIT_FIELDS[entityType];
  if (!specs) return [];
  const rows: RenderedChange[] = [];
  for (const [column, spec] of Object.entries(specs)) {
    const pair = changes[column];
    if (!pair) continue;
    const [before, after] = pair;
    const from = spec.format(before, resolvers);
    const to = spec.format(after, resolvers);
    // A change both ends of which we cannot render says nothing at all - a
    // category that has since been deleted, for instance. Better to omit the
    // line than to print "Kategorija: - -> -".
    if (from == null && to == null) continue;
    rows.push({ label: spec.label, from, to });
  }
  return rows;
}
