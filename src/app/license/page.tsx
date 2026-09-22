import type { Metadata } from "next";
import Link from "next/link";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { MdxBody } from "@/lib/mdx";

export const metadata: Metadata = {
  title: "Licence | Iliad Intensive Curriculum",
};

export default async function LicensePage() {
  const source = await readFile(path.join(process.cwd(), "license.md"), "utf8");

  return (
    <main className="mx-auto w-full px-6 py-10" style={{ maxWidth: 720 }}>
      <Link
        href="/"
        className="font-sans text-xs uppercase tracking-[0.15em] text-zinc-500 hover:text-zinc-800"
      >
        ← Curriculum
      </Link>
      <article className="prose mt-6">
        <MdxBody source={source} />
      </article>
    </main>
  );
}
