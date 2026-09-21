"use client";

import { useState } from "react";
import {
  CHAIN_NAME,
  IS_STUDIO,
  addressUrl,
  connectWallet,
  deployFieldwork,
  humanError,
  txUrl,
    type Stage,
} from "@/lib/genlayer";
import { TxProgress } from "./TxProgress";

/* Deploy the contract with your own wallet.
   The deployer becomes the owner, so this is the difference between a contract
   you hold and one nobody can withdraw fees from. */

export function DeployPanel() {
  const [feeBps, setFeeBps] = useState(600);
  const [stage, setStage] = useState<Stage>("idle");
  const [result, setResult] = useState<{ hash: string; contract: string } | null>(
    null
  );
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const busy =
    stage === "sent" || stage === "accepted" || stage === "confirming";
  const [startedAt, setStartedAt] = useState(0);

  async function onDeploy() {
    setError("");
    setResult(null);
    try {
      const address = await connectWallet();
      setStartedAt(Date.now());
      setStage("sent");
      const res = await deployFieldwork(address, feeBps, setStage);
      setResult(res);
    } catch (e: unknown) {
      setStage("failed");
      setError(humanError(e) || "the deploy did not go through");
    }
  }

  if (result) {
    const env = [
      `NEXT_PUBLIC_GENLAYER_NETWORK=${IS_STUDIO ? "studionet" : "bradbury"}`,
      `NEXT_PUBLIC_FIELDWORK_CONTRACT=${result.contract}`,
    ].join("\n");

    return (
      <div className="panel stack">
        <div className="eyebrow" style={{ color: "var(--accent)" }}>
          Deployed - you are the owner
        </div>

        <p style={{ margin: 0 }}>
          Put these two lines in <span className="mono">.env.local</span> (and in
          your Vercel environment variables), then restart the site.
        </p>

        <pre
          className="mono"
          style={{
            margin: 0,
            padding: 12,
            // Was `var(--cream)`, a token from the palette before the redesign
            // and defined nowhere since. An undefined variable with no fallback
            // invalidates the declaration, so the block that holds the two
            // lines you have to copy had no surface behind it at all.
            background: "var(--panel2)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            overflowX: "auto",
            whiteSpace: "pre",
          }}
        >
          {env}
        </pre>

        <div className="row" style={{ flexWrap: "wrap" }}>
          <button
            className="btn"
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(env).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                },
                () => setError("could not copy - select the text instead")
              );
            }}
          >
            {copied ? "Copied" : "Copy both lines"}
          </button>
          <a
            className="btn"
            href={addressUrl(result.contract)}
            target="_blank"
            rel="noreferrer"
          >
            View the contract
          </a>
        </div>

        <a
          className="mono muted"
          style={{ wordBreak: "break-all" }}
          href={txUrl(result.hash)}
          target="_blank"
          rel="noreferrer"
        >
          {result.hash}
        </a>

        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
          Nothing is seeded yet, so the task list will be empty until someone
          posts one. Post the first from{" "}
          <a href="/console" style={{ color: "var(--accent)", fontWeight: 600 }}>
            the console
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="panel stack">
      <div className="eyebrow">Deploy with your wallet</div>

      <p style={{ margin: 0 }}>
        This signs the deployment with whatever address your wallet is on, which
        makes that address the contract <strong>owner</strong> - the only one
        that can withdraw fees or transfer ownership later. Deploying from a CLI
        keystore or from Studio&apos;s own account selector would hand ownership
        to one of those instead.
      </p>

      <div style={{ maxWidth: 220 }}>
        <label htmlFor="fee">Take rate (basis points)</label>
        <input
          id="fee"
          type="number"
          min={0}
          max={2000}
          value={feeBps}
          onChange={(e) => setFeeBps(Number(e.target.value))}
        />
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 13.5 }}>
          {feeBps} bps = {(feeBps / 100).toFixed(2)}% of each paid bounty,
          charged to the poster. The contract refuses anything above 20%.
        </p>
      </div>

      <button
        className="btn btn-primary"
        type="button"
        onClick={onDeploy}
        disabled={busy || feeBps < 0 || feeBps > 2000}
      >
        {busy ? "deploying" : `Deploy to ${CHAIN_NAME}`}
      </button>

      {busy ? (
        <TxProgress
          stage={stage}
          startedAt={startedAt}
        />
      ) : null}

      {error ? (
        <div className="panel" style={{ borderColor: "var(--danger)" }}>
          <div className="eyebrow" style={{ color: "var(--danger)" }}>
            Not deployed
          </div>
          <p style={{ margin: "6px 0 0" }}>{error}</p>
        </div>
      ) : null}
    </div>
  );
}
