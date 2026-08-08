import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { KidAccessPinForm } from "@/components/family/KidAccessPinForm";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

/**
 * The form lives inside a sheet (its footer reads the ResponsiveDialog
 * context), so the test mounts it the same way the section does.
 */
function renderForm(props: Partial<Parameters<typeof KidAccessPinForm>[0]> = {}) {
  const onSubmit = vi.fn<(pin: string) => void>();
  const onCancel = vi.fn<() => void>();
  render(
    <ResponsiveDialog open onOpenChange={() => undefined}>
      <ResponsiveDialogContent>
        <ResponsiveDialogTitle>Uključi dečiji pristup</ResponsiveDialogTitle>
        <KidAccessPinForm
          idPrefix="test"
          description="Izaberi PIN."
          submitLabel="Uključi pristup"
          pendingLabel="Uključivanje…"
          isPending={false}
          onCancel={onCancel}
          onSubmit={onSubmit}
          {...props}
        />
      </ResponsiveDialogContent>
    </ResponsiveDialog>,
  );
  // Lazy: the submit button's label changes while the mutation is pending, so
  // a test that never touches it must not pay for looking it up.
  return {
    onSubmit,
    onCancel,
    get pin() {
      return screen.getByLabelText("PIN") as HTMLInputElement;
    },
    get confirmation() {
      return screen.getByLabelText("Ponovi PIN") as HTMLInputElement;
    },
    get submit() {
      return screen.getByRole("button", { name: "Uključi pristup" });
    },
  };
}

describe("KidAccessPinForm", () => {
  it("asks for a numeric keypad on both fields", () => {
    const { pin, confirmation } = renderForm();
    expect(pin).toHaveAttribute("inputMode", "numeric");
    expect(confirmation).toHaveAttribute("inputMode", "numeric");
  });

  it("strips anything that is not a digit and caps the length at 6", () => {
    const { pin } = renderForm();
    fireEvent.change(pin, { target: { value: "1a2-b3 4x5678" } });
    expect(pin.value).toBe("123456");
  });

  it("stays quiet until the parent actually submits", () => {
    const { pin } = renderForm();
    fireEvent.change(pin, { target: { value: "12" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("refuses a PIN that is not 4 or 6 digits", () => {
    const { pin, confirmation, submit, onSubmit } = renderForm();
    fireEvent.change(pin, { target: { value: "123" } });
    fireEvent.change(confirmation, { target: { value: "123" } });
    fireEvent.click(submit);

    expect(screen.getByRole("alert")).toHaveTextContent("4 ili 6 cifara");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("refuses a PIN anyone would guess", () => {
    const { pin, confirmation, submit, onSubmit } = renderForm();
    fireEvent.change(pin, { target: { value: "1234" } });
    fireEvent.change(confirmation, { target: { value: "1234" } });
    fireEvent.click(submit);

    expect(screen.getByRole("alert")).toHaveTextContent("lako pogađa");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("flags a mismatch as soon as the repeat is long enough, without a submit", () => {
    const { pin, confirmation, onSubmit } = renderForm();
    fireEvent.change(pin, { target: { value: "2580" } });
    fireEvent.change(confirmation, { target: { value: "2581" } });

    expect(screen.getByRole("alert")).toHaveTextContent("ne poklapaju");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("hands over the PIN once both fields agree", () => {
    const { pin, confirmation, submit, onSubmit } = renderForm();
    fireEvent.change(pin, { target: { value: "2580" } });
    fireEvent.change(confirmation, { target: { value: "2580" } });
    fireEvent.click(submit);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(onSubmit).toHaveBeenCalledWith("2580");
  });

  it("discards with Odustani", () => {
    const { onCancel } = renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Odustani" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("locks both buttons while the mutation runs", () => {
    renderForm({ isPending: true });
    expect(screen.getByRole("button", { name: "Uključivanje…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Odustani" })).toBeDisabled();
  });
});
