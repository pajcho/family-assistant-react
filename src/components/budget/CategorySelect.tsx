import { Label } from "@/components/ui/label";
import { useExpenseCategories } from "@/hooks/useExpenseCategories";

/**
 * Optional "Kategorija" picker used in the payment + expense forms. A native
 * <select> (keeps the form's look + keyboard behaviour) with the selected
 * category's color shown as a dot on the left. Self-fetches the category list;
 * the parent owns only the selected id (`null` = "Bez kategorije").
 */
export type CategorySelectProps = {
  value: string | null;
  onChange: (categoryId: string | null) => void;
  id?: string;
  label?: string;
};

const SELECT_CHROME =
  "h-9 w-full min-w-0 cursor-pointer appearance-none rounded-md border border-input bg-transparent pr-9 pl-8 text-base shadow-xs outline-none transition-[color,box-shadow] md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";

export function CategorySelect({ value, onChange, id, label = "Kategorija" }: CategorySelectProps) {
  const { categories } = useExpenseCategories();
  const selected = value ? categories.find((c) => c.id === value) : null;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        {/* Selected category's color dot (a hollow ring when none). */}
        <span
          className="pointer-events-none absolute top-1/2 left-3 size-2.5 -translate-y-1/2 rounded-full"
          style={
            selected
              ? { backgroundColor: selected.color }
              : { boxShadow: "inset 0 0 0 1.5px #9ca3af", opacity: 0.6 }
          }
          aria-hidden="true"
        />
        <select
          id={id}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          className={SELECT_CHROME}
        >
          <option value="">Bez kategorije</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground opacity-60"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
    </div>
  );
}
