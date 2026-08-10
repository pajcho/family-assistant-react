import type { AgendaItem } from "@/hooks/useAgenda";

/**
 * Emoji resolution for the kid shell.
 *
 * The whole visual language of the prototype leans on a big glyph tile telling
 * the child WHAT something is before they read a word of it - 🎹 for klavir, ⚽
 * for trening, 🦷 for zubar. The main app uses heroicons keyed on the item
 * KIND, which would give every activity the same glyph and lose that entirely.
 *
 * So we match on the name. Purely additive: an unmatched name simply falls back
 * to its kind's glyph, so nothing ever renders blank. Pure functions, no React,
 * unit tested.
 */

/**
 * ASCII-fold + lowercase, so "Fizičko", "fizicko" and "FIZIČKO" all match the
 * same keyword. Only the five Serbian letters need folding.
 */
export function foldSr(input: string): string {
  return input
    .toLowerCase()
    .replaceAll("č", "c")
    .replaceAll("ć", "c")
    .replaceAll("š", "s")
    .replaceAll("ž", "z")
    .replaceAll("đ", "dj");
}

/**
 * Keyword → emoji, first match wins. Keywords are already folded and are
 * matched as substrings, so a stem ("plivanj") covers every inflection.
 */
type EmojiRule = readonly [readonly string[], string];

const ACTIVITY_RULES: readonly EmojiRule[] = [
  [["fudbal", "futsal"], "⚽"],
  [["kosark", "basket"], "🏀"],
  [["odbojk"], "🏐"],
  [["rukomet"], "🤾"],
  [["tenis"], "🎾"],
  [["plivanj", "bazen", "vaterpolo"], "🏊"],
  [["karate", "dzudo", "judo", "borilack", "tekvondo", "taekwondo", "boks"], "🥋"],
  [["gimnastik", "akrobat"], "🤸"],
  [["balet", "ples", "folklor"], "🩰"],
  [["klavir"], "🎹"],
  [["gitar"], "🎸"],
  [["violin"], "🎻"],
  [["flaut", "harmonik", "bubnj"], "🎶"],
  [["muzick", "muzicka skola", "hor", "pevanj", "solfedj"], "🎵"],
  [["crtanj", "slikanj", "likovn", "kreativn", "radionic"], "🎨"],
  [["glum", "pozorist", "dram", "recitator"], "🎭"],
  [["programir", "robotik", "informatik", "racunar", "kodiranj"], "💻"],
  [["sah"], "♟️"],
  [["engleski"], "🇬🇧"],
  [["nemacki"], "🇩🇪"],
  [["spanski"], "🇪🇸"],
  [["francuski"], "🇫🇷"],
  [["italijanski"], "🇮🇹"],
  [["ruski"], "🇷🇺"],
  [["zubar", "stomatolog", "ortodont"], "🦷"],
  [["doktor", "lekar", "pedijat", "pregled", "ordinacij", "ambulant", "vakcin", "kontrol"], "🩺"],
  [["frizer", "sisanj"], "💇"],
  [["rodjendan", "proslav", "zurk", "slav"], "🎉"],
  [["ekskurzij", "izlet", "putovanj", "autobus"], "🚌"],
  [["letovanj", "more", "plaz"], "🏖️"],
  [["zimovanj", "skijanj", "sneg"], "⛷️"],
  [["raspust", "odmor"], "🌴"],
  [["bioskop", "film", "predstav"], "🎬"],
  [["utakmic", "takmicenj", "turnir", "kup"], "🏆"],
  [["trening", "vezbanj", "teretan", "trcanj"], "🏃"],
  [["roditeljski", "sastanak"], "🧑‍🏫"],
  [["kupovin", "pijac", "prodavnic", "shopping"], "🛒"],
  [["knjig", "bibliotek", "citanj", "lektir"], "📖"],
  [["skol", "nastav", "cas"], "🏫"],
  [["bicikl", "roler", "trotinet"], "🚲"],
  [["muzej", "izlozb", "galerij"], "🖼️"],
  [["baka", "deka", "tetk", "ujak", "gost"], "🏡"],
  [["torta", "kolac", "rucak", "vecer"], "🍰"],
];

/**
 * Chores, checked BEFORE the activity rules so the household vocabulary wins
 * where the two overlap: "Operi zube" is a toothbrush, not the dentist's chair
 * that "zubar" earns. Keywords stay long enough not to fire inside an unrelated
 * word - "sto" would match "istorija", so it is spelled out as "postavi sto".
 */
const TASK_RULES: readonly EmojiRule[] = [
  [["smec", "djubre", "kanta"], "🗑️"],
  [["sudov", "sudje", "sudova"], "🍽️"],
  [["posprem", "sredi sob", "usisa", "cisc", "cisti", "brisanj", "red u sob"], "🧹"],
  [["krevet", "posteljin"], "🛏️"],
  [["pranje", "peglanj", "opran"], "🧺"],
  [["zube", "zubi", "cetkic"], "🪥"],
  [["domac", "ucenj", "lektir", "prepis"], "📚"],
  [["psa", "setnj"], "🐕"],
  [["nahrani", "hran", "mack", "ribic"], "🐾"],
  [["cvec", "zaliv", "bilj"], "🪴"],
  [["postavi sto", "trpez", "posluzi"], "🍽️"],
  [["igrack", "lego", "kock"], "🧸"],
  [["ranac", "torb", "spakuj"], "🎒"],
  [["vitamin", "sirup"], "💊"],
  [["pozovi", "telefon", "javi se"], "📞"],
];

const SUBJECT_RULES: readonly EmojiRule[] = [
  [["matemat"], "➗"],
  [["srpski", "knjizevnost"], "📚"],
  [["engleski"], "🇬🇧"],
  [["nemacki"], "🇩🇪"],
  [["ruski"], "🇷🇺"],
  [["francuski"], "🇫🇷"],
  [["spanski"], "🇪🇸"],
  [["italijanski"], "🇮🇹"],
  [["fizicko", "fiskultur", "sport"], "⚽"],
  [["muzick"], "🎵"],
  [["likovn"], "🎨"],
  [["priroda", "drustvo", "svet oko nas"], "🌍"],
  [["informatik", "racunar"], "💻"],
  [["istorij"], "🏛️"],
  [["geografij"], "🗺️"],
  [["biologij"], "🌱"],
  [["hemij"], "🧪"],
  [["fizika"], "🔭"],
  [["veronauk"], "🕊️"],
  [["gradjansk"], "🤝"],
  [["tehnik", "tehnick"], "🔧"],
  [["odeljenjsk", "cos"], "🧑‍🏫"],
  [["sekcij", "slobodne aktivnosti", "dodatn", "dopunsk"], "🧩"],
];

function matchRules(name: string, rules: readonly EmojiRule[]): string | null {
  const folded = foldSr(name);
  for (const [keywords, emoji] of rules) {
    for (const keyword of keywords) {
      if (folded.includes(keyword)) return emoji;
    }
  }
  return null;
}

/** Emoji for an activity / event name, or `null` when nothing matches. */
export function emojiForName(name: string | null | undefined): string | null {
  if (!name) return null;
  return matchRules(name, ACTIVITY_RULES);
}

/**
 * Emoji for a chore's name, or `null` when nothing matches. Chore keywords
 * first, then the shared activity vocabulary, so "Pročitaj lektiru" lands on a
 * book without the household list having to repeat every activity keyword.
 */
export function emojiForTaskName(name: string | null | undefined): string | null {
  if (!name) return null;
  return matchRules(name, TASK_RULES) ?? matchRules(name, ACTIVITY_RULES);
}

/** Emoji for a school subject - always resolves (📘 is the fallback). */
export function emojiForSubject(subject: string | null | undefined): string {
  if (!subject) return "📘";
  return matchRules(subject, SUBJECT_RULES) ?? "📘";
}

/** Per-kind fallbacks, used when the name says nothing recognisable. */
const KIND_EMOJI: Record<AgendaItem["kind"], string> = {
  activity: "✨",
  event: "📅",
  birthday: "🎂",
  external: "🗓️",
  payment: "💳",
  // A chore. Deliberately NOT a tick: the card leads with a real tick circle,
  // and a ✅ tile beside an empty circle would say "done" while the circle says
  // the opposite. A pin says "something to do" without claiming a state.
  task: "📌",
};

/** The glyph for one agenda card: name first, kind as the safety net. */
export function emojiForAgendaItem(item: AgendaItem): string {
  switch (item.kind) {
    case "activity":
      return emojiForName(item.activity?.name) ?? KIND_EMOJI.activity;
    case "event":
      return emojiForName(item.event.name) ?? KIND_EMOJI.event;
    case "task":
      return emojiForTaskName(item.task.name) ?? KIND_EMOJI.task;
    case "birthday":
      return KIND_EMOJI.birthday;
    default:
      return KIND_EMOJI[item.kind];
  }
}

/**
 * Member avatars used to live here as a private animal palette. They moved to
 * `utils/memberAvatar.ts` when a parent got to PICK a member's emoji: the same
 * choice now feeds the grown-up app's badges and chips, and the main app has no
 * business importing from the kid shell. Import `resolveMemberAvatar` (picked
 * emoji, else the stable animal) from there.
 */
