import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ListWithTasks, Task } from "@/types/database";

// Standalone factories only: importing the real modules would pull in
// lib/supabase, which throws on CI where no Supabase env is set.
type Invoke = (
  name: string,
  options: { body: { list_id: string } },
) => Promise<{ data: unknown; error: unknown }>;

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn<Invoke>() }));

vi.mock("@/lib/supabase", () => ({ supabase: { functions: { invoke } } }));
vi.mock("@/hooks/useTasks", () => ({ TEMP_TASK_ID_PREFIX: "temp-" }));
vi.mock("@/hooks/useProfile", () => ({ useProfile: () => ({ familyId: "fam-1" }) }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn<() => Promise<void>>() }),
}));

import { useShoppingListDetection } from "@/hooks/useShoppingListDetection";

// The hook remembers what it asked for the whole session, so every test uses
// its own list ids instead of resetting module state.
function list(id: string, itemCount: number, over: Partial<ListWithTasks> = {}): ListWithTasks {
  const tasks = Array.from({ length: itemCount }, (_, i) => ({ id: `${id}-t${i}` }) as Task);
  return {
    id,
    name: "za kupiti",
    smart_sort_enabled: false,
    shopping_likelihood: null,
    shopping_checked_items: null,
    aisle_suggestion_dismissed: false,
    tasks,
    ...over,
  } as ListWithTasks;
}

const judged = () => invoke.mock.calls.map(([, options]) => options.body.list_id);

function grow(first: ListWithTasks, ...next: ListWithTasks[]) {
  const { rerender } = renderHook(({ l }) => useShoppingListDetection(l), {
    initialProps: { l: first },
  });
  for (const l of next) rerender({ l });
}

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ data: { checked: true }, error: null });
});

describe("useShoppingListDetection", () => {
  it("never sends a list that is only being looked at", () => {
    grow(list("a", 5));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("judges a list once somebody grows it to two real items", () => {
    const placeholder = { id: "temp-x" } as Task;
    const one = list("b", 1);
    grow(
      one,
      { ...one, tasks: [...one.tasks, placeholder] },
      list("b", 2),
      list("b", 2, { name: "za kupiti (izmenjeno)" }),
    );
    expect(judged()).toEqual(["b"]);
  });

  it("waits until the list has doubled before judging it again", () => {
    grow(
      list("c", 2, { shopping_likelihood: 0.3, shopping_checked_items: 2 }),
      list("c", 3, { shopping_likelihood: 0.3, shopping_checked_items: 2 }),
      list("c", 4, { shopping_likelihood: 0.3, shopping_checked_items: 2 }),
    );
    expect(judged()).toEqual(["c"]);
  });

  it("leaves a settled list alone, and does not read switching lists as growth", () => {
    grow(list("d", 1, { smart_sort_enabled: true }), list("d", 4, { smart_sort_enabled: true }));
    grow(list("e", 1, { shopping_likelihood: 0.9 }), list("e", 4, { shopping_likelihood: 0.9 }));
    grow(list("f", 1), list("g", 3));
    expect(invoke).not.toHaveBeenCalled();
  });
});
