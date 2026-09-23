// supabase/functions/_shared/shopCategories.ts
//
// The prompt and the decision rule for filing a shopping-list item into a shop
// department with Jev (TypeSafe's System One model). Pure on purpose: no Deno
// globals and no network, so vitest can exercise every rule here and the
// categorize-tasks handler stays a thin layer of I/O around it.
//
// Why it looks the way it does, measured before shipping (55 labelled items):
//
//   • The item is judged beside the rest of its list. Alone, "Persun" (parsley
//     typed without diacritics) scored 0.20 and landed in dairy; beside its
//     siblings it scores 0.98 in fruits_veg. Accuracy by sibling count was
//     6/7 at 1-4 siblings, 7/7 at 5-14 and 41/41 at 15+.
//   • The family types Serbian on an English keyboard, so the prompt says so
//     and spells out the letter mapping. Same words with diacritics scored
//     12/12, without them 9/12 before the note.
//   • `other` is a department of its own AND the destination of anything the
//     model is unsure about. Without context the model cannot decline, so a
//     to-do such as "Oprati kola" used to be filed under bakery.
//
// Jev only ever answers with one of the keys below (or a probability) and
// cannot generate text, so an item name crafted to steer it can at worst pick
// a wrong department or misjudge a list.

import { JEV_MODEL } from "./jev.ts";

/**
 * Below this confidence the item is filed as `other` rather than trusted.
 *
 * On the labelled sample every correct answer sat at 0.45 or above and every
 * wrong one at 0.38 or below, so 0.45 separated them. The margin is thin and
 * the sample small; `tasks.category_confidence` is stored so this can be
 * re-tuned against real rows without asking the model again.
 */
export const CONFIDENCE_THRESHOLD = 0.45;

/**
 * Siblings sent as context. Accuracy was already perfect from 15 up, and every
 * extra name is paid for in input tokens on every single call.
 */
export const MAX_SIBLINGS = 30;

/** Long enough for any real item, short enough that no name can crowd the context. */
const MAX_ENTRY_CHARS = 200;
const MAX_SIBLING_CHARS = 80;

/**
 * The departments, one line each and no product lists anywhere: this is the
 * whole configuration, and the reason there is no dictionary to maintain.
 *
 * Modelled on Maxi's online-shop departments, the only large Serbian chain with
 * a published product taxonomy. Where the web catalogue and the physical shop
 * disagree, the shop wins, because the sort exists to follow the walk through
 * the aisles:
 *
 *   • coffee and tea go in pantry, NOT in drinks where Maxi files them. They
 *     are neither bottled nor chilled and sit on the dry-goods shelves, at the
 *     other end of the shop from the coolers. The drinks hint says so outright,
 *     because without the negation the model follows the catalogue.
 *   • paper goods sit with household chemicals, not personal hygiene. Here the
 *     catalogue and the aisle agree: toilet paper stands beside the detergent.
 *
 * Serbian, because the items are Serbian. Keys are English because they are
 * stored in `tasks.category`, and the client names them in
 * src/lib/shopCategories.ts; shopCategories.parity.test.ts keeps both key sets
 * equal.
 */
export const SHOP_CATEGORY_HINTS = {
  fruits_veg: "Sveže voće i povrće, sveže začinsko bilje, salata, orašasti plodovi",
  bakery: "Hleb, pecivo, kifle, burek, testo, torte i kolači iz pekare",
  dairy: "Mleko, jogurt, kiselo mleko, sir, puter, pavlaka, jaja",
  meat_fish: "Sveže i suvo meso, riba, morski plodovi, mesne prerađevine, pašteta, suhomesnato",
  frozen: "Sve iz zamrzivača: smrznuto povrće, smrznuta riba, sladoled, led",
  ready_meals: "Gotova i polugotova jela, gotove pite, supe iz kesice, hrana za poneti",
  pantry:
    "Pakovana hrana sa suvih polica: brašno, šećer, ulje, sirće, testenina, pirinač, konzerve, džem, začini, med, kafa, čaj",
  sweets_snacks: "Slatki i slani konditori: čokolade, keks, bombone, grickalice, čips, kokice",
  drinks:
    "Flaširano i rashlađeno piće: voda, sokovi, gazirano, pivo, vino, žestoko. NE kafa i čaj.",
  cleaning:
    "Kućna hemija i papirna galanterija: deterdženti, sredstva za čišćenje, toalet papir, salvete, ubrusi, kese za smeće",
  hygiene: "Lična higijena i kozmetika: sapun, šampon, pasta za zube, brijanje, nega tela, apoteka",
  baby: "Bebi program: pelene, hrana za bebe, flašice, vlažne maramice, nega bebe",
  pets: "Za kućne ljubimce: hrana za pse i mačke, posip, igračke i oprema za životinje",
  household:
    "Domaćinstvo i elektronika: sijalice, baterije, posuđe, pribor, alat, sveće, sitni kućni aparati",
  office_school: "Kancelarijski i školski pribor: sveske, olovke, papir, lepak, selotejp",
  other:
    "Nije artikal iz prodavnice: radnja koju treba obaviti, beleška o novcu, ime osobe, link, ili roba iz druge branše",
} as const satisfies Record<string, string>;

export type ShopCategoryKey = keyof typeof SHOP_CATEGORY_HINTS;

const CATEGORY_KEYS: ReadonlySet<string> = new Set(Object.keys(SHOP_CATEGORY_HINTS));

const APP_CONTEXT =
  "A Serbian family's shared list app. A list can be a shopping list, a to-do list, a meal diary, a loan ledger or a project material list.";

/**
 * Worked examples deliberately avoid common shopping words, so the note stays a
 * general reading rule instead of quietly becoming an answer key.
 */
const DIACRITICS_NOTE =
  ' Serbian here is typed on an English keyboard, without diacritics. Read a plain letter as its accented form wherever that makes a real Serbian word: c can be c, č or ć; s can be s or š; z can be z or ž; d or dj can be đ. For example "Stampa" is "Štampa", "Zena" is "Žena", "Djak" is "Đak", "Cetka" is "Četka", "Cufte" is "Ćufte".';

/**
 * The request body for one item. `siblings` are the other items on its list and
 * must not contain the item itself, or the model reads its answer off its own
 * input; they are trimmed to `MAX_SIBLINGS` here so callers need not care.
 */
export function buildJevRequest(entry: string, listName: string, siblings: readonly string[]) {
  const item = entry.trim().slice(0, MAX_ENTRY_CHARS);
  return {
    model: JEV_MODEL,
    state: {
      app: APP_CONTEXT,
      list_name: listName,
      items_already_on_this_list: siblings
        .slice(0, MAX_SIBLINGS)
        .map((name) => name.trim().slice(0, MAX_SIBLING_CHARS)),
      new_entry: item,
    },
    questions: {
      category: {
        type: "choice",
        instructions:
          `Someone just added the entry "${item}" to this list. Use the items already on the list as context for what kind of list this is. Which shop department does the new entry belong to? Choose "other" if it is not a shop product at all.` +
          DIACRITICS_NOTE,
        criteria: SHOP_CATEGORY_HINTS,
      },
    },
  };
}

export interface CategoryDecision {
  category: ShopCategoryKey;
  confidence: number;
}

/**
 * Turn Jev's answer into what gets stored, or `null` when the answer cannot be
 * trusted at all.
 *
 * `null` is not "other". It means "leave the row unfiled", which the app shows
 * under Ostalo anyway and asks about again on a later visit, whereas "other" is
 * a decision that sticks. So only a well-formed answer is ever a decision, and
 * a low-confidence one becomes an explicit `other`.
 */
export function decideCategory(
  answer: unknown,
  threshold: number = CONFIDENCE_THRESHOLD,
): CategoryDecision | null {
  if (typeof answer !== "object" || answer === null) return null;
  const { choice, confidence } = answer as { choice?: unknown; confidence?: unknown };
  if (typeof choice !== "string" || !CATEGORY_KEYS.has(choice)) return null;
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;

  const clamped = Math.min(1, Math.max(0, confidence));
  return {
    category: clamped < threshold ? "other" : (choice as ShopCategoryKey),
    confidence: clamped,
  };
}

// ---------------------------------------------------------------------------
// Is this list a shopping list at all? (detect-shopping-list)
//
// Measured on 13 lists named and filled the way the family writes them:
// 13/13 right at 0.5. Every shopping list scored 0.64 or more ("za kupiti"
// already 0.90 with a single item), every other list 0.28 or less, including
// the hard ones that are full of products without being shopping: a meal diary
// (0.28), a packing list (0.13) and gift ideas (0.05). About 500 input tokens.
// ---------------------------------------------------------------------------

/** At or above this, the list is treated as a shopping list. Mid-gap of 0.28..0.64. */
export const SHOPPING_LIST_THRESHOLD = 0.5;

/**
 * The first judgement waits for this many items. A name like "za kupiti" is
 * enough on its own, but "Subota" or "Maxi" needs a little content.
 */
export const MIN_ITEMS_FOR_LIST_CHECK = 2;

/** Items sent with a judgement; a handful already decides it. */
const MAX_LIST_CHECK_ITEMS = 15;

/**
 * Whether a list with `itemCount` items should be judged (again), given how
 * many it had at the last judgement. First at MIN_ITEMS_FOR_LIST_CHECK, then
 * each time the list has doubled, so an early "no" can still turn into a
 * "yes" as the list grows, at most log2(n) calls per list.
 *
 * The client runs the same rule to avoid pointless calls and the function runs
 * it again as the real guard; shopCategories.parity.test.ts keeps the two equal.
 */
export function shouldCheckShoppingList(itemCount: number, checkedItems: number | null): boolean {
  return itemCount >= Math.max(MIN_ITEMS_FOR_LIST_CHECK, 2 * (checkedItems ?? 0));
}

/** Every kind of list the family keeps, so "not a shopping list" has somewhere to go. */
const LIST_KINDS_CONTEXT =
  "A Serbian family's shared list app. A list can be a shopping list, a to-do list, a meal diary, a loan ledger, a packing list, a gift-idea list or a project material list.";

/** The request that asks whether a list is a shopping list, from its name and items. */
export function buildShoppingListCheck(listName: string, items: readonly string[]) {
  return {
    model: JEV_MODEL,
    state: {
      app: LIST_KINDS_CONTEXT,
      list_name: listName.trim().slice(0, MAX_SIBLING_CHARS),
      items: items
        .slice(0, MAX_LIST_CHECK_ITEMS)
        .map((name) => name.trim().slice(0, MAX_SIBLING_CHARS)),
    },
    questions: {
      is_shopping: {
        type: "noul",
        instructions:
          "Is this a shopping list: things the family still has to go and buy in a shop, so that grouping them by supermarket aisle would help? A list that only mentions products is not enough: packing lists, meal diaries, gift ideas and to-dos are not shopping lists." +
          DIACRITICS_NOTE,
        criteria: {
          true: "A list of things to buy in a shop",
          false: "Any other kind of list",
        },
      },
    },
  };
}

/** The stored probability, or `null` (leave the list unjudged) for an answer that cannot be trusted. */
export function decideShoppingLikelihood(answer: unknown): number | null {
  if (typeof answer !== "object" || answer === null) return null;
  const { noul } = answer as { noul?: unknown };
  if (typeof noul !== "number" || !Number.isFinite(noul)) return null;
  return Math.min(1, Math.max(0, noul));
}
