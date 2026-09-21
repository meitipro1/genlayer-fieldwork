import Link from "next/link";

/* The chain could not be read.
   This is deliberately not a 404: telling someone a task does not exist when
   the network was merely busy is worse than saying nothing, because they stop
   looking for work that is really there. */

export function Unavailable({ what = "this page" }: { what?: string }) {
  return (
    <div className="wrap" style={{ paddingTop: 56, paddingBottom: 56, maxWidth: 560 }}>
      <span className="pill">Temporarily unavailable</span>
      <h1 style={{ marginTop: 12, fontSize: 30 }}>
        The network is busy.
      </h1>
      <p className="lede" style={{ marginTop: 12 }}>
        We could not read {what} from the chain just now. Nothing is wrong with
        your claim or your work - reload in a moment and it should be back.
      </p>
      <div className="row" style={{ marginTop: 20 }}>
        <Link className="btn btn-primary" href="/map">
          Find work
        </Link>
        <Link className="btn" href="/">
          Home
        </Link>
      </div>
    </div>
  );
}
