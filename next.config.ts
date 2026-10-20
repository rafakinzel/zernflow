import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No `images.remotePatterns` on purpose.
  //
  // It used to allow every https host, which turned /_next/image into an open
  // proxy: anyone could ask this server to fetch any URL on the internet and
  // hand the result back. That is server-side request forgery, and it is also
  // what gives the optimizer's own advisories something to bite on.
  //
  // Nothing here needed it. Every next/image on the site points at a file in
  // /public; the pictures that do come from elsewhere, workspace avatars and
  // Instagram post thumbnails, are rendered with a plain <img> and never touch
  // the optimizer. Adding a host back is a deliberate act: list that host, not
  // a wildcard.
};

export default nextConfig;
