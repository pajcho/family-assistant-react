import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { KidCodeForm } from "@/components/kid/KidCodeForm";
import { KidInstallFirst } from "@/components/kid/KidInstallFirst";
import { KidQrScanner } from "@/components/kid/KidQrScanner";

/**
 * Linking a device from INSIDE the kid app - the three screens that exist
 * because iOS gives a home-screen web app its own storage container and never
 * hands it a scanned URL. What is worth pinning here is that none of them can
 * strand a child: the camera is allowed to fail, and there is always a way on.
 */

describe("KidCodeForm", () => {
  it("forgives how the code is typed and hands back the normalized one", () => {
    const onToken = vi.fn<(token: string) => void>();
    render(
      <KidCodeForm onToken={onToken} onBack={vi.fn<() => void>()} onScan={vi.fn<() => void>()} />,
    );

    const field = screen.getByLabelText("Kod za povezivanje");
    fireEvent.change(field, { target: { value: "a7k2-9qxm" } });

    // Shown grouped, sent bare.
    expect(field).toHaveValue("A7K2-9QXM");
    fireEvent.click(screen.getByRole("button", { name: /Poveži/ }));
    expect(onToken).toHaveBeenCalledWith("A7K29QXM");
  });

  it("takes the code out of a whole link, so a child can just paste one", () => {
    const onToken = vi.fn<(token: string) => void>();
    render(
      <KidCodeForm onToken={onToken} onBack={vi.fn<() => void>()} onScan={vi.fn<() => void>()} />,
    );

    fireEvent.change(screen.getByLabelText("Kod za povezivanje"), {
      target: { value: "https://example.com/kid/link#A7K29QXM" },
    });

    expect(screen.getByLabelText("Kod za povezivanje")).toHaveValue("A7K2-9QXM");
  });

  it("stays disabled until the code is complete", () => {
    const onToken = vi.fn<(token: string) => void>();
    render(
      <KidCodeForm onToken={onToken} onBack={vi.fn<() => void>()} onScan={vi.fn<() => void>()} />,
    );

    const submit = screen.getByRole("button", { name: /Poveži/ });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Kod za povezivanje"), { target: { value: "A7K29QX" } });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Kod za povezivanje"), {
      target: { value: "A7K29QXM" },
    });
    expect(submit).toBeEnabled();
  });

  it("does not offer the camera when the camera is what failed", () => {
    render(
      <KidCodeForm
        onToken={vi.fn<(t: string) => void>()}
        onBack={vi.fn<() => void>()}
        onScan={null}
      />,
    );
    expect(screen.queryByRole("button", { name: /Skeniraj/ })).not.toBeInTheDocument();
    // The way back is still there - a dead end here would need a parent.
    expect(screen.getByRole("button", { name: /Nazad/ })).toBeInTheDocument();
  });
});

describe("KidQrScanner", () => {
  // jsdom has no `navigator.mediaDevices`, which is exactly the "no camera
  // here" path the component has to survive.
  it("falls back to typing when the camera cannot start, and says so", async () => {
    const onTypeCode = vi.fn<(cameraWorks: boolean) => void>();
    render(
      <KidQrScanner
        onToken={vi.fn<(t: string) => void>()}
        onBack={vi.fn<() => void>()}
        onTypeCode={onTypeCode}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Ukucaj kod/ }));
    // false = do not offer scanning again from the code screen.
    expect(onTypeCode).toHaveBeenCalledWith(false);
  });
});

describe("KidInstallFirst", () => {
  it("gives the three steps in order and warns what continuing here costs", () => {
    render(<KidInstallFirst onContinue={vi.fn<() => void>()} />);

    const steps = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatch(/Safariju/);
    expect(steps[1]).toMatch(/Add to Home Screen/);
    expect(steps[2]).toMatch(/Skeniraj QR kod/);
    expect(screen.getByText(/tražiti novi kod/)).toBeInTheDocument();
  });

  it("is a nudge, not a wall", () => {
    const onContinue = vi.fn<() => void>();
    render(<KidInstallFirst onContinue={onContinue} />);

    fireEvent.click(screen.getByRole("button", { name: /Nastavi ovde/ }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
