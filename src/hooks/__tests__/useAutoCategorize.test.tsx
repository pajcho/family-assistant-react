import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ListWithTasks, Task } from "@/types/database";

// Standalone factories only: importing the real modules would pull in
// lib/supabase, which throws on CI where no Supabase env is set.
type Invoke = (
  name: string,
  options: { body: { task_ids: string[] } },
) => Promise<{ data: unknown; error: unknown }>;

const { invoke, invalidate } = vi.hoisted(() => ({
  invoke: vi.fn<Invoke>(),
  invalidate: vi.fn<() => void>(),
}));

vi.mock("@/lib/supabase", () => ({ supabase: { functions: { invoke } } }));
vi.mock("@/hooks/useTasks", () => ({
  TEMP_TASK_ID_PREFIX: "temp-",
  invalidateTaskCaches: invalidate,
}));
vi.mock("@/hooks/useProfile", () => ({ useProfile: () => ({ familyId: "fam-1" }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));

import { useAutoCategorize } from "@/hooks/useAutoCategorize";

// The hook remembers what it sent for the whole session, so every test uses
// its own ids instead of resetting module state.
function task(id: string, name: string, category: string | null = null): Task {
  return { id, name, category, category_confidence: null } as Task;
}

function list(tasks: Task[], smart_sort_enabled = true): ListWithTasks {
  return { id: "list-1", name: "Kupovina", smart_sort_enabled, tasks } as ListWithTasks;
}

const sentIds = () => invoke.mock.calls.map(([, options]) => options.body.task_ids);

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ data: { filed: 1 }, error: null });
  invalidate.mockReset();
});

describe("useAutoCategorize", () => {
  it("sends only unfiled rows that exist in the database", () => {
    renderHook(() =>
      useAutoCategorize(
        list([task("a1", "Mleko"), task("a2", "Hleb", "bakery"), task("temp-a3", "Jaja")]),
      ),
    );
    expect(sentIds()).toEqual([["a1"]]);
  });

  it("asks once per session, so an outage cannot turn every render into a request", () => {
    invoke.mockResolvedValue({ data: null, error: new Error("offline") });
    const { rerender } = renderHook(({ l }) => useAutoCategorize(l), {
      initialProps: { l: list([task("b1", "Mleko")]) },
    });
    rerender({ l: list([task("b1", "Mleko")]) });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("asks again after a rename, which clears the category in the database", () => {
    const { rerender } = renderHook(({ l }) => useAutoCategorize(l), {
      initialProps: { l: list([task("c1", "Mleko")]) },
    });
    rerender({ l: list([task("c1", "Kiselo mleko")]) });
    expect(sentIds()).toEqual([["c1"], ["c1"]]);
  });

  it("does nothing while smart sort is off", () => {
    renderHook(() => useAutoCategorize(list([task("d1", "Mleko")], false)));
    expect(invoke).not.toHaveBeenCalled();
  });
});
