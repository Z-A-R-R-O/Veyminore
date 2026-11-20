"""Check local Markdown file links and documentation index coverage (no network)."""
from pathlib import Path
import re
from urllib.parse import unquote

root = Path(__file__).resolve().parents[1]
files = [root / "README.md", root / "MASTERPLAN.md", *sorted((root / "docs").rglob("*.md"))]
errors = []
checked = 0
for file in files:
    text = file.read_text(encoding="utf-8")
    for match in re.finditer(r"\[[^\]\n]*\]\(([^)\n]+)\)", text):
        target = match.group(1).strip().split(' "')[0].strip("<>")
        if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target) or target.startswith(("#", "/")):
            continue
        target = unquote(target.split("#")[0].split("?")[0])
        if not target or "{" in target:
            continue
        checked += 1
        if not (file.parent / target).exists():
            errors.append(f"{file.relative_to(root)}: missing {target}")
index = (root / "docs/DOC-STATUS-INDEX.md").read_text(encoding="utf-8")
for file in (root / "docs").rglob("*.md"):
    relative = file.relative_to(root / "docs").as_posix()
    if f"]({relative})" not in index:
        errors.append(f"Index missing: {relative}")
print(f"Checked {len(files)} Markdown files, {checked} relative file links, and complete docs index coverage.")
for error in errors:
    print(error)
raise SystemExit(bool(errors))
