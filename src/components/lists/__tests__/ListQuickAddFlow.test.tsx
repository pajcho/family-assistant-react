import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ListQuickAddFlow } from "@/components/lists/ListQuickAddFlow";
import type { ListFormPayload } from "@/components/lists/ListForm";

const { mutateAsync, successToast, navigate } = vi.hoisted(() => ({
  mutateAsync: vi.fn<(payload: ListFormPayload) => Promise<{ id: string }>>(),
  successToast: vi.fn<(message: string, options?: unknown) => void>(),
  navigate: vi.fn<(options: unknown) => void>(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: successToast,
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

vi.mock("@/hooks/useTasks", () => ({
  useCreateList: () => ({
    mutateAsync,
    isPending: false,
  }),
}));

const payload: ListFormPayload = {
  name: "Šoping",
  scope: "family",
  auto_delete_completed_after_hours: null,
  description: null,
};

vi.mock("@/components/lists/ListFormDialog", () => ({
  ListFormDialog: ({
    open,
    error,
    onSubmit,
  }: {
    open: boolean;
    error?: string | null;
    onSubmit: (value: ListFormPayload) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="Dodaj listu">
        {error ? <p role="alert">{error}</p> : null}
        <button type="button" onClick={() => onSubmit(payload)}>
          Sačuvaj listu
        </button>
      </div>
    ) : null,
}));

describe("ListQuickAddFlow", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates the list and closes without leaving the page", async () => {
    mutateAsync.mockResolvedValue({ id: "list-1" });
    const onOpenChange = vi.fn<(open: boolean) => void>();
    render(<ListQuickAddFlow open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Sačuvaj listu" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(payload));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(successToast).toHaveBeenCalledWith("Lista je napravljena.", expect.anything());
  });

  it("offers the new list through the toast instead of routing there", async () => {
    mutateAsync.mockResolvedValue({ id: "list-1" });
    render(<ListQuickAddFlow open onOpenChange={vi.fn<(open: boolean) => void>()} />);

    fireEvent.click(screen.getByRole("button", { name: "Sačuvaj listu" }));
    await waitFor(() => expect(successToast).toHaveBeenCalled());

    const options = successToast.mock.calls[0][1] as {
      action: { label: string; onClick: () => void };
    };
    expect(options.action.label).toBe("Otvori");
    options.action.onClick();
    expect(navigate).toHaveBeenCalledWith({ to: "/tasks/$listId", params: { listId: "list-1" } });
  });

  it("keeps the form open and shows an inline error when saving fails", async () => {
    mutateAsync.mockRejectedValue(new Error("Upis nije uspeo"));
    const onOpenChange = vi.fn<(open: boolean) => void>();
    render(<ListQuickAddFlow open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Sačuvaj listu" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Upis nije uspeo");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(successToast).not.toHaveBeenCalled();
  });
});
