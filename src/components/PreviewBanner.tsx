// Shown ONLY on per-PR preview builds. CI sets NEXT_PUBLIC_PREVIEW_PR to the PR
// number for preview deploys (see .github/workflows/site.yml); production builds
// leave it unset, so this renders nothing there. Values are inlined at build
// time (NEXT_PUBLIC_* → client bundle), so it works under `output: export`.
const PR = process.env.NEXT_PUBLIC_PREVIEW_PR;

// Fixed project locations.
const LIVE_URL = "https://iliad-team.github.io/iliad-intensive/";
const REPO_URL = "https://github.com/iliad-team/iliad-intensive";

export function PreviewBanner() {
  if (!PR) return null;
  const prUrl = `${REPO_URL}/pull/${PR}`;
  return (
    <div
      role="alert"
      className="w-full bg-amber-400 text-amber-950 px-4 py-2 text-sm text-center flex flex-wrap items-center justify-center gap-x-4 gap-y-1"
    >
      <span className="font-medium">
        ⚠ Preview of pull request #{PR} — this is not the live site.
      </span>
      <span className="flex flex-wrap items-center justify-center gap-x-4">
        <a className="underline underline-offset-2 font-medium" href={LIVE_URL}>
          Go to the live site&nbsp;↗
        </a>
        <a
          className="underline underline-offset-2 font-medium"
          href={prUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open PR #{PR}&nbsp;↗
        </a>
      </span>
    </div>
  );
}
