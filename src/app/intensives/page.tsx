import Link from "next/link";
import { listIntensives, formatRange } from "@/lib/intensives";

/**
 * /intensives — every programme ILIAD runs, newest first.
 *
 * A directory page and nothing else: the curriculum itself is the rest of the
 * site, and each row here is one running of it in one place.
 */
export const metadata = {
  title: "Intensives — Iliad",
  description: "ILIAD intensive programmes and the days each one teaches.",
};

export default async function IntensivesIndex() {
  const all = await listIntensives();

  return (
    <main className="mx-auto px-6 py-10" style={{ maxWidth: 720 }}>
      <header className="mb-10">
        <h1
          className="font-serif tracking-tight leading-[1.1] text-[2.5rem]"
          style={{ fontWeight: 600 }}
        >
          Intensives
        </h1>
        <p className="mt-5 font-serif text-[1.08rem] leading-relaxed text-zinc-700">
          Each running of the programme, and the days it teaches. The material
          itself is the same{" "}
          <Link
            href="/"
            className="text-[var(--link)] underline decoration-1 underline-offset-2 hover:text-[var(--link-hover)]"
          >
            curriculum
          </Link>{" "}
          throughout.
        </p>
      </header>

      {all.length === 0 ? (
        <p className="font-serif text-zinc-500">No intensives listed yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 border-y border-zinc-200">
          {all.map((it) => (
            <li key={it.slug} className="py-4">
              <Link
                href={`/intensives/${it.slug}`}
                className="block font-serif text-[1.25rem] leading-snug hover:text-[var(--link)]"
                style={{ fontWeight: 500 }}
              >
                {it.title} — {it.location}
              </Link>
              <p className="mt-1 font-sans text-[0.85rem] text-zinc-500">
                {formatRange(it.starts, it.ends)}
                {" · "}
                {it.days.length} {it.days.length === 1 ? "day" : "days"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
