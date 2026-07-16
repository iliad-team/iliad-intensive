// Build provenance shown in page footers: when the site was built and from
// which commit. Both are fixed at build time (the site is a static export).
//
// - BUILT_AT: evaluated once during `next build`.
// - NEXT_PUBLIC_COMMIT_SHA: injected by the build (CI sets it to the deployed
//   commit; local `npm run ci` defaults it to `git rev-parse HEAD`). Absent →
//   the commit link is simply omitted.
const REPO_URL = "https://github.com/iliad-team/iliad-intensive";
export const COMMIT_SHA = process.env.NEXT_PUBLIC_COMMIT_SHA?.trim() || undefined;
const SHA = COMMIT_SHA;

export const BUILT_AT =
  new Date().toLocaleString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false,
  }) + " UTC";

const linkClass =
  "underline decoration-zinc-300 underline-offset-2 hover:text-zinc-800";

/** "commit abc1234" linking to the commit on GitHub, or null if unknown. */
export function CommitLink() {
  if (!SHA) return null;
  return (
    <>
      commit{" "}
      <a href={`${REPO_URL}/commit/${SHA}`} className={linkClass}>
        {SHA.slice(0, 7)}
      </a>
    </>
  );
}

/** "Built <date> · commit <sha>" — the standard footer provenance line. */
export function BuildStamp() {
  return (
    <>
      Built {BUILT_AT}
      {SHA ? <> · <CommitLink /></> : null}
    </>
  );
}
