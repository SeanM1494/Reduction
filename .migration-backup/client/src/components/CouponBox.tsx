/**
 * client/src/components/CouponBox.tsx — redeeming an "N recipes free" code.
 *
 * IN BOTH PLACES, DELIBERATELY. At the paywall, because that is the moment of
 * intent — someone holding a code is holding it for exactly this instant. And
 * in Settings, because that is where a person who was given a code last week
 * goes looking for it. One component, one endpoint, two mount points.
 *
 * This is only the RECIPES mechanic. A "free months" code is a Stripe
 * promotion code and gets typed into Stripe Checkout's own field, because it
 * is a billing discount rather than a usage grant — see
 * server/lib/billing/coupons.ts for why forcing both through one system makes
 * both worse.
 */

import { useCallback, useState } from "react";

interface Props {
  onRedeemed?: (recipes: number) => void;
}

export default function CouponBox({ onRedeemed }: Props) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!code.trim() || busy) return;
      setBusy(true);
      setMessage(null);
      try {
        const res = await fetch("/api/billing/coupon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          recipes?: number;
          error?: string;
        };
        if (!res.ok) {
          setMessage({ ok: false, text: body.error ?? "Could not redeem that code." });
        } else {
          const n = body.recipes ?? 0;
          setMessage({
            ok: true,
            text: `Added ${n} ${n === 1 ? "recipe" : "recipes"} to your account.`,
          });
          setCode("");
          onRedeemed?.(n);
        }
      } catch (err) {
        setMessage({ ok: false, text: (err as Error).message });
      } finally {
        setBusy(false);
      }
    },
    [code, busy, onRedeemed]
  );

  return (
    <form className="rd-coupon" onSubmit={submit}>
      <label className="rd-coupon-label" htmlFor="rd-coupon-input">
        Redeem a code
      </label>
      <div className="rd-coupon-row">
        <input
          id="rd-coupon-input"
          className="rd-coupon-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="MEG10"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          disabled={busy}
        />
        <button className="rd-btn rd-coupon-btn" type="submit" disabled={busy || !code.trim()}>
          {busy ? "…" : "Redeem"}
        </button>
      </div>
      {message ? (
        <p
          className={`rd-coupon-msg ${message.ok ? "is-ok" : "is-bad"}`}
          role="status"
        >
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
