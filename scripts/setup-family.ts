import { createInterface, type Interface } from "node:readline";

import { createClient } from "@supabase/supabase-js";

/**
 * Family Assistant - setup family and two users.
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

  console.log("Family Assistant - create a family and its users\n");

  const familyName = await ask(readInterface, "Family name: ");
  if (!familyName) {
    console.error("The family name is required.");
    readInterface.close();
    process.exit(1);
  }

  const email1 = await ask(readInterface, "Email of user 1: ");
  const password1 = await ask(readInterface, "Password of user 1: ");
  const email2 = await ask(readInterface, "Email of user 2: ");
  const password2 = await ask(readInterface, "Password of user 2: ");

  readInterface.close();

  if (!email1 || !password1) {
    console.error("Every field (email and password for the first user) is required.");
    process.exit(1);
  }

  console.log("\nCreating the family...");
  const { data: family, error: familyErr } = await supabase
    .from("families")
    .insert({ name: familyName })
    .select("id")
    .single();

  if (familyErr || !family) {
    console.error("Failed to create the family:", familyErr?.message ?? "Unknown error");
    process.exit(1);
  }
  const familyId = family.id as string;
  console.log("Family created, id:", familyId);

  const userIds: string[] = [];

  for (const [email, password] of [
    [email1, password1],
    [email2, password2],
  ] as [string, string][]) {
    if (!email) continue;

    console.log(`Creating user ${email}...`);
    const { data: user, error: userErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (userErr || !user?.user) {
      console.error(`Failed to create user ${email}:`, userErr?.message ?? "Unknown error");
      process.exit(1);
    }
    userIds.push(user.user.id);
    console.log(`User created, id: ${user.user.id}`);
  }

  console.log("Linking the profiles to the family...");
  for (const userId of userIds) {
    // Both seed users are family admins so a fresh family can manage its
    // roster / logins from the Porodica settings tab out of the box.
    const { error: profileErr } = await supabase.from("profiles").insert({
      id: userId,
      family_id: familyId,
      is_admin: true,
    });
    if (profileErr) {
      console.error("Failed to create the profile:", profileErr.message);
      process.exit(1);
    }
  }
  console.log("Profiles created.\n");

  console.log("=== Done ===");
  console.log("Family id:", familyId);
  console.log("User 1 id:", userIds[0]);
  if (userIds.length >= 2) {
    console.log("User 2 id:", userIds[1]);
  }
  console.log("\nThe users can now sign in with the email and password entered above.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
