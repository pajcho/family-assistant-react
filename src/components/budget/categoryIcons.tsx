import type { ComponentType, SVGProps } from "react";
import {
  AcademicCapIcon,
  BanknotesIcon,
  BeakerIcon,
  BoltIcon,
  BookOpenIcon,
  CakeIcon,
  CreditCardIcon,
  DevicePhoneMobileIcon,
  FilmIcon,
  GiftIcon,
  HeartIcon,
  HomeIcon,
  ShoppingBagIcon,
  ShoppingCartIcon,
  SparklesIcon,
  TagIcon,
  TicketIcon,
  TruckIcon,
  WifiIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";

/**
 * Maps an `expense_categories.icon` key (short, stored in the DB) to a
 * heroicon. Kept as a plain lookup so both the seed defaults and any custom
 * category the user creates render consistently. Unknown keys fall back to a
 * neutral tag.
 */
type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const ICON_MAP: Record<string, IconComponent> = {
  cart: ShoppingCartIcon,
  bolt: BoltIcon,
  academic: AcademicCapIcon,
  truck: TruckIcon,
  heart: HeartIcon,
  ticket: TicketIcon,
  tag: TagIcon,
  home: HomeIcon,
  cake: CakeIcon,
  gift: GiftIcon,
  phone: DevicePhoneMobileIcon,
  wifi: WifiIcon,
  film: FilmIcon,
  book: BookOpenIcon,
  wrench: WrenchScrewdriverIcon,
  sparkles: SparklesIcon,
  banknotes: BanknotesIcon,
  card: CreditCardIcon,
  bag: ShoppingBagIcon,
  beaker: BeakerIcon,
};

/** Ordered list of icon keys offered when creating / editing a custom category. */
export const CATEGORY_ICON_KEYS: readonly string[] = [
  "cart",
  "bolt",
  "academic",
  "truck",
  "heart",
  "ticket",
  "home",
  "cake",
  "gift",
  "phone",
  "wifi",
  "film",
  "book",
  "wrench",
  "sparkles",
  "banknotes",
  "card",
  "bag",
  "beaker",
  "tag",
];

/** Palette offered for custom categories (hex, like profiles.color). */
export const CATEGORY_COLORS: readonly string[] = [
  "#22c55e",
  "#10b981",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#ef4444",
  "#f59e0b",
  "#eab308",
  "#14b8a6",
  "#06b6d4",
  "#6b7280",
];

export function categoryIcon(key: string | null | undefined): IconComponent {
  if (!key) return TagIcon;
  return ICON_MAP[key] ?? TagIcon;
}
