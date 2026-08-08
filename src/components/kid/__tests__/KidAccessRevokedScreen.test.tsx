import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { KidAccessRevokedScreen } from "@/components/kid/KidAccessRevokedScreen";

/**
 * The screen a child lands on when their access ends. What is worth locking
 * down is not the layout but the promise the copy makes: the two reasons must
 * not say the same thing (one needs a new QR code, the other only patience),
 * and neither may leave the child stuck or feeling at fault.
 */

describe("KidAccessRevokedScreen", () => {
  it("explains an unlinked device and points at a new QR code", () => {
    render(<KidAccessRevokedScreen reason="device_unknown" onContinue={vi.fn<() => void>()} />);

    expect(screen.getByRole("heading", { name: /uređaj više nije povezan/i })).toBeInTheDocument();
    expect(screen.getByText(/QR kod/i)).toBeInTheDocument();
  });

  it("explains a switched-off access as temporary, with the PIN still good", () => {
    render(<KidAccessRevokedScreen reason="access_disabled" onContinue={vi.fn<() => void>()} />);

    expect(screen.getByRole("heading", { name: /na pauzi/i })).toBeInTheDocument();
    expect(screen.getByText(/Ništa nije obrisano/i)).toBeInTheDocument();
    expect(screen.getByText(/PIN-om/i)).toBeInTheDocument();
    // No QR code here: the same device works again the moment a parent
    // switches access back on.
    expect(screen.queryByText(/QR kod/i)).not.toBeInTheDocument();
  });

  it("never leaves the child without a way onward", () => {
    const onContinue = vi.fn<() => void>();
    render(<KidAccessRevokedScreen reason="device_unknown" onContinue={onContinue} />);

    fireEvent.click(screen.getByRole("button", { name: "Idi na prijavu" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("tells the child they did nothing wrong, whichever reason it is", () => {
    for (const reason of ["device_unknown", "access_disabled"] as const) {
      const { unmount } = render(
        <KidAccessRevokedScreen reason={reason} onContinue={vi.fn<() => void>()} />,
      );
      expect(screen.getByText(/Nisi ništa pogrešio/i)).toBeInTheDocument();
      unmount();
    }
  });
});
