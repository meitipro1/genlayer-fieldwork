import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

/**
 * The contract, as text.
 *
 * Two jobs. The deploy page needs the source to hand to the chain, and anyone
 * reviewing the running site can read exactly what is deployed without cloning
 * the repository. It is the same file either way, with one normalisation: line
 * endings are always LF.
 *
 * That is not cosmetic. A Windows checkout carries CRLF (core.autocrlf), and a
 * deploy from one puts carriage returns on chain that exist in no clone of the
 * repository, so the deployed source could only ever be compared by someone
 * who also deployed from Windows. The reviewer diffs the deployment against
 * the repository, which makes that comparison part of the submission. Python
 * does not care about line endings, so nothing about the rules changes.
 */

export const runtime = "nodejs";
export const revalidate = 3600;

export async function GET() {
  try {
    const file = path.join(process.cwd(), "contracts", "fieldwork.py");
    const source = (await readFile(file, "utf8")).split("\r\n").join("\n");
    return new NextResponse(source, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "contract_source_unavailable" },
      { status: 500 }
    );
  }
}
