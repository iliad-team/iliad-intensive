#!/usr/bin/env python3
"""
Export every tab of a Google Doc as Markdown into a zip file,
preserving the tab hierarchy as directories.

Images are NOT embedded: Google's exporter inlines them as base64 data URIs,
which buries the prose and bloats the files. Each one is replaced with a short
note recording that an image was there, its type, size and alt text.

Layout rule (matches how you'd expect nesting to work):
  - A tab with no children  ->  <parent-path>/<Tab Name>.md
  - A tab with children     ->  <parent-path>/<Tab Name>/<Tab Name>.md
                                plus its children inside that directory.

Setup (one-off):
  1. Go to https://console.cloud.google.com/ and create (or pick) a project.
  2. Enable the "Google Docs API" for that project.
  3. Create OAuth credentials: APIs & Services -> Credentials ->
     Create Credentials -> OAuth client ID -> Application type: Desktop app.
     Download the JSON and save it as credentials.json next to this script.
  4. pip install google-api-python-client google-auth-oauthlib requests

Usage:
  python gdoc_scrape.py <doc-url-or-id> [-o output.zip]

First run opens a browser for consent; the token is cached in token.json
so subsequent runs are non-interactive.
"""

import argparse
import io
import re
import sys
import time
import zipfile
from pathlib import Path

import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

SCOPES = [
    "https://www.googleapis.com/auth/documents.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
]

EXPORT_URL = "https://docs.google.com/document/d/{doc_id}/export"


def extract_doc_id(s: str) -> str:
    """Accept a bare ID or any docs.google.com URL."""
    m = re.search(r"/document/d/([a-zA-Z0-9_-]+)", s)
    return m.group(1) if m else s


def get_credentials(script_dir: Path) -> Credentials:
    token_path = script_dir / "token.json"
    creds_path = script_dir / "credentials.json"
    creds = None
    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not creds_path.exists():
                sys.exit(
                    f"credentials.json not found in {script_dir}.\n"
                    "See the setup instructions at the top of this script."
                )
            flow = InstalledAppFlow.from_client_secrets_file(str(creds_path), SCOPES)
            creds = flow.run_local_server(port=0)
        token_path.write_text(creds.to_json())
    return creds


def sanitize(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|]', "_", name or "").strip()
    return name or "untitled-tab"


def walk_tabs(tabs, prefix=""):
    """Yield (zip_path, tab_id, title) for every tab, depth-first."""
    seen = {}
    for tab in tabs or []:
        props = tab.get("tabProperties", {})
        tab_id = props.get("tabId")
        title = sanitize(props.get("title", ""))

        # Disambiguate duplicate sibling titles: Foo.md, Foo (2).md, ...
        n = seen.get(title, 0) + 1
        seen[title] = n
        unique = title if n == 1 else f"{title} ({n})"

        children = tab.get("childTabs") or []
        if children:
            dir_path = f"{prefix}{unique}/"
            yield f"{dir_path}{unique}.md", tab_id, title
            yield from walk_tabs(children, dir_path)
        else:
            yield f"{prefix}{unique}.md", tab_id, title


def fetch_tab_markdown(session: requests.Session, doc_id: str, tab_id: str) -> bytes:
    url = EXPORT_URL.format(doc_id=doc_id)
    params = {"format": "markdown", "tab": tab_id}
    delay = 2.0
    for attempt in range(6):
        resp = session.get(url, params=params, timeout=60)
        if resp.status_code == 200:
            return resp.content
        if resp.status_code == 429:
            time.sleep(delay)
            delay *= 2
            continue
        resp.raise_for_status()
    raise RuntimeError(f"Rate-limited too many times exporting tab {tab_id}")


# Google's Markdown export inlines each image as a reference-style definition
# holding a whole base64 data URI, e.g.
#   [image1]: <data:image/png;base64,iVBORw0KGgo...>
# One diagram can outweigh all the prose in the tab, so we keep the reference
# but throw away the payload.
_DATA_URI_DEF = re.compile(
    r"^\[(?P<label>image\d+)\]:[ \t]*<?"
    r"data:(?P<mime>[^;>\s]+);base64,(?P<b64>[A-Za-z0-9+/=]+)>?[ \t]*\n?",
    re.M,
)
_REF_IMAGE = re.compile(r"!\[(?P<alt>[^\]]*)\]\[(?P<label>image\d+)\]")
_INLINE_DATA_IMAGE = re.compile(
    r"!\[(?P<alt>[^\]]*)\]\([ \t]*<?data:(?P<mime>[^;)\s]+);base64,[A-Za-z0-9+/=\s]*>?[ \t]*\)"
)


def _human_size(n: int) -> str:
    return f"{n / 1024:.0f} KB" if n >= 1024 else f"{n} bytes"


def _note(label: str, mime: str, size: int, alt: str) -> str:
    """A short placeholder standing in for a stripped image."""
    head = f"{label} omitted ({mime}, {_human_size(size)})" if label else f"image omitted ({mime})"
    alt = " ".join(alt.split())
    return f"[{head}: {alt}]" if alt else f"[{head}]"


def strip_embedded_images(md: bytes) -> tuple[bytes, int]:
    """Drop base64 image payloads, leaving a note where each image was.

    Returns (markdown, images_noted). Images referenced by ordinary http(s)
    URLs are left untouched -- only embedded base64 blobs are stripped.
    """
    text = md.decode("utf-8", "replace")

    embedded = {
        m.group("label"): (m.group("mime"), len(m.group("b64")) * 3 // 4)
        for m in _DATA_URI_DEF.finditer(text)
    }
    text = _DATA_URI_DEF.sub("", text)

    noted = 0

    def replace_ref(m: "re.Match") -> str:
        nonlocal noted
        label = m.group("label")
        if label not in embedded:
            return m.group(0)  # not a base64 image -- leave the link alone
        noted += 1
        mime, size = embedded[label]
        return _note(label, mime, size, m.group("alt"))

    def replace_inline(m: "re.Match") -> str:
        nonlocal noted
        noted += 1
        return _note("", m.group("mime"), 0, m.group("alt"))

    text = _REF_IMAGE.sub(replace_ref, text)
    text = _INLINE_DATA_IMAGE.sub(replace_inline, text)

    return text.rstrip().encode("utf-8") + b"\n", noted


def main():
    ap = argparse.ArgumentParser(description="Export Google Doc tabs to a zip of Markdown files.")
    ap.add_argument("doc", help="Google Doc URL or document ID")
    ap.add_argument("-o", "--output", help="Output zip path (default: <doc title>.zip)")
    args = ap.parse_args()

    doc_id = extract_doc_id(args.doc)
    script_dir = Path(__file__).resolve().parent
    creds = get_credentials(script_dir)

    # Fetch the tab tree. includeTabsContent must be True -- with False the API
    # populates body/documentStyle from the first tab only and leaves tabs empty.
    docs = build("docs", "v1", credentials=creds)
    doc = docs.documents().get(documentId=doc_id, includeTabsContent=True).execute()
    title = doc.get("title", "document")
    tabs = doc.get("tabs")
    if not tabs:
        sys.exit("This document reports no tabs (or the API returned none).")

    plan = list(walk_tabs(tabs))
    print(f'"{title}": {len(plan)} tab(s) to export')

    session = requests.Session()
    session.headers["Authorization"] = f"Bearer {creds.token}"

    out_path = Path(args.output) if args.output else Path(f"{sanitize(title)}.zip")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for i, (zip_path, tab_id, tab_title) in enumerate(plan, 1):
            print(f"  [{i}/{len(plan)}] {zip_path}")
            md, noted = strip_embedded_images(fetch_tab_markdown(session, doc_id, tab_id))
            if noted:
                print(f"        {noted} embedded image(s) replaced with a note")
            zf.writestr(zip_path, md)
            if i < len(plan):
                time.sleep(1.0)  # be gentle with the export endpoint

    out_path.write_bytes(buf.getvalue())
    print(f"Wrote {out_path} ({out_path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
