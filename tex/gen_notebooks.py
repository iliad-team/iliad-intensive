#!/usr/bin/env python3
"""
gen_notebooks.py — master .py files <-> Colab notebooks. See docs/NOTEBOOKS.md.

A *master* is a .py directly in tex/<slug>/ whose first line starts with "# ! ".
It is the only thing committed; every notebook is built from it.

    python3 tex/gen_notebooks.py [slug ...]            sync, then build the published notebooks
    python3 tex/gen_notebooks.py --publish [slug ...]  CI: build published notebooks only
    python3 tex/gen_notebooks.py --publish --preview N  CI: the same, for PR N's preview

Sync, per master <name>.py and its local <name>.ipynb (gitignored), works out which
side changed since the last run and carries the change across. When both changed it
writes nothing and saves the notebook's version as <name>.from-notebook.py instead.
A notebook with no .py next to it is imported (a .py is created from it).

Published notebooks land in build/notebooks/<slug>/<name>_{nosol,sol}.ipynb, next to
a copy of tex/<slug>/support/. --publish only ever reads masters, so it can never
destroy work.

The cell format and the exercise/solution processing are ARENA's (the generator
iliad-team/iliad-intensive-E.3 and -D.2 used, gen/core/), trimmed to the Colab
outputs: no Streamlit pages, no solutions .py, no required section/title cells.

Standard library only.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import mimetypes
import re
import shutil
import sys
import time
from copy import deepcopy
from pathlib import Path

TEX = Path(__file__).resolve().parent
ROOT = TEX.parent
BUILD = ROOT / "build" / "notebooks"

# Where published notebooks and their images are served from. Change these two
# lines, and nothing else here, if the branch, repo or domain ever moves
# (scripts/build-content.mjs and the two .sty files build the same Colab URL).
# {preview} is "" for production and "pr-preview/pr-<N>/" for a PR preview (--preview N):
# the PR's notebooks sit under that folder of the `notebooks` branch, and their
# images under the same folder of the site preview.
REPO, BRANCH = "iliad-team/iliad-intensive", "notebooks"
COLAB_URL = f"https://colab.research.google.com/github/{REPO}/blob/{BRANCH}/{{preview}}{{slug}}/{{name}}_{{kind}}.ipynb"
IMAGE_URL = "https://iliad-intensive.org/{preview}uploads/{slug}/nb/{path}"
PREVIEW = ""  # set from --preview

CELL_HEADER = "# ! CELL TYPE:"
NOTEBOOK_HEADER = "# ! NOTEBOOK:"
# `# ! SOLUTIONS: <path>`: also publish ARENA's solutions module (every solution and
# `py`-filtered cell, as plain Python) at <path> inside the published folder, e.g.
# part6_goalmisgen/solutions.py when the support modules' tests import it.
SOLUTIONS_HEADER = "# ! SOLUTIONS:"
SOLUTIONS_KEY = "solutions"  # its key in the parsed metadata and in metadata.iliad
MAGIC = "#%! "  # prefix that keeps IPython magics (%pip, !ls, %%bash) valid Python in a master
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*$")
CELL_TYPES = ("code", "markdown", "raw")
KEEP_NB_METADATA = ("accelerator",)  # top-level notebook metadata a master keeps
KEEP_COLAB_METADATA = ("gpuType",)  # ...and under metadata.colab
TRASH_KEEP = 5
DEFAULT_ALT = re.compile(r"^(image|img|picture|screenshot|alt text|untitled)([ _-]?\d+)?(\.\w+)?$", re.I)
EXT_FOR_MIME = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/svg+xml": "svg", "image/webp": "webp"}
CODE_FILE_RE = re.compile(r"""["']([\w./-]+\.(?:png|jpe?g|gif|svg|webp|csv|tsv|json|npy|npz|pt|pth|pkl|txt|parquet))["']""")


class ConvertError(Exception):
    pass


def sha(data: str | bytes) -> str:
    return hashlib.sha256(data.encode() if isinstance(data, str) else data).hexdigest()[:16]


# ---------------------------------------------------------------- cells ----


class Cell:
    """One cell: type, ARENA filters and tags, and its source as notebook lines (no newlines)."""

    def __init__(self, cell_type: str, source: list[str], filters=(), tags=(), where: str = ""):
        if cell_type not in CELL_TYPES:
            raise ConvertError(f"{where}: unknown cell type {cell_type!r}")
        self.cell_type = cell_type
        self.source = list(source)
        self.filters = [f for f in filters if f]
        self.tags = [t for t in tags if t]
        self.where = where


def is_master(path: Path) -> bool:
    if path.suffix != ".py" or not path.is_file():
        return False
    with path.open(encoding="utf-8") as f:
        return f.readline().startswith("# ! ")


def strip_blank_ends(lines: list[str]) -> list[str]:
    lines = list(lines)
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return lines


def parse_master(text: str, where: str) -> tuple[dict, list[Cell]]:
    """Master .py text -> (kept notebook metadata, cells)."""
    lines = text.splitlines()
    meta = {}
    while lines and lines[0].startswith((NOTEBOOK_HEADER, SOLUTIONS_HEADER)):
        if lines[0].startswith(SOLUTIONS_HEADER):
            meta[SOLUTIONS_KEY] = check_solutions_path(lines[0][len(SOLUTIONS_HEADER):].strip(), where)
        else:
            try:
                meta.update(json.loads(lines[0][len(NOTEBOOK_HEADER):]))
            except json.JSONDecodeError as e:
                raise ConvertError(f"{where}:1: bad {NOTEBOOK_HEADER} line: {e}") from e
        lines = lines[1:]
    starts = [i for i, line in enumerate(lines) if line.startswith(CELL_HEADER)]
    if not starts or any(line.strip() for line in lines[: starts[0]]):
        raise ConvertError(f"{where}: a master must start with a '{CELL_HEADER}' line")
    offset = len(text.splitlines()) - len(lines)
    cells = []
    for start, end in zip(starts, starts[1:] + [len(lines)]):
        at = f"{where}:{start + offset + 1}"
        cell_type = lines[start][len(CELL_HEADER):].strip()
        filters = tags = []
        body = start + 1
        if body < end and lines[body].startswith("# ! FILTERS:"):
            filters = _bracket_list(lines[body], "# ! FILTERS:", at)
            body += 1
        if body < end and lines[body].startswith("# ! TAGS:"):
            tags = _bracket_list(lines[body], "# ! TAGS:", at)
            body += 1
        content = strip_blank_ends(lines[body:end])
        if cell_type in ("markdown", "raw"):
            if not content:
                raise ConvertError(f"{at}: {cell_type} cell must be wrapped in r'''...'''")
            first, last = content[0].strip(), content[-1].strip()
            quote = next((q for q in ("'''", '"""') if first == "r" + q and last == q and len(content) >= 2), None)
            if quote is None:
                raise ConvertError(f"{at}: {cell_type} cell must be wrapped in r'''...''' "
                                   "(with a blank line before the next '# ! CELL TYPE')")
            content = [line.replace(r"\'\'\'", "'''") for line in content[1:-1]]
        else:
            content = [line[len(MAGIC):] if line.startswith(MAGIC) else line for line in content]
        cells.append(Cell(cell_type, content, filters, tags, at))
    return meta, cells


def check_solutions_path(path: str, where: str) -> str:
    if not re.fullmatch(r"[\w-]+(/[\w-]+)*\.py", path):
        raise ConvertError(f"{where}: {SOLUTIONS_HEADER} wants a relative path like "
                           f"'package/solutions.py', got {path!r}")
    return path


def colab_meta(meta: dict) -> dict:
    """The notebook metadata a master keeps for Colab, without the build's own keys."""
    return {k: v for k, v in meta.items() if k != SOLUTIONS_KEY}


def _bracket_list(line: str, prefix: str, at: str) -> list[str]:
    rest = line[len(prefix):].strip()
    if not (rest.startswith("[") and rest.endswith("]")):
        raise ConvertError(f"{at}: expected '{prefix} [...]'")
    return [x.strip() for x in rest[1:-1].split(",") if x.strip()]


def serialize_master(meta: dict, cells: list[Cell]) -> str:
    """The canonical text of a master. parse_master(serialize_master(x)) == x."""
    out = []
    if colab_meta(meta):
        out.append(NOTEBOOK_HEADER + " " + json.dumps(colab_meta(meta), sort_keys=True))
    if meta.get(SOLUTIONS_KEY):
        out.append(f"{SOLUTIONS_HEADER} {meta[SOLUTIONS_KEY]}")
    for cell in cells:
        for line in cell.source:
            if line.startswith((CELL_HEADER, NOTEBOOK_HEADER, SOLUTIONS_HEADER)):
                raise ConvertError(f"{cell.where}: a line in the cell starts with '{line[:13]}', "
                                   "which would split the master there; indent it or reword it")
        out += [f"{CELL_HEADER} {cell.cell_type}", f"# ! FILTERS: [{','.join(cell.filters)}]",
                f"# ! TAGS: [{','.join(cell.tags)}]", ""]
        if cell.cell_type == "code":
            out += [mark_magic(line, cell) for line in cell.source]
        else:
            out += ["r'''", *[line.replace("'''", r"\'\'\'") for line in cell.source], "'''"]
        out.append("")
    return "\n".join(out)


def mark_magic(line: str, cell: Cell) -> str:
    """Comment out IPython syntax so the master stays valid Python; parse_master undoes it."""
    first = next((s for s in cell.source if s.strip()), "")
    if first.lstrip().startswith("%%") or line.lstrip().startswith(("%", "!")):
        return MAGIC + line
    return line


# ------------------------------------------------------------- images ----

MD_IMG = re.compile(r'!\[(?P<alt>[^\]]*)\]\(\s*<?(?P<src>[^)\s>]+)>?(?P<title>\s+"[^"]*")?\s*\)')
HTML_IMG = re.compile(r"<img\b[^>]*>", re.I)


def _attr(tag: str, name: str) -> re.Match | None:
    return re.search(rf"""\b{name}\s*=\s*(?:"(?P<v>[^"]*)"|'(?P<w>[^']*)')""", tag, re.I)


def map_images(text: str, fn) -> str:
    """Rewrite every image src in a markdown cell's text: fn(src, alt) -> new src."""
    def md(m):
        new = fn(m["src"], m["alt"])
        return m.group(0).replace(m["src"], new, 1) if new != m["src"] else m.group(0)

    def html(m):
        tag = m.group(0)
        src = _attr(tag, "src")
        if not src:
            return tag
        value = src["v"] if src["v"] is not None else src["w"]
        alt = _attr(tag, "alt")
        new = fn(value, (alt["v"] if alt["v"] is not None else alt["w"]) if alt else "")
        return tag[: src.start()] + src.group(0).replace(value, new, 1) + tag[src.end():]

    return HTML_IMG.sub(html, MD_IMG.sub(md, text))


def is_remote(src: str) -> bool:
    return src.startswith(("http://", "https://", "//"))


def data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode()}"


def decode_data_uri(src: str, where: str) -> tuple[str, bytes]:
    m = re.match(r"data:([\w/+.-]+)(;[^,]*)?,(.*)$", src, re.S)
    if not m or "base64" not in (m[2] or ""):
        raise ConvertError(f"{where}: can't read embedded image {src[:40]}...")
    return m[1], base64.b64decode(m[3])


def slugify(alt: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", alt.lower()).strip("-")
    return s[:60].rstrip("-")


class FigStore:
    """The slug's fig/ folder, seen from a notebook -> master conversion.

    Nothing is written until commit(), so a conversion can be run just to compare.
    """

    def __init__(self, slug_dir: Path):
        self.slug_dir = slug_dir
        self.fig = slug_dir / "fig"
        self.by_hash = {}
        if self.fig.is_dir():
            for p in sorted(self.fig.rglob("*")):
                if p.is_file():
                    self.by_hash.setdefault(sha(p.read_bytes()), p.relative_to(self.slug_dir).as_posix())
        self.pending: dict[str, bytes] = {}  # "fig/x.png" -> bytes, to write on commit()

    def add(self, data: bytes, rel: str, where: str) -> str:
        h = sha(data)
        if h in self.by_hash:
            return self.by_hash[h]
        target = self.slug_dir / rel
        if rel in self.pending or target.exists():
            other = self.pending.get(rel) or target.read_bytes()
            if other != data:
                raise ConvertError(f"{where}: {rel} already exists with different content — "
                                   "give the image a different name (alt text), or replace the file directly")
        self.pending[rel] = data
        self.by_hash[h] = rel
        return rel

    def commit(self) -> list[str]:
        for rel, data in self.pending.items():
            path = self.slug_dir / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        written, self.pending = sorted(self.pending), {}
        return written


def image_to_master(src: str, alt: str, cell: dict, store: FigStore, where: str) -> str:
    """One image src in a notebook -> the src the master should hold."""
    if is_remote(src):
        return src
    if src.startswith("data:") or src.startswith("attachment:"):
        if src.startswith("attachment:"):
            name = src[len("attachment:"):]
            att = (cell.get("attachments") or {}).get(name)
            if not att:
                raise ConvertError(f"{where}: image refers to a missing attachment {name!r}")
            mime, b64 = next(iter(att.items()))
            data = base64.b64decode("".join(b64) if isinstance(b64, list) else b64)
        else:
            mime, data = decode_data_uri(src, where)
        known = store.by_hash.get(sha(data))
        if known:
            return known
        if not alt.strip() or DEFAULT_ALT.match(alt.strip()) or not slugify(alt):
            raise ConvertError(f"{where}: image has no name — give it alt text, e.g. "
                               "![what it shows](...) or <img alt=\"what it shows\" ...>")
        ext = EXT_FOR_MIME.get(mime) or (mimetypes.guess_extension(mime) or ".bin").lstrip(".")
        return store.add(data, f"fig/{slugify(alt)}.{ext}", where)
    rel = src.split("#")[0].split("?")[0]
    path = (store.slug_dir / rel).resolve()
    if not path.is_file():
        raise ConvertError(f"{where}: image file {src!r} not found (paths are relative to {store.slug_dir.name}/)")
    if path.suffix.lower() == ".pdf":
        raise ConvertError(f"{where}: {src} is a PDF, which a notebook can't display — use a PNG/SVG")
    if path.is_relative_to(store.fig.resolve()):
        return path.relative_to(store.slug_dir.resolve()).as_posix()
    return store.add(path.read_bytes(), f"fig/{path.name}", where)


def image_for_local(src: str, slug_dir: Path, where: str) -> str:
    if src.startswith("fig/"):
        path = slug_dir / src
        if not path.is_file():
            raise ConvertError(f"{where}: {src} does not exist")
        return data_uri(path)
    return src


def image_for_publish(src: str, slug: str, slug_dir: Path, where: str) -> str:
    if is_remote(src):
        return src
    if src.startswith("fig/"):
        if not (slug_dir / src).is_file():
            raise ConvertError(f"{where}: {src} does not exist")
        return IMAGE_URL.format(preview=PREVIEW, slug=slug, path=src[len("fig/"):])
    raise ConvertError(f"{where}: image {src[:60]!r} is not in fig/ — published notebooks may only "
                       "link images from fig/ or the web")


# ----------------------------------------------------- notebook <-> master ----


def notebook_to_master(nb: dict, store: FigStore, where: str) -> tuple[str, list[str]]:
    """A notebook (any notebook) -> (master text, warnings). Images go to `store`, uncommitted."""
    warnings = []
    cells = []
    for i, c in enumerate(nb.get("cells", []), 1):
        at = f"{where} cell {i}"
        cell_type = c.get("cell_type")
        source = c.get("source", "")
        text = "".join(source) if isinstance(source, list) else source
        if (c.get("metadata") or {}).get("iliad", {}).get("generated") or text.startswith(LOCAL_PATH_MARK):
            continue  # a cell this tool added to the local notebook, not the author's
        lines = text.split("\n")
        filters, tags = [], []
        prefix = "# " if cell_type == "code" else ""
        # ARENA keeps a cell's filters/tags as its first lines in the notebook, then a
        # blank line. Without the blank line, a leading FILTERS: is an inline filter.
        n = 0
        while n < len(lines) and re.match(rf"^{re.escape(prefix)}(FILTERS|TAGS): ", lines[n]):
            n += 1
        if n and (n == len(lines) or not lines[n].strip()):
            for line in lines[:n]:
                key, _, value = line[len(prefix):].partition(": ")
                (filters if key == "FILTERS" else tags).extend(x.strip() for x in value.split(",") if x.strip())
            lines = lines[n + 1:]
        if cell_type == "markdown":
            text = map_images("\n".join(lines), lambda s, a: image_to_master(s, a, c, store, at))
            lines = text.split("\n")
        elif cell_type == "code":
            for m in CODE_FILE_RE.finditer("\n".join(lines)):
                if not m[1].startswith("support/") and (store.slug_dir / m[1]).exists():
                    warnings.append(f"{at}: reads {m[1]}, which won't exist on Colab — move it into "
                                    "support/ (or, for an image, show it as a markdown image from fig/)")
        cells.append(Cell(cell_type, strip_blank_ends(lines) if cell_type == "code" else lines, filters, tags, at))
    # markdown keeps its inner whitespace, but not leading/trailing blank lines (as ARENA)
    for cell in cells:
        if cell.cell_type != "code":
            cell.source = strip_blank_ends(cell.source)
    meta = {k: nb["metadata"][k] for k in KEEP_NB_METADATA if k in nb.get("metadata", {})}
    colab = {k: v for k, v in nb.get("metadata", {}).get("colab", {}).items() if k in KEEP_COLAB_METADATA}
    if colab:
        meta["colab"] = colab
    if solutions := nb.get("metadata", {}).get("iliad", {}).get(SOLUTIONS_KEY):
        meta[SOLUTIONS_KEY] = check_solutions_path(solutions, where)
    return serialize_master(meta, cells), warnings


def nb_json(cells: list[dict], meta: dict, extra: dict | None = None) -> str:
    metadata = {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python"},
        **deepcopy(meta),
        **(extra or {}),
    }
    for c in cells:
        src = c["source"]
        c["source"] = [line + "\n" for line in src[:-1]] + [src[-1]] if src else []
    return json.dumps({"cells": cells, "metadata": metadata, "nbformat": 4, "nbformat_minor": 5},
                      indent=1, ensure_ascii=False) + "\n"


def master_to_local_notebook(text: str, slug_dir: Path, where: str) -> str:
    """Master -> the editable local notebook: every cell, filters/tags as first lines, images embedded."""
    meta, cells = parse_master(text, where)
    out = []
    for i, cell in enumerate(cells, 1):
        source = list(cell.source)
        if cell.cell_type == "markdown":
            source = map_images("\n".join(source), lambda s, a: image_for_local(s, slug_dir, cell.where)).split("\n")
        prefix = "# " if cell.cell_type == "code" else ""
        head = ([f"{prefix}FILTERS: {','.join(cell.filters)}"] if cell.filters else []) + \
               ([f"{prefix}TAGS: {','.join(cell.tags)}"] if cell.tags else [])
        if head:
            source = head + [""] + source
        c = {"cell_type": cell.cell_type, "id": f"c{i:03d}", "metadata": {}, "source": source}
        if cell.cell_type == "code":
            c.update(execution_count=None, outputs=[])
        out.append(c)
    if (slug_dir / "support").is_dir() or meta.get(SOLUTIONS_KEY):
        # So the local notebook can import the support modules and the solutions
        # module: both sit in build/notebooks/<slug>/ once published (which every
        # run of this tool does). Marked, and skipped when syncing back.
        published = Path("..", "..", "build", "notebooks", slug_dir.name).as_posix()
        out.insert(0, {"cell_type": "code", "id": "iliad-path", "execution_count": None, "outputs": [],
                       "metadata": {"iliad": {"generated": True}},
                       "source": [LOCAL_PATH_MARK, "import sys", f'sys.path.insert(0, "{published}")']})
    iliad = {"base": sha(text), **({SOLUTIONS_KEY: meta[SOLUTIONS_KEY]} if meta.get(SOLUTIONS_KEY) else {})}
    return nb_json(out, colab_meta(meta), {"iliad": iliad})


LOCAL_PATH_MARK = "# Added by tex/gen_notebooks.py so this local notebook finds its support modules; not synced."


# ------------------------------------------------ published notebooks ----
# ARENA's filter/exercise machinery (gen/core/conversion/cell.py), kept for the two
# Colab outputs. "streamlit" and "python" stay valid filter names so ARENA masters
# keep their meaning; this generator just never writes those files.

ALL_FILES = ["colab-soln", "colab-ex", "streamlit", "python"]
ABBREVS = {"soln": "colab-soln", "ex": "colab-ex", "st": "streamlit", "py": "python"}


def de_abbreviate(filters: list[str], where: str) -> list[str]:
    table = {"": ALL_FILES + ["soln-dropdown"], "colab": ["colab-ex", "colab-soln"],
             **{a: [f] for a, f in ABBREVS.items()}, **{f: [f] for f in ALL_FILES + ["soln-dropdown"]}}
    out = []
    for f in filters:
        sign, name = ("~", f[1:]) if f.startswith("~") else ("", f)
        if name not in table:
            raise ConvertError(f"{where}: unknown filter {f!r} (known: colab, ex, soln, ~…)")
        out += [sign + x for x in table[name]]
    return out


def is_exercise_cell(cell: Cell) -> bool:
    return cell.cell_type == "code" and any(
        s.strip().lstrip("# ").removeprefix("END ") in ("EXERCISE", "SOLUTION") for s in cell.source)


def matching_files(cell: Cell, filters: list[str]) -> set[str]:
    files = set(ALL_FILES) if (not filters or filters[0].startswith("~")) else set()
    if is_exercise_cell(cell):
        files.add("soln-dropdown")
    filters = de_abbreviate(filters, cell.where)
    if cell.cell_type != "code":
        filters.append("~python")
    for f in filters:
        files.discard(f[1:]) if f.startswith("~") else files.add(f)
    return files


def check_markers(cell: Cell) -> None:
    source = [s.replace("FILTERS END", "END FILTERS") for s in cell.source]
    starts = [s for s in source if s.strip().lstrip("# ").startswith("FILTERS: ")]
    ends = [s for s in source if s.strip().lstrip("# ") == "END FILTERS"]
    if len(starts) != len(ends):
        raise ConvertError(f"{cell.where}: {len(starts)} inline 'FILTERS:' but {len(ends)} 'END FILTERS'")
    if is_exercise_cell(cell):
        if cell.filters:
            raise ConvertError(f"{cell.where}: an EXERCISE/SOLUTION cell can't also have cell-level filters")
        for word in ("SOLUTION", "EXERCISE", "HIDE"):
            source = [s.replace(f"# {word} END", f"# END {word}") for s in source]
            n_start = sum(s.strip().lstrip("# ") == word for s in source)
            n_end = sum(s.strip().lstrip("# ") == f"END {word}" for s in source)
            if word == "HIDE" and n_start == n_end + 1:
                source.append("# END HIDE")
                n_end += 1
            if n_start != n_end or (n_start == 0 and word != "HIDE"):
                raise ConvertError(f"{cell.where}: # {word} ... # END {word} don't match "
                                   f"({n_start} opening, {n_end} closing)")
    cell.source = source


def split_by_filters(cell: Cell) -> dict[str, list[str] | None]:
    names = ["colab-ex", "colab-soln", "streamlit", "python", "soln-dropdown"]
    files = {n: [] for n in names}
    stack = [cell.filters]
    count = {n: 0 for n in names + ["source"]}
    for i, line in enumerate(cell.source + ["END FILTERS"]):
        current = matching_files(cell, [f for s in stack for f in s])
        stripped = line.strip().lstrip("# " if cell.cell_type == "code" else "")
        if cell.cell_type == "code" and any(stripped.endswith(s) for s in ("EXERCISE", "SOLUTION", "HIDE")) \
                and stripped.removeprefix("END ") in ("EXERCISE", "SOLUTION", "HIDE"):
            stripped = {"EXERCISE": "FILTERS: ~,colab-ex,streamlit", "SOLUTION": "FILTERS: ~colab-ex,~streamlit",
                        "HIDE": "FILTERS: ~soln-dropdown",
                        **{f"END {k}": "END FILTERS" for k in ("EXERCISE", "SOLUTION", "HIDE")}}[stripped]
        if stripped.startswith("FILTERS: "):
            stack.append(stripped.split(": ", 1)[1].split(","))
            count = {n: 0 for n in names + ["source"]}
        elif stripped == "END FILTERS":
            inside = cell.source[i - count["source"]: i]
            all_commented = all(s.strip().startswith("# ") or not s.strip() for s in inside)
            if cell.cell_type == "code" and all_commented and "master-comment" not in cell.tags:
                for f in current:
                    for j in range(count[f]):
                        files[f][-j - 1] = files[f][-j - 1].replace("# ", "", 1)
            stack.pop()
        else:
            count["source"] += 1
            for f in current:
                files[f].append(line)
                count[f] += 1
    return {n: (f or None) for n, f in files.items()}


def strip_main_blocks(source: list[str]) -> list[str]:
    out, in_main = [], False
    for line in source:
        if line.strip() == "if MAIN:":
            in_main = True
        elif in_main and line.startswith(("    ", "\t")):
            out.append(line[4:] if line.startswith("    ") else line[1:])
        else:
            out.append(line)
            in_main = False if in_main and line.strip() else in_main
    return out


def tidy(source: list[str] | None, strip_main: bool = True) -> list[str] | None:
    if source is None:
        return None
    source = [s for s in source if not re.match(r"^\s*FLAG_\w+\s*=", s)]
    source = [re.sub(r"^(\s*)if\s+MAIN\s+and\s+.*FLAG.*:(.*)$", r"\1if MAIN:\2", s) for s in source]
    if strip_main:
        source = strip_main_blocks(source)
    out, blanks = [], 0
    for line in strip_blank_ends(source):
        blanks = blanks + 1 if not line.strip() else 0
        if blanks <= 2:
            out.append(line)
    return out or None


def code_cell(source):
    return {"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": source}


def md_cell(source):
    return {"cell_type": "markdown", "metadata": {}, "source": source}


def publish_cells(cells: list[Cell], slug: str, name: str, slug_dir: Path
                  ) -> tuple[list[dict], list[dict], bool, list[str]]:
    """Master cells -> (nosol cells, sol cells, has_split, solutions-module lines)."""
    has_split = any(is_exercise_cell(c) for c in cells)
    ex, sol = [], []
    py = ["# %%\n\n"]  # ARENA's solutions module: code cells as the "python" output, # %%-separated
    dropdown = None  # the last exercise's solution, waiting for the next markdown cell
    prev_was_code = False
    titled = False
    stage = None  # ARENA's chapter tracking: None -> "title" -> "intro" -> 1, 2, ... (one-line "# " cells)
    objectives = {}  # chapter number -> its learning objectives, from a "Content & Learning Objectives" cell
    for cell in cells:
        cell = deepcopy(cell)
        check_markers(cell)
        content = "\n".join(cell.source)
        header = cell.cell_type == "markdown" and len(cell.source) == 1 and cell.source[0].startswith("# ")
        if header:
            stage = "title" if stage is None else "intro" if stage == "title" else 1 if stage == "intro" else stage + 1
        if cell.cell_type == "markdown" and cell.source and "Content & Learning Objectives" in cell.source[0]:
            found = re.findall(r"> ##### Learning Objectives\n>.*?\n>(.*?)(?=\n\n|$)", content, re.DOTALL)
            objectives = {i: f"> ##### Learning Objectives\n>\n>{m}".split("\n") for i, m in enumerate(found, 1)}
        if cell.cell_type == "raw":
            files = matching_files(cell, cell.filters)
            for key, out in (("colab-ex", ex), ("colab-soln", sol)):
                if key in files and cell.source:
                    out.append({"cell_type": "raw", "metadata": {}, "source": list(cell.source)})
            continue
        if cell.cell_type == "code":
            files = split_by_filters(cell)
            if "master-comment" in cell.tags:
                files = {n: [s.removeprefix("# ") for s in f] if f else None for n, f in files.items()}
            keep_main = "keep-main" in cell.tags
            if files["python"]:
                lines = (["if MAIN:"] + ["    " + s for s in files["python"]]) if "main" in cell.tags else files["python"]
                lines = [s for s in (tidy(lines, strip_main=False) or []) if "# COLAB-SPLIT" not in s]
                if lines:
                    py += lines + ["\n# %%\n"]
            for key, out in (("colab-ex", ex), ("colab-soln", sol)):
                src = tidy(files[key], strip_main=not keep_main)
                if not src:
                    continue
                splits = [i for i, s in enumerate(src) if "# COLAB-SPLIT" in s]
                for a, b in zip([-1] + splits, splits + [len(src)]):
                    part = tidy(src[a + 1: b], strip_main=not keep_main)
                    if part:
                        out.append(code_cell(part))
            if is_exercise_cell(cell):
                soln = tidy(files["soln-dropdown"])
                if soln:
                    splits = [i for i, s in enumerate(soln) if "# COLAB-SPLIT" in s]
                    dropdown = soln[: splits[0]] if splits else soln
            prev_was_code = True
            continue

        # markdown
        files = split_by_filters(cell)
        text = {k: files[k] for k in ("colab-ex", "colab-soln")}
        new_before = None
        if dropdown and "colab-ex" in matching_files(cell, cell.filters) and text["colab-ex"] is not None:
            full = ["<details><summary>Solution</summary>", "", "```python", *dropdown, "```", "</details>"]
            content = "\n".join(cell.source).strip()
            if "<details><summary>Solution" in content.replace("\n", ""):
                text["colab-soln"] = None
                hits = [i for i, s in enumerate(text["colab-ex"]) if "SOLUTION" in s]
                if len(hits) > 1:
                    raise ConvertError(f"{cell.where}: more than one SOLUTION placeholder")
                if hits:
                    text["colab-ex"] = text["colab-ex"][: hits[0]] + dropdown + text["colab-ex"][hits[0] + 1:]
            elif content.startswith("<details>") and content.endswith("</details>"):
                text["colab-ex"] = text["colab-ex"] + ["", ""] + full
            else:
                new_before = full
            dropdown = None
        if not titled and has_split:
            first = next((s for s in cell.source if s.strip()), "")
            if first.startswith("# "):
                titled = True
                for key, suffix in (("colab-ex", " (exercises)"), ("colab-soln", " (solutions)")):
                    if text[key]:
                        i = next(j for j, s in enumerate(text[key]) if s.strip())
                        text[key] = text[key][:i] + [text[key][i] + suffix] + text[key][i + 1:]
        for key in text:
            if text[key]:
                text[key] = map_images("\n".join(text[key]),
                                       lambda s, a: image_for_publish(s, slug, slug_dir, cell.where)).split("\n")
        for key, out in (("colab-ex", ex), ("colab-soln", sol)):
            src = tidy(text[key], strip_main=False)
            if src is None:
                continue
            if "html" in cell.tags:
                if not prev_was_code or not out or out[-1]["cell_type"] != "code":
                    raise ConvertError(f"{cell.where}: 'TAGS: html' must follow a code cell")
                out[-1]["outputs"] = [{"data": {"text/html": ["\n".join(src)],
                                                "text/plain": ["<IPython.core.display.HTML object>"]},
                                       "metadata": {}, "output_type": "display_data"}]
                continue
            if key == "colab-ex" and new_before:
                out.append(md_cell(list(new_before)))
            if header and isinstance(stage, int) and stage in objectives:
                src = src + ["", *objectives[stage]]
            out.append(md_cell(src))
        prev_was_code = False
    return ex, sol, has_split, py


HEADER_TEMPLATE = TEX / "notebook-header.md"
SITE = "https://iliad-intensive.org"


def schedule_pages() -> dict[str, tuple[str, str]]:
    """slug -> (day label, page path) from schedule.yaml, e.g. ("E.3 · Worst-Case
    Interpretability", "/safety/worst-case-interp/").

    A deliberately small reader for the file's one shape (clusters -> days ->
    worksheets), so this script stays standard-library only. scripts/schedule.mjs
    is the real parser and validates the file on every site build; if the two ever
    disagree about a page's URL, it is this function that needs fixing.
    """
    pages = {}
    cluster = code = title = None
    in_sheets = None  # indentation of the current `worksheets:` key
    for raw in (ROOT / "schedule.yaml").read_text(encoding="utf-8").splitlines():
        line = re.sub(r"\s+#.*$", "", raw) if not raw.lstrip().startswith("#") else ""
        if not line.strip():
            continue
        indent = len(line) - len(line.lstrip())
        value = lambda m: m.group(1).strip().strip("\"'")
        if in_sheets is not None and indent <= in_sheets:
            in_sheets = None
        if m := re.match(r"^\s*urlSlug:\s*(.+)$", line):
            cluster = value(m)
        elif m := re.match(r"^\s*-\s*code:\s*(.+)$", line):
            code, title = value(m), None
        elif m := re.match(r"^\s*title:\s*(.+)$", line):
            title = value(m)
        elif m := re.match(r"^(\s*)worksheets:\s*(\[.*\])?\s*$", line):
            in_sheets = len(m.group(1))
            for sheet in re.findall(r"[\w.-]+", m.group(2) or ""):
                pages[sheet] = (f"{code} · {title}" if title else str(code), f"/{cluster}/{sheet}/")
        elif in_sheets is not None and (m := re.match(r"^\s*-\s*([\w.-]+)\s*$", line)):
            pages[m.group(1)] = (f"{code} · {title}" if title else str(code), f"/{cluster}/{m.group(1)}/")
    return pages


def fetch_cell(slug: str) -> dict:
    """On Colab, fetch this notebook's published folder (support modules, solutions module)
    from the notebooks branch and put it on sys.path. The second cell of a published
    notebook whose module has support/ or a solutions module; PR previews fetch their own."""
    folder = f"{PREVIEW}{slug}"
    return code_cell([
        "# Fetch the modules this notebook imports (Colab only). Added by the build.",
        "import os",
        "import sys",
        "",
        'if "google.colab" in sys.modules:',
        '    if not os.path.isdir("/content/iliad"):',
        f"        !git clone -q --depth 1 -b {BRANCH} --filter=blob:none --sparse https://github.com/{REPO} /content/iliad",
        f'        !cd /content/iliad && git sparse-checkout set "{folder}"',
        f'    sys.path.insert(0, "/content/iliad/{folder}")',
    ])


def header_cell(slug: str, name: str, kind: str) -> dict:
    """The first cell of a published notebook: tex/notebook-header.md, filled in."""
    template = HEADER_TEMPLATE.read_text(encoding="utf-8")
    template = re.sub(r"^\s*<!--.*?-->\s*", "", template, flags=re.S)  # the template's own notes
    label, page = schedule_pages().get(slug, (slug, f"/page/{slug}/"))  # unscheduled: /page/<slug>/
    fields = {
        "page_label": label,
        "page_url": SITE + page,
        "version": "with solutions" if kind == "sol" else "without solutions",
        "nosol_url": COLAB_URL.format(preview=PREVIEW, slug=slug, name=name, kind="nosol"),
        "sol_url": COLAB_URL.format(preview=PREVIEW, slug=slug, name=name, kind="sol"),
    }
    text = re.sub(r"\{(\w+)\}", lambda m: fields.get(m[1], m[0]), template.strip())
    return md_cell(text.split("\n"))


def publish_master(py: Path, slug: str, out_dir: Path) -> list[Path]:
    text = py.read_text(encoding="utf-8")
    meta, cells = parse_master(text, str(py.relative_to(ROOT)))
    ex, sol, _, solutions = publish_cells(cells, slug, py.stem, py.parent)
    written = []
    fetch = [fetch_cell(slug)] if (py.parent / "support").is_dir() or meta.get(SOLUTIONS_KEY) else []
    if meta.get(SOLUTIONS_KEY):
        path = out_dir / meta[SOLUTIONS_KEY]
        path.parent.mkdir(parents=True, exist_ok=True)
        blanks, lines = 0, []
        for line in solutions:  # at most two blank lines in a row, as ARENA
            blanks = blanks + 1 if not line.strip() else 0
            if blanks <= 2:
                lines.append(line)
        path.write_text("\n".join(lines), encoding="utf-8")
        written.append(path)
    for kind, out in (("nosol", ex), ("sol", sol)):
        path = out_dir / f"{py.stem}_{kind}.ipynb"
        body = nb_json([header_cell(slug, py.stem, kind)] + fetch + out, colab_meta(meta))
        # belt and braces: image_for_publish already refuses these
        leftover = re.search(r'(\]\(\s*<?|src=\\?["\'])(data:|attachment:|fig/)', body)
        if leftover:
            raise ConvertError(f"{path.name}: published notebook still has an image {leftover[0]}…")
        path.write_text(body, encoding="utf-8")
        written.append(path)
    return written


# ---------------------------------------------------------------- sync ----


class Pair:
    def __init__(self, slug_dir: Path, name: str):
        self.dir, self.name = slug_dir, name
        self.py = slug_dir / f"{name}.py"
        self.nb = slug_dir / f"{name}.ipynb"
        self.stamp = slug_dir / f".{name}.sync"
        self.conflict_file = slug_dir / f"{name}.from-notebook.py"
        self.where = f"{slug_dir.name}/{name}"

    def read_stamp(self) -> dict | None:
        try:
            return json.loads(self.stamp.read_text())
        except (OSError, json.JSONDecodeError):
            return None

    def write_notebook(self, py_text: str) -> str:
        """Regenerate the local notebook from master text; returns the stamp's notebook hash."""
        body = master_to_local_notebook(py_text, self.dir, self.where)
        if self.nb.exists():
            trash = self.dir / ".trash"
            trash.mkdir(exist_ok=True)
            shutil.move(self.nb, trash / f"{self.name}.{time.strftime('%Y%m%d-%H%M%S')}.ipynb")
            for old in sorted(trash.glob(f"{self.name}.*.ipynb"))[:-TRASH_KEEP]:
                old.unlink()
        self.nb.write_text(body, encoding="utf-8")
        back, _ = notebook_to_master(json.loads(body), FigStore(self.dir), self.where)
        return sha(back)

    def save_stamp(self, py_text: str, nb_hash: str, base: str | None) -> None:
        """Hashes of both sides as they now agree, and the `base` the notebook carries."""
        self.stamp.write_text(json.dumps({"py": sha(py_text), "nb": nb_hash, "base": base}) + "\n")


def sync_pair(pair: Pair, log: list[str]) -> bool:
    """Bring one master and its local notebook in line. Returns False on conflict.

    A notebook edit is only carried into the .py when the notebook provably descends from
    the current .py: its metadata.iliad.base is the .py's hash, or it is the same notebook
    the last sync accepted and the .py hasn't moved since. Anything else — both sides
    edited, or a stale copy (an editor autosaving an old version) — is a conflict.
    """
    stamp = pair.read_stamp()
    if not pair.py.exists():
        if stamp:
            log.append(f"  ? {pair.where}.ipynb: its master .py was deleted — delete the notebook too "
                       "(not re-importing it)")
            return True
        nb = json.loads(pair.nb.read_text(encoding="utf-8"))
        store = FigStore(pair.dir)
        text, warnings = notebook_to_master(nb, store, pair.where + ".ipynb")
        log += [f"  ! {w}" for w in warnings]
        for f in store.commit():
            log.append(f"  + {pair.dir.name}/{f}")
        pair.py.write_text(text, encoding="utf-8")
        pair.save_stamp(text, sha(text), nb.get("metadata", {}).get("iliad", {}).get("base"))
        log.append(f"  ← {pair.where}.py created from the notebook")
        return True

    # The master's canonical layout (as ARENA's py → ipynb → py round trip gave); same content.
    raw = pair.py.read_text(encoding="utf-8")
    meta, cells = parse_master(raw, pair.where + ".py")
    text = serialize_master(meta, cells)

    def normalise_py():
        if raw != text:
            pair.py.write_text(text, encoding="utf-8")
            log.append(f"  · {pair.where}.py reformatted (layout only)")

    if not pair.nb.exists():
        normalise_py()
        pair.save_stamp(text, pair.write_notebook(text), sha(text))
        log.append(f"  → {pair.where}.ipynb built")
        return True

    nb = json.loads(pair.nb.read_text(encoding="utf-8"))
    store = FigStore(pair.dir)
    nb_text, warnings = notebook_to_master(nb, store, pair.where + ".ipynb")
    base = nb.get("metadata", {}).get("iliad", {}).get("base")
    py_changed = not stamp or stamp["py"] != sha(text)
    nb_changed = not stamp or stamp["nb"] != sha(nb_text)

    if nb_text == text:  # same content, whatever the stamp says
        normalise_py()
        pair.save_stamp(text, sha(nb_text), base)
        return True
    if not py_changed and not nb_changed:
        return True
    if py_changed and not nb_changed:
        normalise_py()
        pair.save_stamp(text, pair.write_notebook(text), sha(text))
        log.append(f"  → {pair.where}.ipynb rebuilt from the .py")
        return True
    if base == sha(text) or (stamp and not py_changed and base == stamp.get("base")):
        log += [f"  ! {w}" for w in warnings]
        for f in store.commit():
            log.append(f"  + {pair.dir.name}/{f}")
        pair.py.write_text(nb_text, encoding="utf-8")
        pair.save_stamp(nb_text, sha(nb_text), base)
        log.append(f"  ← {pair.where}.py updated from the notebook")
        return True

    pair.conflict_file.write_text(nb_text, encoding="utf-8")
    why = ("both the .py and the notebook changed" if py_changed and nb_changed
           else "the notebook was made from an older version of the .py")
    log.append(f"  ✗ {pair.where}: CONFLICT — {why}. Nothing was overwritten. The notebook's version is in "
               f"{pair.conflict_file.name}: merge it into {pair.py.name} by hand, then delete it and "
               f"{pair.nb.name}, and run again.")
    return False


# ----------------------------------------------------------------- CLI ----


def masters_in(slug_dir: Path) -> list[Path]:
    return sorted(p for p in slug_dir.glob("*.py") if is_master(p))


def check_names(slug_dir: Path, names: list[str]) -> None:
    for name in names:
        if not NAME_RE.match(name) or name.endswith(("_sol", "_nosol")):
            raise ConvertError(f"{slug_dir.name}/{name}: notebook names use letters, digits, '_', '-', '.', "
                               "and may not end in _sol/_nosol — rename the file")


def slug_dirs(slugs: list[str]) -> list[Path]:
    if slugs:
        dirs = [TEX / s.strip("/").removeprefix("tex/") for s in slugs]
        for d in dirs:
            if not d.is_dir():
                raise SystemExit(f"no such module: {d.relative_to(ROOT)}")
        return dirs
    return sorted(d for d in TEX.iterdir() if d.is_dir() and not d.name.startswith((".", "_"))
                  and (masters_in(d) or any(d.glob("*.ipynb"))))


def publish(dirs: list[Path]) -> int:
    n = 0
    for d in dirs:
        masters = masters_in(d)
        if not masters:
            continue
        check_names(d, [m.stem for m in masters])
        out = BUILD / d.name
        if out.exists():
            shutil.rmtree(out)
        out.mkdir(parents=True)
        for m in masters:
            for path in publish_master(m, d.name, out):
                n += 1
                print(f"  {path.relative_to(ROOT)}")
        if (d / "support").is_dir():
            shutil.copytree(d / "support", out, dirs_exist_ok=True)
    return n


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("slugs", nargs="*", help="modules under tex/ (default: every module with notebooks)")
    ap.add_argument("--publish", action="store_true", help="only build published notebooks (CI)")
    ap.add_argument("--preview", metavar="PR", type=int,
                    help="with --publish: build PR <PR>'s preview (links and images under pr-preview/pr-<PR>/)")
    args = ap.parse_args()
    try:
        if args.preview is not None:
            if not args.publish:
                raise ConvertError("--preview only goes with --publish")
            global PREVIEW
            PREVIEW = f"pr-preview/pr-{args.preview}/"
        dirs = slug_dirs(args.slugs)
        ok = True
        if not args.publish:
            for d in dirs:
                names = sorted({p.stem for p in masters_in(d)} | {p.stem for p in d.glob("*.ipynb")})
                check_names(d, names)
                log = []
                for name in names:
                    try:
                        ok &= sync_pair(Pair(d, name), log)
                    except ConvertError as e:
                        log.append(f"  ✗ {e}")
                        ok = False
                if log:
                    print(f"▸ {d.name}\n" + "\n".join(log))
        n = publish(dirs)
        print(f"{n} published file(s) in {BUILD.relative_to(ROOT)}/" + ("" if ok else " — with problems above"))
        return 0 if ok else 1
    except ConvertError as e:
        print(f"✗ {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
