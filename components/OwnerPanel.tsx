"use client";

import { useEffect, useState } from "react";
import {
  IS_LIVE,
  IS_STUDIO,
  connectWallet,
  humanError,
  ownerAndFees,
  txUrl,
  withdrawFees,
} from "@/lib/genlayer";

/* The owner's half of the contract, which the site never showed.

   `withdraw_fees` and `transfer_ownership` have always existed and had no
   interface, so a deployment with a non-zero fee accumulated money that nobody
   could see, let alone collect. This closes that: it reads the fee rate and the
   accrued balance for anyone, and offers the withdrawal only to the address
   that actually owns the contract.

   It renders nothing at all for everyone else. An owner-only control that
   everyone can see is just a button that fails. */

function shorten(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
}

export function OwnerPanel() {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof ownerAndFees>>>(null);
  const [me, setMe] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hash, setHash] = useState("");

  useEffect(() => {
    if (!IS_LIVE) return;
    ownerAndFees().then(setInfo).catch(() => {});
  }, []);

  useEffect(() => {
    const eth = (globalThis as { ethereum?: unknown }).ethereum as
      | {
          request?: (a: unknown) => Promise<string[]>;
          on?: (e: string, f: (a: string[]) => void) => void;
          removeListener?: (e: string, f: (a: string[]) => void) => void;
        }
      | undefined;
    if (!eth?.request) return;
    let live = true;
    const settle = (accounts: string[]) => {
      if (live) setMe(accounts?.[0] ?? null);
    };
    eth.request({ method: "eth_accounts" }).then(settle).catch(() => {});
    eth.on?.("accountsChanged", settle);
    return () => {
      live = false;
      eth.removeListener?.("accountsChanged", settle);
    };
  }, []);

  if (!IS_LIVE || !info) return null;

  const isOwner = !!me && me.toLowerCase() === info.owner.toLowerCase();
  const feesGen = Number(info.feesWei / BigInt(10) ** BigInt(16)) / 100;

  async function onWithdraw() {
    setError("");
    setBusy(true);
    try {
      const address = (await connectWallet()) as `0x${string}`;
      const res = await withdrawFees(address, address);
      setHash(res.hash);
      const fresh = await ownerAndFees();
      setInfo(fresh);
    } catch (e: unknown) {
      setError(humanError(e) || "the withdrawal did not go through");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel panel-2" style={{ marginTop: 16 }}>
      <div className="spread">
        <div className="eyebrow">This contract</div>
        <span className="pill">
          fee {info.feeBps} bps
          {info.feeBps === 0 ? " - none taken" : ` - ${(info.feeBps / 100).toFixed(2)}%`}
        </span>
      </div>

      <div className="grid-2" style={{ marginTop: 14, gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ letterSpacing: "0.14em" }}>
            Owner
          </div>
          <div
            className="mono"
            style={{ marginTop: 6, fontSize: 13.5, color: "var(--dim)" }}
            title={info.owner}
          >
            {shorten(info.owner)}
            {isOwner ? (
              <span className="pill pill-accent" style={{ marginLeft: 8 }}>
                you
              </span>
            ) : null}
          </div>
        </div>
        <div>
          <div className="eyebrow" style={{ letterSpacing: "0.14em" }}>
            Fees collected so far
          </div>
          <div className="mono" style={{ marginTop: 6, fontSize: 13.5 }}>
            {feesGen} GEN
          </div>
        </div>
      </div>

      {isOwner ? (
        info.feesWei > BigInt(0) ? (
          <>
            <button
              className="btn"
              type="button"
              style={{ marginTop: 14 }}
              disabled={busy}
              onClick={onWithdraw}
            >
              {busy ? "withdrawing" : `Withdraw ${feesGen} GEN to your wallet`}
            </button>
            {IS_STUDIO ? (
              <p
                style={{
                  margin: "10px 0 0",
                  fontSize: 13,
                  color: "var(--muted)",
                  lineHeight: 1.6,
                }}
              >
                On this development network the withdrawal is recorded and the
                balance does not move, the same as every other payout here.
              </p>
            ) : null}
          </>
        ) : (
          <p
            style={{
              margin: "14px 0 0",
              color: "var(--muted)",
              fontSize: 13.5,
              lineHeight: 1.6,
            }}
          >
            Nothing to withdraw yet. Fees accrue as tasks settle, at the rate
            above.
          </p>
        )
      ) : null}

      {hash ? (
        <a
          className="mono"
          style={{
            color: "var(--accent)",
            wordBreak: "break-all",
            display: "block",
            marginTop: 12,
            fontSize: 12,
          }}
          href={txUrl(hash)}
          target="_blank"
          rel="noreferrer"
        >
          {hash}
        </a>
      ) : null}

      {error ? (
        <p style={{ margin: "12px 0 0", color: "var(--danger)", lineHeight: 1.6 }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
