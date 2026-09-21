"use client";

import { useCallback, useEffect, useState } from "react";
import { IS_STUDIO, connectWallet, humanError } from "@/lib/genlayer";

/* Connect, and get something to spend.

   Two things a visitor needs before they can do anything here, and neither was
   on the page. Studio being gasless is often read as "you need no balance",
   which is only true of gas: posting a task is payable, so a fresh wallet could
   read the whole site and fund nothing. */

const FAUCET_GEN = 100;

function short(a: string): string {
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

export function WalletBar() {
  const [address, setAddress] = useState<string | null>(null);
  const [busy, setBusy] = useState<"connect" | "faucet" | null>(null);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);

  // eth_accounts never opens the wallet, so the header can show the connected
  // address without prompting everyone who lands on the site.
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
      if (live) setAddress(accounts?.[0] ?? null);
    };
    eth.request({ method: "eth_accounts" }).then(settle).catch(() => {});
    eth.on?.("accountsChanged", settle);
    return () => {
      live = false;
      eth.removeListener?.("accountsChanged", settle);
    };
  }, []);

  const say = useCallback((text: string, isError = false) => {
    setBad(isError);
    setNote(text);
    setTimeout(() => setNote(""), 6000);
  }, []);

  async function onConnect() {
    setBusy("connect");
    try {
      const a = await connectWallet();
      setAddress(a);
      say("Wallet connected");
    } catch (e: unknown) {
      say(humanError(e) || "could not connect", true);
    } finally {
      setBusy(null);
    }
  }

  async function onFaucet() {
    setBusy("faucet");
    try {
      // Connect first if they have not, so the button works in one press
      // rather than telling them off for pressing it.
      const a = address ?? (await connectWallet());
      setAddress(a);

      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: a }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        say(json?.message || "the faucet did not answer", true);
        return;
      }
      say(`${json.added} GEN in, balance ${json.balance}`);
    } catch (e: unknown) {
      say(humanError(e) || "the faucet did not answer", true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="wallet-bar">
      {IS_STUDIO ? (
        <button
          type="button"
          className="btn-mono"
          onClick={onFaucet}
          disabled={busy !== null}
          title={`Put ${FAUCET_GEN} test GEN in your wallet on Studio`}
        >
          {busy === "faucet" ? "funding" : `Get ${FAUCET_GEN} GEN`}
        </button>
      ) : null}

      <button
        type="button"
        className="btn-mono"
        onClick={onConnect}
        disabled={busy !== null || !!address}
        title={address ? "Wallet connected" : "Connect a wallet"}
      >
        {address
          ? short(address)
          : busy === "connect"
            ? "connecting"
            : "Connect wallet"}
      </button>

      {note ? (
        <span
          role="status"
          className="wallet-note"
          style={{ color: bad ? "var(--danger)" : "var(--accent)" }}
        >
          {note}
        </span>
      ) : null}
    </div>
  );
}
