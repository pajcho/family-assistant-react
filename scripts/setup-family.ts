import { createInterface, type Interface } from "readline";

import { createClient } from "@supabase/supabase-js";

/**
 * Family Assistant – setup family and two users.
 * Run: pnpm run setup-family (uses .env) or pnpm run setup-family:local (uses .env.local).
 * Both scripts use `tsx --env-file=...` to load SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY into
 * process.env before this file executes.
 */

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error(
    "Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Set them in .env or environment.",
  );
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false } });

function ask(readInterface: Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    readInterface.question(prompt, (answer) => resolve((answer ?? "").trim()));
  });
}

async function main(): Promise<void> {
  const readInterface = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("Porodični asistent – kreiranje porodice i korisnika\n");

  const familyName = await ask(readInterface, "Naziv porodice: ");
  if (!familyName) {
    console.error("Naziv porodice je obavezan.");
    readInterface.close();
    process.exit(1);
  }

  const email1 = await ask(readInterface, "Email korisnika 1: ");
  const password1 = await ask(readInterface, "Lozinka korisnika 1: ");
  const email2 = await ask(readInterface, "Email korisnika 2: ");
  const password2 = await ask(readInterface, "Lozinka korisnika 2: ");

  readInterface.close();

  if (!email1 || !password1) {
    console.error("Sva polja (email i lozinka za prvog korisnika) su obavezna.");
    process.exit(1);
  }

  console.log("\nKreiranje porodice...");
  const { data: family, error: familyErr } = await supabase
    .from("families")
    .insert({ name: familyName })
    .select("id")
    .single();

  if (familyErr || !family) {
    console.error("Greška pri kreiranju porodice:", familyErr?.message ?? "Nepoznata greška");
    process.exit(1);
  }
  const familyId = family.id as string;
  console.log("Porodica kreirana, ID:", familyId);

  const userIds: string[] = [];

  for (const [email, password] of [
    [email1, password1],
    [email2, password2],
  ] as [string, string][]) {
    if (!email) continue;

    console.log(`Kreiranje korisnika ${email}...`);
    const { data: user, error: userErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (userErr || !user?.user) {
      console.error(`Greška pri kreiranju korisnika ${email}:`, userErr?.message ?? "Nepoznata");
      process.exit(1);
    }
    userIds.push(user.user.id);
    console.log(`Korisnik kreiran, ID: ${user.user.id}`);
  }

  console.log("Povezivanje profila sa porodicom...");
  for (const userId of userIds) {
    // Both seed users are family admins so a fresh family can manage its
    // roster / logins from the Porodica settings tab out of the box.
    const { error: profileErr } = await supabase.from("profiles").insert({
      id: userId,
      family_id: familyId,
      is_admin: true,
    });
    if (profileErr) {
      console.error("Greška pri kreiranju profila:", profileErr.message);
      process.exit(1);
    }
  }
  console.log("Profili kreirani.\n");

  console.log("=== Završeno ===");
  console.log("Porodica ID:", familyId);
  console.log("Korisnik 1 ID:", userIds[0]);
  if (userIds.length >= 2) {
    console.log("Korisnik 2 ID:", userIds[1]);
  }
  console.log("\nKorisnici mogu da se prijave na aplikaciju sa unetim email-om i lozinkom.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
