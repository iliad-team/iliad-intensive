import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fully static site: `next build` emits out/ for any static host
  // (GitHub Pages included). Content is fixed at build time — the MDX
  // modules and index.json are generated upstream and read from disk
  // during the build.
  output: "export",
  trailingSlash: true,
  // Set NEXT_PUBLIC_BASE_PATH (e.g. "/iliad-intensive") when hosting under a
  // sub-path such as a GitHub Pages project site. Leave unset for local dev
  // and root-domain hosting.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
};

export default nextConfig;
