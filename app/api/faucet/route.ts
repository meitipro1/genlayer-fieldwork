import { NextResponse } from "next/server";
import { IS_STUDIO, RPC_URL } from "@/lib/chain";

/**
 * Put test GEN in a visitor's wallet so they can fund a task.
 *
 * Studio is gasless, which is often read as "you need no balance". That is only
 * true of gas. `post_task` is payable and the contract refuses anything under
 * reward + fee, so a fresh wallet on Studio can browse everything and post
 * nothing. This closes that.
 *
 * Runs on the server because Studio's RPC is not guaranteed to send CORS
 * headers to a browser, and because the amount should not be a number the page
 * can edit.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whole GEN handed out per request. Not exported: a route file may only
 *  export the handler names Next recognises, and anything else fails the
 *  build with a constraint error on the generated route types. */
const FAUCET_GEN = 100;

/**
 * The amount goes as a decimal STRING, and that is not a style choice.
 *
 * Measured against Studio, repeatedly:
 *
 *   sim_fundAccount(addr, 30000000000000000000)   -> rpc returns a tx hash,
 *                                                    balance never moves
 *   sim_fundAccount(addr, "30000000000000000000") -> rpc returns an ERROR,
 *                                                    balance lands in 2 to 4s
 *
 * The error is `'<=' not supported between instances of 'str' and 'int'`, which
 * is a cap check comparing the argument against a limit. Passed a number the
 * check runs, silently rejects the amount, and still answers with a hash.
 * Passed a string it raises after the credit has already been applied.
 *
 * So the RPC's answer carries no information either way, and this route ignores
 * it completely. Success is decided the same way it is everywhere else in this
 * app: by reading the state back.
 */
const AMOUNT_WEI = String(BigInt(FAUCET_GEN) * BigInt(10) ** BigInt(18));

/** Best effort, per address. Serverless instances do not share this, so it
 *  slows a casual loop rather than enforcing anything. */
const COOLDOWN_MS = 20_000;
const lastCall = new Map<string, number>();

async function rpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    cache: "no-store",
  });
  return res.json();
}

async function balanceOf(address: string): Promise<bigint> {
  try {
    const out = await rpc("eth_getBalance", [address, "latest"]);
    return BigInt(out?.result ?? "0x0");
  } catch {
    return BigInt(0);
  }
}

export async function POST(req: Request) {
  if (!IS_STUDIO) {
    return NextResponse.json(
      {
        error: "not_studio",
        message:
          "This faucet only exists on the Studio development network. On a live network use the network's own faucet.",
      },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const address = String(body?.address ?? "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json(
      { error: "bad_address", message: "That is not a wallet address." },
      { status: 400 }
    );
  }

  const key = address.toLowerCase();
  const since = Date.now() - (lastCall.get(key) ?? 0);
  if (since < COOLDOWN_MS) {
    return NextResponse.json(
      {
        error: "too_soon",
        message: `Give it ${Math.ceil((COOLDOWN_MS - since) / 1000)} seconds and ask again.`,
      },
      { status: 429 }
    );
  }
  lastCall.set(key, Date.now());

  const before = await balanceOf(address);

  // The answer is discarded on purpose. See AMOUNT_WEI.
  await rpc("sim_fundAccount", [address, AMOUNT_WEI]).catch(() => null);

  // Landing takes 2 to 4 seconds in practice. Polled rather than slept, so a
  // fast credit is reported fast and a slow one is still caught.
  let after = before;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    after = await balanceOf(address);
    if (after > before) break;
  }

  if (after <= before) {
    lastCall.delete(key);
    return NextResponse.json(
      {
        error: "not_funded",
        message:
          "The faucet was asked but the balance has not moved yet. Wait a moment and try again.",
      },
      { status: 502 }
    );
  }

  const whole = (wei: bigint) => Number((wei * BigInt(100)) / BigInt(10) ** BigInt(18)) / 100;
  return NextResponse.json({
    funded: true,
    added: whole(after - before),
    balance: whole(after),
  });
}
