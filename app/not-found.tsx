import Link from "next/link";

export default function NotFound() {
  return (
    <div className="wrap" style={{ paddingTop: 64, paddingBottom: 64, maxWidth: 560 }}>
      <span className="pill">404</span>
      <h1 style={{ marginTop: 16, fontSize: 32 }}>
        Nothing here.
      </h1>
      <p className="lede" style={{ marginTop: 12 }}>
        That task or receipt does not exist. It may have expired and returned to
        the pool.
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
