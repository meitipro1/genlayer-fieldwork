import dns from "node:dns";

/**
 * Studio sits behind Cloudflare on both stacks and its AAAA addresses time out.
 * Node tries IPv6 first, so every server-side read burns ~10s and then fails
 * with a bare "fetch failed" - which lib/onchain.ts correctly reports as "the
 * network is busy", so the whole site quietly falls back to seed records and
 * looks like the contract is unreachable.
 *
 * This runs when the Next server boots, which covers every route handler and
 * every server component. The scripts set it for themselves.
 */
dns.setDefaultResultOrder("ipv4first");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Photographs live in content addressed storage and are referenced by url.
    remotePatterns: [
      { protocol: "https", hostname: "**.ipfs.w3s.link" },
      { protocol: "https", hostname: "ipfs.io" },
      { protocol: "https", hostname: "**.pinata.cloud" },
    ],
  },
  experimental: {
    /**
     * /api/contract-source reads contracts/fieldwork.py off disk at request
     * time. Next only bundles files it can trace statically from an import, and
     * a runtime readFile is invisible to that, so on a serverless host the file
     * is simply absent and the route 500s. This says: ship it anyway.
     *
     * That route is what /deploy hands to the chain, so without this the deploy
     * page is broken in production and works fine locally, which is the worst
     * way for it to fail.
     */
    outputFileTracingIncludes: {
      "/api/contract-source": ["./contracts/fieldwork.py"],
    },
  },
};

export default nextConfig;
