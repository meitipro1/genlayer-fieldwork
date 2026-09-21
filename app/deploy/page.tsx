import type { Metadata } from "next";
import Link from "next/link";
import { DeployPanel } from "@/components/DeployPanel";
import { OwnerPanel } from "@/components/OwnerPanel";
import { CHAIN_NAME, EXPLORER, IS_STUDIO, NETWORK } from "@/lib/chain";

export const metadata: Metadata = {
  title: "Deploy the contract",
  description:
    "Deploy the Fieldwork Intelligent Contract with your own wallet, so your address owns it.",
};

/* Deploying is a one-off, so this is a plain page rather than a product screen.
   It exists because the deployer becomes the owner, and the owner is the only
   account that can ever withdraw fees or transfer ownership. */

export default function DeployPage() {
  return (
    <div className="wrap" style={{ paddingTop: 32, paddingBottom: 20, maxWidth: 760 }}>
      <span className="pill pill-accent">Setup</span>
      <h1 style={{ marginTop: 18, fontSize: 38 }}>
        Deploy the contract
      </h1>
      <p className="lede" style={{ marginTop: 12 }}>
        One transaction, signed by your wallet on {CHAIN_NAME}. You end up owning
        the contract, and the site points at it with two environment variables.
      </p>

      <div style={{ marginTop: 22 }}>
        <DeployPanel />
      </div>

      {/* Only renders against a live contract, and the withdrawal only for the
          address that owns it. */}
      <OwnerPanel />

      <h2 style={{ marginTop: 36, fontSize: 22 }}>
        Before you press it
      </h2>

      <section className="panel stack" style={{ marginTop: 12 }}>
        <div>
          <div className="eyebrow">Your wallet must be on the right network</div>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            {CHAIN_NAME} (<span className="mono">{NETWORK}</span>). Connecting
            will offer to add or switch to it.
            {IS_STUDIO
              ? " Studio is gasless, so you do not need a balance to deploy."
              : " You need enough GEN to pay for the transaction."}
          </p>
        </div>

        <div>
          <div className="eyebrow">What gets deployed</div>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            <Link
              href="/api/contract-source"
              style={{ color: "var(--accent)", fontWeight: 600 }}
            >
              contracts/fieldwork.py
            </Link>{" "}
            exactly as it is in the repository - there is no build step between
            the file and the chain, so what you read is what runs.
          </p>
        </div>

        <div>
          <div className="eyebrow">Afterwards</div>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            The contract starts empty. Post the first task from the console; the
            contract reads your acceptance test and refuses it if it cannot be
            graded from a photograph, so expect that to take a few seconds.
          </p>
        </div>
      </section>

      {IS_STUDIO ? (
        <div className="notice" style={{ marginTop: 16 }}>
          <strong>Studio is a development network.</strong> Grading, verdicts
          and receipts are all real here. The transfer is not: Studio delivers a
          payout as a contract call and a wallet is not a contract, so the
          balance does not move. On a live network the same transaction pays.
        </div>
      ) : null}

      <p className="muted" style={{ marginTop: 20, fontSize: 13.5 }}>
        The explorer for this network is{" "}
        <a href={EXPLORER} target="_blank" rel="noreferrer" className="mono">
          {EXPLORER.replace("https://", "")}
        </a>
        .
      </p>
    </div>
  );
}
