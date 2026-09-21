import { NextResponse } from "next/server";

/**
 * Put an uploaded photograph into content addressed storage.
 *
 * This runs on the server so the storage credential never reaches the browser.
 * The url handed back must be content addressed: the contract refuses any host
 * that is not on its allow list, because a mutable url would let the leader and
 * the validators grade two different photographs.
 */

export const runtime = "nodejs";

const PINATA_JWT = process.env.PINATA_JWT || "";
const GATEWAY = process.env.CAS_GATEWAY || "https://gateway.pinata.cloud";

/**
 * The contract's own allow list, mirrored.
 *
 * A `CAS_GATEWAY` pointing anywhere else is a deployment that uploads fine and
 * then has every single submission refused on chain with "photograph must sit
 * in content addressed storage" - a failure that looks like the contract is
 * broken and is really one environment variable. Catch it at the upload, where
 * the message can name the actual cause.
 */
const ALLOWED_HOSTS = [
  "ipfs.io",
  "w3s.link",
  "dweb.link",
  "cf-ipfs.com",
  "gateway.pinata.cloud",
];

function gatewayIsAllowed(): boolean {
  try {
    const host = new URL(GATEWAY).hostname.toLowerCase();
    return ALLOWED_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (!gatewayIsAllowed()) {
    return NextResponse.json(
      {
        error: "gateway_not_allowed",
        message:
          `CAS_GATEWAY is set to ${GATEWAY}, which the contract will not accept. ` +
          `It only reads photographs from ${ALLOWED_HOSTS.join(", ")}, because a ` +
          `mutable url would let the leader and the validators grade two ` +
          `different photographs.`,
      },
      { status: 500 }
    );
  }

  if (!PINATA_JWT) {
    return NextResponse.json(
      {
        error: "storage_not_configured",
        message:
          "Set PINATA_JWT to upload photographs. Without it nothing can be submitted, because the contract only accepts content addressed urls.",
      },
      { status: 501 }
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }
  if (file.size > 12 * 1024 * 1024) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  const out = new FormData();
  out.append("file", file, "photo.jpg");

  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { Authorization: `Bearer ${PINATA_JWT}` },
    body: out,
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: "upload_failed", status: res.status },
      { status: 502 }
    );
  }

  const json = await res.json();
  const cid = json.IpfsHash as string;
  const url = `${GATEWAY}/ipfs/${cid}`;

  // Warm the gateway from here, not from the browser.
  //
  // A pin returns as soon as the content id exists, which is before the CDN
  // will answer for it. The browser used to do this check, and it proved the
  // wrong thing: it showed that the edge nearest the *user* had the file, while
  // the validators fetch through the edge nearest *them*. A submission that
  // looked verified in the browser still came back
  // "the after photograph is not readable from storage yet (404)".
  //
  // Asking from the server does two useful things: it is the machine that just
  // pinned the file, and each request pulls the object from origin into another
  // edge, which is what actually makes it fetchable elsewhere. It is still not
  // a guarantee for every region, which is why the client also retries a
  // transient refusal rather than trusting this alone.
  // Twenty attempts rather than six. Cloudflare sits in front of Pinata and
  // caches per edge, so the first fetch that misses is the one that makes the
  // origin materialise the object - and a fresh pin can answer 404 at the
  // origin for a while. This keeps asking until it stops.
  let served = false;
  for (let i = 0; i < 20; i++) {
    try {
      const probe = await fetch(url, { method: "GET", cache: "no-store" });
      if (probe.ok && (probe.headers.get("content-type") || "").startsWith("image/")) {
        // Drain it. An unread body can leave the object half pulled through
        // the edge, which defeats the point of asking.
        await probe.arrayBuffer();
        served = true;
        break;
      }
    } catch {
      // keep trying
    }
    await new Promise((r) => setTimeout(r, 900));
  }

  return NextResponse.json({ cid, url, served });
}
