/**
 * Seeds a self-contained DEMO family into local Supabase, alongside the real one.
 * Fictional people, realistic data - safe to screenshot for a public README.
 *
 * Run:  pnpm exec tsx --env-file=.env.local scripts/seed-demo.ts
 * Login: demo@porodica.test / demo1234 (local Supabase only)
 *
 * Idempotent: drops and recreates the "Petrović (demo)" family on every run,
 * leaving every other family in the database untouched. Refuses to run against
 * anything but a local Supabase. Dates are relative to today, so the screens
 * are never empty no matter when it runs - this is what the README
 * screenshots were captured against.
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !serviceRoleKey) throw new Error("Missing SUPABASE_URL / SERVICE_ROLE_KEY");
if (!url.includes("127.0.0.1") && !url.includes("localhost")) {
  throw new Error(`Refusing to seed a non-local Supabase: ${url}`);
}

const db = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false } });

const FAMILY_NAME = "Petrović (demo)";
const LOGINS = [
  {
    email: "demo@porodica.test",
    password: "demo1234",
    first: "Milan",
    last: "Petrović",
    color: "#10b981",
  },
  {
    email: "jelena@porodica.test",
    password: "demo1234",
    first: "Jelena",
    last: "Petrović",
    color: "#f59e0b",
  },
];

// ---- date helpers (everything is relative to today so screens are never stale)
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);
// Local calendar date - `toISOString()` would shift back a day east of UTC.
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const day = (offset: number) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + offset);
  return iso(d);
};
const monthKey = (offset = 0) => {
  const d = new Date(TODAY.getFullYear(), TODAY.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const dayOfMonth = (n: number) => {
  const d = new Date(TODAY.getFullYear(), TODAY.getMonth(), n);
  return iso(d);
};

async function wipeExisting() {
  const { data: old } = await db.from("families").select("id").eq("name", FAMILY_NAME);
  for (const f of old ?? []) {
    // profiles of login users are also auth.users - delete those first
    const { data: profs } = await db.from("profiles").select("id").eq("family_id", f.id);
    await db.from("families").delete().eq("id", f.id); // cascades everything
    for (const p of profs ?? []) {
      await db.auth.admin.deleteUser(p.id).catch(() => {});
    }
    console.log("Obrisana stara demo porodica", f.id);
  }
}

async function main() {
  await wipeExisting();

  const { data: family, error: famErr } = await db
    .from("families")
    .insert({ name: FAMILY_NAME })
    .select("id")
    .single();
  if (famErr || !family) throw famErr ?? new Error("no family");
  const fid = family.id as string;
  console.log("Porodica:", fid);

  // ---- people ---------------------------------------------------------------
  const people: Record<string, string> = {};
  for (const [i, l] of LOGINS.entries()) {
    const { data: u, error } = await db.auth.admin.createUser({
      email: l.email,
      password: l.password,
      email_confirm: true,
    });
    if (error || !u.user) throw error ?? new Error("no user");
    const { error: pErr } = await db.from("profiles").insert({
      id: u.user.id,
      family_id: fid,
      first_name: l.first,
      last_name: l.last,
      color: l.color,
      is_admin: i === 0,
    });
    if (pErr) throw pErr;
    people[l.first] = u.user.id;
  }

  for (const kid of [
    { first: "Ana", last: "Petrović", color: "#ec4899" },
    { first: "Vuk", last: "Petrović", color: "#3b82f6" },
  ]) {
    const { data, error } = await db
      .from("profiles")
      .insert({
        family_id: fid,
        first_name: kid.first,
        last_name: kid.last,
        color: kid.color,
      })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("no kid");
    people[kid.first] = data.id as string;
  }
  console.log("Članovi:", Object.keys(people).join(", "));

  // ---- expense categories ---------------------------------------------------
  const cats: Record<string, string> = {};
  const catRows = [
    { name: "Režije", color: "#3b82f6", icon: "bolt", sort_order: 1, monthly_limit: 28000 },
    { name: "Namirnice", color: "#22c55e", icon: "cart", sort_order: 2, monthly_limit: 45000 },
    {
      name: "Deca i aktivnosti",
      color: "#a855f7",
      icon: "academic",
      sort_order: 3,
      monthly_limit: 20000,
    },
    { name: "Prevoz", color: "#f59e0b", icon: "truck", sort_order: 4, monthly_limit: 12000 },
    { name: "Zdravlje", color: "#ef4444", icon: "heart", sort_order: 5, monthly_limit: null },
    { name: "Izlasci", color: "#ec4899", icon: "ticket", sort_order: 6, monthly_limit: 10000 },
    { name: "Ostalo", color: "#6b7280", icon: "tag", sort_order: 7, monthly_limit: null },
  ];
  for (const c of catRows) {
    const { data, error } = await db
      .from("expense_categories")
      .insert({ family_id: fid, ...c })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("no cat");
    cats[c.name] = data.id as string;
  }

  // ---- activities (+ schedule + participants) --------------------------------
  // `day_of_week` is 0=Monday .. 6=Sunday (see src/utils/activity.ts).
  const acts: Record<string, string> = {};
  const activities = [
    {
      name: "Engleski",
      description: "Škola stranih jezika Lingua",
      who: ["Ana"],
      remind: 30,
      slots: [
        { day_of_week: 0, start_time: "17:00", end_time: "18:00" },
        { day_of_week: 2, start_time: "17:00", end_time: "18:00" },
      ],
    },
    {
      name: "Fudbal - trening",
      description: "FK Radnički, teren kod škole",
      who: ["Vuk"],
      remind: 60,
      slots: [
        { day_of_week: 1, start_time: "18:00", end_time: "19:30" },
        { day_of_week: 3, start_time: "18:00", end_time: "19:30" },
      ],
    },
    {
      name: "Klavir",
      description: "Muzička škola, sala 3",
      who: ["Ana"],
      remind: 30,
      slots: [{ day_of_week: 4, start_time: "16:00", end_time: "17:00" }],
    },
    {
      name: "Plivanje",
      description: "Bazen Olimp",
      who: ["Vuk", "Ana"],
      remind: null,
      slots: [{ day_of_week: 5, start_time: "10:00", end_time: "11:00" }],
    },
    {
      name: "Teretana",
      description: null,
      who: ["Milan"],
      remind: null,
      slots: [
        { day_of_week: 0, start_time: "07:00", end_time: "08:00" },
        { day_of_week: 2, start_time: "07:00", end_time: "08:00" },
        { day_of_week: 4, start_time: "07:00", end_time: "08:00" },
      ],
    },
    {
      name: "Joga",
      description: "Studio Vita, mala sala",
      who: ["Jelena"],
      remind: 30,
      slots: [{ day_of_week: 3, start_time: "20:00", end_time: "21:00" }],
    },
  ];
  for (const a of activities) {
    const { data, error } = await db
      .from("activities")
      .insert({
        family_id: fid,
        name: a.name,
        description: a.description,
        remind_minutes_before: a.remind,
      })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("no activity");
    const aid = data.id as string;
    acts[a.name] = aid;
    await db
      .from("activity_schedule")
      .insert(a.slots.map((s) => ({ activity_id: aid, family_id: fid, ...s })));
    await db
      .from("activity_participants")
      .insert(a.who.map((w) => ({ activity_id: aid, person_id: people[w], family_id: fid })));
  }

  // ---- events ---------------------------------------------------------------
  const events = [
    {
      name: "Kontrolni iz matematike",
      description: "Ponoviti razlomke uveče",
      date: day(0),
      start_time: "08:00",
      end_time: null,
      who: ["Ana"],
      remind_minutes_before: null,
    },
    {
      name: "Roditeljski sastanak",
      description: "Učionica 12, 5. razred",
      date: day(0),
      start_time: "18:00",
      end_time: "19:00",
      who: ["Jelena"],
      remind_minutes_before: 60,
    },
    {
      name: "Zubar - Vuk",
      description: "Redovna kontrola",
      date: day(2),
      start_time: "09:30",
      end_time: "10:00",
      who: ["Vuk", "Milan"],
      remind_minutes_before: 120,
    },
    {
      name: "Ročište za registraciju auta",
      description: null,
      date: day(5),
      start_time: "11:00",
      end_time: null,
      who: ["Milan"],
      remind_minutes_before: null,
    },
    {
      name: "Slava - kod Mirjane",
      description: "Nosimo kolač i vino",
      date: day(9),
      start_time: "18:00",
      end_time: null,
      who: ["Milan", "Jelena", "Ana", "Vuk"],
      remind_minutes_before: 1440,
    },
    {
      name: "Polazak na more",
      description: "Trajekt u 06:00, pakovanje veče pre",
      date: day(21),
      start_time: "06:00",
      end_time: null,
      who: ["Milan", "Jelena", "Ana", "Vuk"],
      remind_minutes_before: 1440,
    },
  ];
  const evIds: Record<string, string> = {};
  for (const e of events) {
    const { who, ...row } = e;
    const { data, error } = await db
      .from("events")
      .insert({ family_id: fid, ...row })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("no event");
    evIds[e.name] = data.id as string;
    await db
      .from("event_participants")
      .insert(who.map((w) => ({ event_id: data.id, person_id: people[w], family_id: fid })));
  }

  // ---- birthdays ------------------------------------------------------------
  const bdays = [
    { name: "Baba Mira", birth_date: "1955-08-04", description: "Mamina mama" },
    { name: "Deda Rade", birth_date: "1952-11-19", description: null },
    { name: "Luka (Vukov drug)", birth_date: "2017-07-29", description: "Rođendan u igraonici" },
    { name: "Teta Sanja", birth_date: "1984-03-12", description: null },
  ];
  const bdayIds: Record<string, string> = {};
  for (const b of bdays) {
    const { data, error } = await db
      .from("birthdays")
      .insert({ family_id: fid, ...b })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("no birthday");
    bdayIds[b.name] = data.id as string;
  }

  // ---- payments -------------------------------------------------------------
  const payments = [
    {
      name: "Struja",
      amount: 8400,
      due_date: dayOfMonth(15),
      is_recurring: true,
      recurrence_period: "monthly",
      category_id: cats["Režije"],
      is_paid: true,
      paid_date: new Date().toISOString(),
      is_variable_amount: true,
      who: [] as string[],
    },
    {
      name: "Internet i TV",
      amount: 3600,
      due_date: dayOfMonth(8),
      is_recurring: true,
      recurrence_period: "monthly",
      category_id: cats["Režije"],
      is_paid: true,
      paid_date: new Date().toISOString(),
      who: [],
    },
    {
      name: "Infostan",
      amount: 11200,
      due_date: day(-4),
      is_recurring: true,
      recurrence_period: "monthly",
      category_id: cats["Režije"],
      remind_days_before: 3,
      who: [],
    },
    {
      name: "Engleski - Ana",
      amount: 6500,
      due_date: day(0),
      is_recurring: true,
      recurrence_period: "monthly",
      category_id: cats["Deca i aktivnosti"],
      activity_id: acts["Engleski"],
      remind_days_before: 2,
      who: ["Ana"],
    },
    {
      name: "Klub - članarina Vuk",
      amount: 3000,
      due_date: day(3),
      is_recurring: true,
      recurrence_period: "monthly",
      category_id: cats["Deca i aktivnosti"],
      activity_id: acts["Fudbal - trening"],
      who: ["Vuk"],
    },
    {
      name: "Muzička škola",
      amount: 4200,
      due_date: day(6),
      is_recurring: true,
      recurrence_period: "monthly",
      category_id: cats["Deca i aktivnosti"],
      activity_id: acts["Klavir"],
      who: ["Ana"],
    },
    {
      name: "Rata za kredit",
      amount: 32000,
      due_date: dayOfMonth(5),
      is_recurring: true,
      recurrence_period: "monthly",
      category_id: cats["Ostalo"],
      is_paid: true,
      paid_date: new Date().toISOString(),
      who: [],
    },
    {
      name: "Poklon za Luku",
      amount: 2500,
      due_date: day(6),
      is_recurring: false,
      recurrence_period: "one-time",
      category_id: cats["Izlasci"],
      birthday_id: bdayIds["Luka (Vukov drug)"],
      who: [],
    },
    {
      name: "Apartman - druga rata",
      amount: 35208,
      currency: "EUR",
      original_amount: 300,
      exchange_rate: 117.36,
      due_date: day(11),
      is_recurring: false,
      recurrence_period: "one-time",
      category_id: cats["Ostalo"],
      event_id: evIds["Polazak na more"],
      who: [],
    },
    {
      name: "Registracija auta",
      amount: 24500,
      due_date: day(-9),
      is_recurring: false,
      recurrence_period: "one-time",
      category_id: cats["Prevoz"],
      who: ["Milan"],
    },
  ];
  for (const p of payments) {
    const { who, ...row } = p;
    const { data, error } = await db
      .from("payments")
      .insert({ family_id: fid, ...row })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error(`no payment ${p.name}`);
    if (who.length) {
      await db
        .from("payment_participants")
        .insert(who.map((w) => ({ payment_id: data.id, person_id: people[w], family_id: fid })));
    }
  }

  // ---- incomes + this month's entries ---------------------------------------
  const incomes = [
    { name: "Plata Milan", amount: 145000, day_of_month: 10, person: "Milan" },
    { name: "Plata Jelena", amount: 118000, day_of_month: 12, person: "Jelena" },
    { name: "Dečji dodatak", amount: 9600, day_of_month: 20, person: null },
  ];
  for (const inc of incomes) {
    const { person, ...row } = inc;
    const { data, error } = await db
      .from("incomes")
      .insert({ family_id: fid, person_id: person ? people[person] : null, ...row })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("no income");
    await db.from("income_entries").insert({
      family_id: fid,
      income_id: data.id,
      person_id: person ? people[person] : null,
      name: inc.name,
      amount: inc.amount,
      month: monthKey(),
      received_on: dayOfMonth(inc.day_of_month),
    });
  }

  // ---- expenses (this month, spread across categories) -----------------------
  const expenses = [
    { amount: 6820, cat: "Namirnice", merchant: "Maxi", d: -1, person: "Jelena" },
    { amount: 2340, cat: "Namirnice", merchant: "Lidl", d: -3, person: "Milan" },
    { amount: 9150, cat: "Namirnice", merchant: "Univerexport", d: -6, person: "Jelena" },
    { amount: 4400, cat: "Namirnice", merchant: "Pijaca", d: -8, person: "Milan" },
    { amount: 3120, cat: "Namirnice", merchant: "Maxi", d: -12, person: "Jelena" },
    { amount: 5600, cat: "Prevoz", merchant: "NIS Petrol", d: -2, person: "Milan" },
    { amount: 6100, cat: "Prevoz", merchant: "MOL", d: -10, person: "Milan" },
    { amount: 1800, cat: "Zdravlje", merchant: "Apoteka Janković", d: -4, person: "Jelena" },
    {
      amount: 3400,
      cat: "Izlasci",
      merchant: "Bioskop Cineplexx",
      d: -5,
      person: null,
      note: "Bioskop sa decom",
    },
    { amount: 2200, cat: "Izlasci", merchant: "Picerija Đuro", d: -13, person: null },
    {
      amount: 1450,
      cat: "Deca i aktivnosti",
      merchant: "Knjižara Delfi",
      d: -7,
      person: "Ana",
      note: "Sveske i pribor",
    },
    {
      amount: 8900,
      cat: "Deca i aktivnosti",
      merchant: "Sport Vision",
      d: -11,
      person: "Vuk",
      note: "Kopačke",
    },
    { amount: 2700, cat: "Ostalo", merchant: null, d: -9, person: null, note: "Frizer" },
  ];
  for (const e of expenses) {
    const { error } = await db.from("expenses").insert({
      family_id: fid,
      amount: e.amount,
      spent_on: day(e.d),
      category_id: cats[e.cat],
      person_id: e.person ? people[e.person] : null,
      merchant: e.merchant,
      note: e.note ?? null,
      source: "manual",
    });
    if (error) throw error;
  }

  // ---- lists ----------------------------------------------------------------
  const lists = [
    {
      name: "Kupovina",
      description: "Nedeljna velika kupovina",
      smart_sort_enabled: true,
      items: [
        ["Mleko 2.8%", true],
        ["Hleb (integralni)", true],
        ["Jaja 10 kom", false],
        ["Kafa", false],
        ["Deterdžent za veš", false],
        ["Banane", false],
        ["Piletina 1kg", false],
        ["Jogurt", true],
      ] as [string, boolean][],
    },
    {
      name: "Za školu",
      description: null,
      smart_sort_enabled: false,
      items: [
        ["Sveske na kvadratiće (5)", true],
        ["Geometrijski pribor", false],
        ["Patike za fizičko", false],
        ["Potpisati dnevnik", false],
      ] as [string, boolean][],
    },
    {
      name: "Pakovanje za more",
      description: "Sve što ide u kofer",
      smart_sort_enabled: false,
      items: [
        ["Pasoši i zdravstvene", false],
        ["Krema za sunčanje", false],
        ["Punjači i adapteri", false],
        ["Lekovi - kutija", false],
        ["Peškiri za plažu", false],
      ] as [string, boolean][],
    },
    {
      name: "Kuća - popravke",
      description: null,
      smart_sort_enabled: false,
      items: [
        ["Zameniti sijalicu u hodniku", true],
        ["Servis bojlera", false],
        ["Zategnuti slavinu u kupatilu", false],
      ] as [string, boolean][],
    },
  ];
  for (const [i, l] of lists.entries()) {
    const { data, error } = await db
      .from("lists")
      .insert({
        family_id: fid,
        owner_id: people["Milan"],
        name: l.name,
        description: l.description,
        scope: "family",
        sort_order: i,
        smart_sort_enabled: l.smart_sort_enabled,
      })
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error("no list");
    await db.from("list_items").insert(
      l.items.map(([name, done], idx) => ({
        list_id: data.id,
        family_id: fid,
        name,
        is_completed: done,
        completed_at: done ? new Date().toISOString() : null,
        sort_order: idx,
        created_by_id: people["Milan"],
      })),
    );
  }

  // ---- school: bells, shifts, timetable --------------------------------------
  await db.from("bell_schedules").insert({ family_id: fid });

  const monday = new Date(TODAY);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  await db.from("school_shift_anchors").insert([
    {
      person_id: people["Ana"],
      family_id: fid,
      anchor_week_start: iso(monday),
      anchor_shift: "morning",
      is_alternating: true,
      flip_interval_weeks: 1,
    },
    {
      person_id: people["Vuk"],
      family_id: fid,
      anchor_week_start: iso(monday),
      anchor_shift: "afternoon",
      is_alternating: true,
      flip_interval_weeks: 1,
    },
  ]);

  // Monday .. Friday, again 0=Monday.
  const anaTimetable: Record<number, string[]> = {
    0: ["Srpski", "Matematika", "Engleski", "Biologija", "Fizičko"],
    1: ["Matematika", "Istorija", "Srpski", "Likovno", "Geografija"],
    2: ["Engleski", "Matematika", "Hemija", "Srpski", "Muzičko"],
    3: ["Fizika", "Matematika", "Srpski", "Engleski", "Tehnika"],
    4: ["Geografija", "Biologija", "Matematika", "Fizičko", "Srpski"],
  };
  const rows: {
    family_id: string;
    person_id: string;
    variant: "A" | "B";
    day_of_week: number;
    period_index: number;
    subject: string;
    room: string;
  }[] = [];
  for (const variant of ["A", "B"] as const) {
    for (const [dow, subjects] of Object.entries(anaTimetable)) {
      subjects.forEach((subject, i) => {
        rows.push({
          family_id: fid,
          person_id: people["Ana"],
          variant,
          day_of_week: Number(dow),
          period_index: i + 1,
          subject,
          room: `${10 + i}`,
        });
      });
    }
  }
  await db.from("school_timetable_entries").insert(rows);

  console.log("\n=== Demo porodica spremna ===");
  console.log("Prijava:", LOGINS[0].email, "/", LOGINS[0].password);
  console.log("Family ID:", fid);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
