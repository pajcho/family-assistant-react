import { KidAuthScreen } from "@/components/kid/KidAuthScreen";

/**
 * The step that has to come BEFORE the PIN on an iPhone: put the app on the
 * home screen, then link from inside it.
 *
 * The reason is iOS, and it cannot be worked around from here. A home-screen
 * web app gets its OWN storage container - it shares nothing with Safari - and
 * Safari can never hand it a URL, because the Camera app opens a scanned link
 * in the browser. So a child who links in Safari and installs afterwards ends
 * up with an app that has never heard of them, and rescanning only reopens
 * Safari. Doing it in this order spends the one-time code where it counts.
 *
 * Not a wall: "Nastavi ovde" is right there for anyone who just wants to use
 * the app in the browser, and the code is still good afterwards.
 */
export function KidInstallFirst({ onContinue }: { onContinue: () => void }) {
  return (
    <KidAuthScreen
      emoji="📲"
      title="Prvo me stavi na ekran"
      subtitle="pa se poveži iz aplikacije"
      footer={<>Kod od roditelja i dalje važi - treba ti u trećem koraku.</>}
    >
      <ol className="mt-6 w-full max-w-[300px] space-y-2.5">
        <Step number={1}>
          Dole u Safariju tapni <ShareGlyph /> <b className="font-semibold">Podeli</b>
        </Step>
        <Step number={2}>
          Izaberi <PlusGlyph /> <b className="font-semibold">Add to Home Screen</b>
        </Step>
        <Step number={3}>
          Otvori novu ikonicu i tapni <b className="font-semibold">&bdquo;Skeniraj QR kod&ldquo;</b>
        </Step>
      </ol>

      <button
        type="button"
        onClick={onContinue}
        className="kid-on-gradient mt-5 w-full max-w-[300px] rounded-[18px] bg-white/20 px-4 py-3.5 text-[15px] font-semibold transition-transform duration-100 active:scale-[0.96]"
      >
        Nastavi ovde u pretraživaču
      </button>
      {/* Said plainly, because it is exactly what surprises people: the code is
          single use, so spending it here leaves nothing for the installed app. */}
      <p className="mt-2 max-w-[290px] text-center text-[11.5px] leading-relaxed font-normal opacity-85">
        Ako nastaviš ovde, aplikacija sa ekrana će kasnije tražiti novi kod.
      </p>
    </KidAuthScreen>
  );
}

function Step({ number, children }: { number: number; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-[20px] bg-white/20 px-4 py-3 text-left">
      <span
        aria-hidden="true"
        className="grid size-8 flex-none place-items-center rounded-full bg-white/85 text-[15px] font-bold text-[var(--k-accent-strong)]"
      >
        {number}
      </span>
      <span className="text-[13.5px] leading-snug font-normal">{children}</span>
    </li>
  );
}

/**
 * The two iOS glyphs, drawn inline rather than pulled from the icon set: the
 * kid shell has no icon library at all (everything else in it is an emoji), and
 * these two have to look like the buttons on the child's own screen, which no
 * emoji does.
 */
function ShareGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="inline-block size-[17px] -translate-y-px align-middle"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12" />
      <path d="M8.5 6.5 12 3l3.5 3.5" />
      <path d="M7 10.5H5.5v9h13v-9H17" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="inline-block size-[17px] -translate-y-px align-middle"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8.5v7M8.5 12h7" />
    </svg>
  );
}
