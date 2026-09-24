#!/usr/bin/env python3
"""
test_gen_notebooks.py — tests for tex/gen_notebooks.py itself. Run by hand after
changing the generator; no build or CI step runs it.

    python3 tex/test_gen_notebooks.py        (or ./run.sh test-notebooks)

Standard library only, like the generator. Everything runs in a throwaway copy of
the generator (plus notebook-header.md and schedule.yaml) in a temp directory, so
it never touches a module in tex/ or your local notebooks. Two groups:

  scenarios   a scratch module taken through the sync table (every direction, the
              stale-autosave conflict, the Colab round trip, a deleted master),
              importing an arbitrary notebook, image naming and collisions, the
              solutions module and the support/ cells
  real        every master in this repo: already in canonical layout, round-trips
              .py -> local notebook -> .py exactly, and publishes (both versions,
              and a PR preview) with only global URLs left in it

Exit status 1 if anything fails. See docs/NOTEBOOKS.md.
"""

from __future__ import annotations

import base64
import json
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

TEX = Path(__file__).resolve().parent
ROOT = TEX.parent
FAILED: list[str] = []


def check(label: str, cond: bool, detail: str = "") -> None:
    print(("  PASS " if cond else "  FAIL ") + label + ("" if cond else "\n" + detail))
    if not cond:
        FAILED.append(label)


def png(rgb: tuple[int, int, int]) -> bytes:
    """A valid 2x2 PNG of one colour (different colours -> different bytes)."""
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    raw = b"".join(b"\x00" + bytes(rgb) * 2 for _ in range(2))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


class Sandbox:
    """A throwaway repo root holding just what the generator reads."""

    def __init__(self, base: Path):
        self.root = base
        (base / "tex").mkdir(parents=True)
        for f in ("gen_notebooks.py", "notebook-header.md"):
            shutil.copy(TEX / f, base / "tex" / f)
        shutil.copy(ROOT / "schedule.yaml", base / "schedule.yaml")

    def run(self, *args: str) -> tuple[int, str]:
        r = subprocess.run([sys.executable, str(self.root / "tex" / "gen_notebooks.py"), *args],
                           capture_output=True, text=True)
        return r.returncode, (r.stdout + r.stderr).strip()


# ------------------------------------------------------------------ scenarios ----


def scenarios(tmp: Path) -> None:
    print("scenarios")
    box = Sandbox(tmp / "scenarios")
    S = box.root / "tex" / "s"
    (S / "fig").mkdir(parents=True)
    nbfile = S / "demo.ipynb"
    run = lambda: box.run("s")  # noqa: E731
    load = lambda: json.loads(nbfile.read_text())  # noqa: E731
    save = lambda n: nbfile.write_text(json.dumps(n))  # noqa: E731
    py = lambda: (S / "demo.py").read_text()  # noqa: E731

    # import an arbitrary notebook
    (S / "images").mkdir()
    (S / "images" / "local.png").write_bytes(png((200, 0, 0)))
    (S / "data.csv").write_text("a,b\n")
    save({"cells": [
        {"cell_type": "markdown", "metadata": {}, "source": [
            "# Demo\n", "Some text with ''' quotes.\n\n", f"![A green square](data:image/png;base64,{b64(png((0, 200, 0)))})"]},
        {"cell_type": "markdown", "metadata": {}, "source": [
            "![local one](images/local.png)\n", '<img src="images/local.png" width="100" alt="again">']},
        {"cell_type": "code", "metadata": {}, "execution_count": 3,
         "outputs": [{"output_type": "stream", "name": "stdout", "text": ["hi\n"]}],
         "source": ["%pip install torch\n", "!ls\n", "import pandas as pd\n", "df = pd.read_csv('data.csv')"]},
        {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": ["%%bash\n", "echo hi"]},
        {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": []},
        {"cell_type": "raw", "metadata": {}, "source": ["raw stuff"]},
        {"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": ["def f(:\n", "  broken"]},
    ], "metadata": {"accelerator": "GPU", "colab": {"gpuType": "T4", "provenance": []}}, "nbformat": 4, "nbformat_minor": 5})
    code, out = run()
    check("import creates demo.py", code == 0 and (S / "demo.py").exists(), out)
    text = py()
    check("embedded image extracted to fig/, named from its alt text",
          (S / "fig/a-green-square.png").exists() and "fig/a-green-square.png" in text, text[:400])
    check("local image outside fig/ copied in and relinked",
          (S / "fig/local.png").exists() and "](fig/local.png)" in text and 'src="fig/local.png"' in text)
    check("magics and cell magics kept as #%! lines",
          "#%! %pip install torch" in text and "#%! %%bash" in text and "#%! echo hi" in text)
    check("Colab GPU settings kept, the rest of the metadata dropped",
          '"accelerator": "GPU"' in text and "T4" in text and "provenance" not in text)
    check("warns about a code cell reading a local file", "data.csv" in out, out)
    check("outputs dropped", "hi\\n" not in text)
    code, out = run()
    check("second run is a no-op", code == 0 and "←" not in out and "→" not in out, out)

    nbfile.unlink()
    run()
    n = load()
    check("local notebook embeds images as data: URIs", "data:image/png;base64" in json.dumps(n))
    check("local notebook restores magics", "%pip install torch" in "".join(n["cells"][2]["source"]))
    built = box.root / "build" / "notebooks" / "s"
    pub = json.loads((built / "demo_sol.ipynb").read_text())
    check("published notebook links images on the site",
          "https://iliad-intensive.org/uploads/s/nb/a-green-square.png" in json.dumps(pub))
    check("published notebook opens with the header cell",
          "This is the version **with solutions**" in "".join(pub["cells"][0]["source"]))
    body = lambda k: json.loads((built / f"demo_{k}.ipynb").read_text())["cells"][1:]  # noqa: E731
    check("no exercise split: both versions identical after the header", body("sol") == body("nosol"))

    n = load(); n["cells"][5]["source"] = ["raw stuff edited"]; save(n)
    code, out = run()
    check("notebook edit carried into the .py", code == 0 and "raw stuff edited" in py() and "←" in out, out)
    code, out = run()
    check("...then a no-op", code == 0 and "←" not in out and "→" not in out, out)

    n = load(); n["cells"][2]["outputs"] = [{"output_type": "stream", "name": "stdout", "text": ["x"]}]
    n["cells"][2]["execution_count"] = 7; save(n)
    before = py(); code, out = run()
    check("running cells alone changes nothing", code == 0 and py() == before and "←" not in out, out)

    (S / "demo.py").write_text(py().replace("raw stuff edited", "raw stuff py-edit"))
    stale = load()
    code, out = run()
    check("a .py edit rebuilds the notebook, old one kept in .trash/",
          code == 0 and "→" in out and "py-edit" in json.dumps(load()) and any((S / ".trash").iterdir()), out)

    stale["cells"][0]["source"] = ["# Demo stale edit"]; save(stale)
    before = py(); code, out = run()
    check("stale notebook (editor autosave) -> conflict, .py untouched",
          code == 1 and "CONFLICT" in out and py() == before and (S / "demo.from-notebook.py").exists(), out)
    (S / "demo.from-notebook.py").unlink(missing_ok=True); nbfile.unlink(missing_ok=True); run()

    n = load(); n["cells"][5]["source"] = ["nb side"]; save(n)
    (S / "demo.py").write_text(py().replace("raw stuff py-edit", "py side"))
    code, out = run()
    check("both sides edited -> conflict", code == 1 and "both the .py and the notebook changed" in out, out)
    (S / "demo.from-notebook.py").unlink(missing_ok=True); nbfile.unlink(missing_ok=True); run()

    n = load(); n["cells"][5]["source"] = ["colab edit"]; (S / ".demo.sync").unlink(missing_ok=True); save(n)
    code, out = run()
    check("Colab round trip (no stamp, base hash matches) accepted", code == 0 and "colab edit" in py(), out)

    n = load(); n["cells"][1]["source"] = [f"![a green square](data:image/png;base64,{b64(png((0, 0, 200)))})"]; save(n)
    before = py(); code, out = run()
    check("image name taken by a different image -> error, nothing written",
          code == 1 and "already exists with different content" in out and py() == before, out)
    n["cells"][1]["source"] = [f"![image.png](data:image/png;base64,{b64(png((0, 0, 200)))})"]; save(n)
    code, out = run()
    check("image left with an editor's default name -> error", code == 1 and "has no name" in out, out)
    n["cells"][1]["source"] = ["![](attachment:x.png)"]
    n["cells"][1]["attachments"] = {"x.png": {"image/png": b64(png((0, 0, 200)))}}; save(n)
    code, out = run()
    check("unnamed attachment -> error", code == 1 and "has no name" in out, out)
    n["cells"][1]["source"] = ["![A blue square](attachment:x.png)"]; save(n)
    code, out = run()
    check("named attachment extracted", code == 0 and (S / "fig/a-blue-square.png").exists(), out)

    # solutions module, support/ and its path cells
    (S / "support" / "pkg").mkdir(parents=True)
    (S / "support" / "pkg" / "helper.py").write_text("X = 1\n")
    exercise = ("# ! SOLUTIONS: pkg/solutions.py\n# ! CELL TYPE: markdown\n# ! FILTERS: []\n# ! TAGS: []\n\nr'''\n# Split\n'''\n\n"
                "# ! CELL TYPE: code\n# ! FILTERS: []\n# ! TAGS: []\n\n# EXERCISE\n# def f():\n#     pass\n# END EXERCISE\n"
                "# SOLUTION\ndef f():\n    return 42\n# END SOLUTION\n\n"
                "# ! CELL TYPE: markdown\n# ! FILTERS: []\n# ! TAGS: []\n\nr'''\nAfter.\n'''\n")
    (S / "split.py").write_text(exercise)
    code, out = run()
    sol_mod = built / "pkg" / "solutions.py"
    check("# ! SOLUTIONS: publishes the solutions module", code == 0 and sol_mod.exists()
          and "return 42" in sol_mod.read_text(), out)
    check("support/ published next to the notebooks", (built / "pkg" / "helper.py").exists())
    nosol = json.loads((built / "split_nosol.ipynb").read_text())
    sol = json.loads((built / "split_sol.ipynb").read_text())
    src = lambda nb: "\n".join("".join(c["source"]) for c in nb["cells"])  # noqa: E731
    check("exercise split: stub and a Solution dropdown without, the code with",
          "def f():\n    pass" in src(nosol) and "<summary>Solution</summary>" in src(nosol)
          and "return 42" in src(sol) and "pass" not in src(sol))
    check("published notebooks get the Colab fetch cell",
          'git sparse-checkout set "s"' in "".join(sol["cells"][1]["source"]))
    check("the fetch cell is identical in both versions (no doubled newlines)",
          nosol["cells"][1]["source"] == sol["cells"][1]["source"]
          and not any(line.endswith("\n\n") for line in sol["cells"][1]["source"]))
    local = json.loads((S / "split.ipynb").read_text())
    check("local notebook starts with the marked sys.path cell",
          "build/notebooks/s" in "".join(local["cells"][0]["source"]))
    code, out = run()
    check("...which is not synced back (second run a no-op)", code == 0 and "←" not in out, out)
    code, out = box.run("--publish", "--preview", "7", "s")
    sol = json.loads((built / "split_sol.ipynb").read_text())
    check("--preview: links and fetch cell point at pr-preview/pr-7/",
          code == 0 and "pr-preview/pr-7/s" in "".join(sol["cells"][1]["source"])
          and "blob/notebooks/pr-preview/pr-7/s/split_nosol.ipynb" in "".join(sol["cells"][0]["source"]), out)

    (S / "demo.py").unlink()
    code, out = run()
    check("deleted master: its notebook is not re-imported", code == 0 and not (S / "demo.py").exists()
          and "deleted" in out, out)


# ---------------------------------------------------------------- real masters ----


def real_masters(tmp: Path) -> None:
    print("real masters")
    box = Sandbox(tmp / "real")
    masters = [p for p in sorted(TEX.glob("*/*.py"))
               if p.read_text(encoding="utf-8").startswith("# ! ")]
    if not masters:
        print("  (no masters in tex/)")
        return
    for slug_dir in sorted({m.parent for m in masters}):
        # the committed files only: sources, fig/, support/ — no local notebooks or stamps
        dest = box.root / "tex" / slug_dir.name
        shutil.copytree(slug_dir, dest, ignore=shutil.ignore_patterns(
            "*.ipynb", ".*.sync", ".trash", "*.from-notebook.py", "*.aux", "*.log", "*.pdf"))
    for m in masters:
        rel = f"{m.parent.name}/{m.stem}"
        copy = box.root / "tex" / m.parent.name / m.name
        original = copy.read_text(encoding="utf-8")
        code, out = box.run(m.parent.name)
        check(f"{rel}: syncs cleanly", code == 0, out)
        check(f"{rel}: committed in canonical layout (sync didn't rewrite it)",
              copy.read_text(encoding="utf-8") == original, out)
        stamp = json.loads((copy.parent / f".{m.stem}.sync").read_text())
        check(f"{rel}: .py -> local notebook -> .py is exact", stamp["py"] == stamp["nb"], json.dumps(stamp))
        code, out = box.run(m.parent.name)
        check(f"{rel}: second run is a no-op", code == 0 and "←" not in out and "→" not in out, out)
        for preview in ([], ["--preview", "1"]):
            code, out = box.run("--publish", *preview, m.parent.name)
            for kind in ("nosol", "sol"):
                path = box.root / "build" / "notebooks" / m.parent.name / f"{m.stem}_{kind}.ipynb"
                body = path.read_text(encoding="utf-8") if path.exists() else ""
                ok = code == 0 and body and json.loads(body) and not any(
                    s in body for s in ('](fig/', 'src=\\"fig/', "data:image/", "attachment:"))
                check(f"{rel}: publishes {kind}{' (preview)' if preview else ''} with only global URLs", bool(ok), out)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="gen-notebooks-test-") as t:
        scenarios(Path(t))
        real_masters(Path(t))
    print(f"\n{'FAILED: ' + str(len(FAILED)) if FAILED else 'all passed'}")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
