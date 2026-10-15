import type { NextConfig } from "next";

export const FLAG_SERVER_URL = (process.env.FLAG_SERVER_URL ?? "http://localhost:4000").replace(/\/+$/, "");

/**
 * The browser asks this app for flags at /flags/v1/evaluate and Next forwards
 * the request to the flag server. Same origin, so no CORS, and the phase 3
 * preview cookie will travel with it. Only the evaluate endpoint is forwarded:
 * a catch-all /flags/:path* would expose the admin API through the shop.
 */
export async function rewrites() {
  return [{ source: "/flags/v1/evaluate", destination: `${FLAG_SERVER_URL}/v1/evaluate` }];
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  rewrites,
};

export default nextConfig;
