import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fully static site: `next build` emits out/ for any static host
  // (GitHub Pages included). Content is fixed at build time — the MDX
  // modules and index.json are generated upstream and read from disk
  // during the build.
  output: "export",
  trailingSlash: true,
  // Set NEXT_PUBLIC_BASE_PATH (e.g. "/pr-preview/pr-42") when hosting under a
  // sub-path, as the per-PR previews are. Leave unset for local dev and for
  // production, which is served at the root of iliad-intensive.org.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  // The `preview` loop (PREVIEW_ONLY set) skips type-checking and linting on
  // each rebuild — a couple of seconds saved per save. The real build/CI (no
  // PREVIEW_ONLY) always type-checks and lints.
  ...(process.env.PREVIEW_ONLY
    ? { typescript: { ignoreBuildErrors: true }, eslint: { ignoreDuringBuilds: true } }
    : {}),
};

export default nextConfig;
