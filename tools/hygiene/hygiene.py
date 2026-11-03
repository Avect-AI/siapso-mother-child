#!/usr/bin/env python3
"""Text hygiene checks for SIAPSO Mere-Enfant.

Blocks three things everywhere in the repository (code, interface text, docs,
commit messages, pull request text):

1. the em dash (U+2014);
2. emoji and pictographic symbols;
3. any mention of Claude or Anthropic as co-author or generator.

Usage:
    hygiene.py files [PATH ...]      check files (default: every tracked file)
    hygiene.py staged                check the staged version of staged files
    hygiene.py message FILE          check a commit message file
    hygiene.py text                  check text read from stdin
    hygiene.py claude-hook [--root DIR]
                                     Claude Code PreToolUse hook (JSON on stdin)

Only the Python standard library is used, so the script runs the same way in
git hooks, in CI and in the Claude Code hook.
"""

from __future__ import annotations

import fnmatch
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

# Characters are built from code points so this file stays pure ASCII and
# passes its own check.
EM_DASH = chr(0x2014)

# Emoji and pictographs. Arrows, box drawing, math and currency stay allowed.
_EMOJI_RANGES = [
    (0x1F000, 0x1FAFF),  # mahjong, cards, enclosed, pictographs, emoticons, transport, flags
    (0x2600, 0x27BF),    # miscellaneous symbols, dingbats (check marks, stars, warnings)
    (0x2B00, 0x2BFF),    # miscellaneous symbols and arrows (stars, circles)
    (0x231A, 0x231B),    # watch, hourglass
    (0x23E9, 0x23F3),    # media controls
    (0x23F8, 0x23FA),
]
_EMOJI_SINGLES = [0x2139, 0x24C2, 0x3030, 0x303D, 0x3297, 0x3299, 0xFE0F]
EMOJI_RE = re.compile(
    "["
    + "".join(f"{chr(lo)}-{chr(hi)}" for lo, hi in _EMOJI_RANGES)
    + "".join(chr(cp) for cp in _EMOJI_SINGLES)
    + "]"
)

ATTRIBUTION_RE = re.compile(
    r"co-authored-by:[^\n]*(claude|anthropic)"
    r"|noreply@anthropic\.com"
    r"|generated with \[?claude"
    r"|claude code\]?\(https://claude\.(com|ai)"
    r"|https://claude\.ai/code/session",
    re.IGNORECASE,
)

SKIP_DIRS = {
    ".git", "node_modules", "dist", "build", "coverage", ".venv", "venv",
    "__pycache__", ".pnpm-store", ".turbo", ".vite", "vendor",
}
SKIP_PREFIXES = (".claude/skills/", ".agents/", ".cursor/")
SKIP_FILES = {"pnpm-lock.yaml", "package-lock.json", "yarn.lock"}
BINARY_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".avif", ".pdf", ".zip",
    ".gz", ".br", ".tgz", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".onnx",
    ".bin", ".safetensors", ".pt", ".wav", ".mp3", ".ogg", ".webm", ".mp4",
    ".docx", ".xlsx", ".pptx", ".sqlite", ".db", ".wasm",
}
MAX_BYTES = 2_000_000


@dataclass
class Finding:
    where: str
    line: int
    col: int
    kind: str
    excerpt: str

    def __str__(self) -> str:
        return f"{self.where}:{self.line}:{self.col}: {self.kind}: {self.excerpt}"


def repo_root() -> Path:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        return Path(out)
    except (subprocess.CalledProcessError, FileNotFoundError):
        return Path.cwd()


def load_ignores(root: Path) -> list[str]:
    path = root / ".hygieneignore"
    if not path.exists():
        return []
    patterns = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#"):
            patterns.append(line)
    return patterns


def is_skipped(rel: str, ignores: list[str]) -> bool:
    rel = rel.replace("\\", "/")
    parts = rel.split("/")
    if any(p in SKIP_DIRS for p in parts[:-1]):
        return True
    if rel.startswith(SKIP_PREFIXES) or parts[-1] in SKIP_FILES:
        return True
    if Path(rel).suffix.lower() in BINARY_EXT:
        return True
    return any(fnmatch.fnmatch(rel, pat) for pat in ignores)


def scan_text(text: str, where: str, attribution: bool = False) -> list[Finding]:
    findings: list[Finding] = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        col = line.find(EM_DASH)
        if col >= 0:
            findings.append(Finding(where, lineno, col + 1, "tiret cadratin (U+2014)", line.strip()[:120]))
        match = EMOJI_RE.search(line)
        if match:
            code = f"U+{ord(match.group(0)):04X}"
            findings.append(Finding(where, lineno, match.start() + 1, f"emoji ou pictogramme ({code})", line.strip()[:120]))
        if attribution:
            att = ATTRIBUTION_RE.search(line)
            if att:
                findings.append(Finding(where, lineno, att.start() + 1, "attribution a Claude interdite", line.strip()[:120]))
    return findings


def read_text(path: Path) -> str | None:
    try:
        if path.stat().st_size > MAX_BYTES:
            return None
        data = path.read_bytes()
    except OSError:
        return None
    if b"\x00" in data[:8000]:
        return None
    return data.decode("utf-8", errors="replace")


def tracked_files(root: Path) -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "-z"], cwd=root, capture_output=True, check=True,
    ).stdout
    return [p for p in out.decode("utf-8").split("\0") if p]


def cmd_files(paths: list[str]) -> int:
    root = repo_root()
    ignores = load_ignores(root)
    targets = paths or tracked_files(root)
    findings: list[Finding] = []
    for target in targets:
        path = Path(target)
        abs_path = path if path.is_absolute() else root / path
        try:
            rel = abs_path.resolve().relative_to(root.resolve()).as_posix()
        except ValueError:
            rel = path.as_posix()
        if is_skipped(rel, ignores):
            continue
        text = read_text(abs_path)
        if text is not None:
            findings += scan_text(text, rel)
    return report(findings)


def cmd_staged() -> int:
    root = repo_root()
    ignores = load_ignores(root)
    names = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
        cwd=root, capture_output=True, check=True,
    ).stdout.decode("utf-8").split("\0")
    findings: list[Finding] = []
    for rel in filter(None, names):
        if is_skipped(rel, ignores):
            continue
        blob = subprocess.run(["git", "show", f":{rel}"], cwd=root, capture_output=True).stdout
        if len(blob) > MAX_BYTES or b"\x00" in blob[:8000]:
            continue
        findings += scan_text(blob.decode("utf-8", errors="replace"), rel)
    return report(findings)


def cmd_message(path: str) -> int:
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    body = "\n".join(l for l in text.splitlines() if not l.startswith("#"))
    return report(scan_text(body, "message de commit", attribution=True))


def cmd_text() -> int:
    return report(scan_text(sys.stdin.read(), "texte", attribution=True))


def report(findings: list[Finding]) -> int:
    if not findings:
        return 0
    print("Hygiene : contenu refuse.", file=sys.stderr)
    for f in findings:
        print(f"  {f}", file=sys.stderr)
    print(
        "Remplacez le tiret cadratin par une virgule, deux points ou des parentheses, "
        "retirez les emojis et toute attribution a Claude.",
        file=sys.stderr,
    )
    return 1


def hook_new_text(tool: str, tool_input: dict) -> str:
    if tool == "Write":
        return tool_input.get("content", "")
    if tool == "Edit":
        return tool_input.get("new_string", "")
    if tool == "MultiEdit":
        return "\n".join(e.get("new_string", "") for e in tool_input.get("edits", []))
    if tool == "NotebookEdit":
        return tool_input.get("new_source", "")
    return ""


def cmd_claude_hook(root_arg: str | None) -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"Hygiene : entree du hook illisible ({exc}), controle ignore.", file=sys.stderr)
        return 0
    tool = payload.get("tool_name", "")
    tool_input = payload.get("tool_input", {}) or {}
    root = Path(root_arg or os.environ.get("CLAUDE_PROJECT_DIR") or Path.cwd()).resolve()
    findings: list[Finding] = []

    if tool in {"Write", "Edit", "MultiEdit", "NotebookEdit"}:
        file_path = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
        try:
            rel = Path(file_path).resolve().relative_to(root).as_posix()
        except ValueError:
            return 0  # outside the SIAPSO repository: not our business
        if is_skipped(rel, load_ignores(root)):
            return 0
        findings = scan_text(hook_new_text(tool, tool_input), rel)
    elif tool in {"Bash", "PowerShell"}:
        command = tool_input.get("command", "")
        if not re.search(r"\bgit\b[^\n]*\bcommit\b|\bgh\b[^\n]*\bpr\b[^\n]*\b(create|edit|merge)\b", command):
            return 0
        cwd = Path(payload.get("cwd") or Path.cwd()).resolve()
        mentions_repo = str(root).lower() in command.lower() or root.name in command
        try:
            cwd.relative_to(root)
            inside = True
        except ValueError:
            inside = False
        if not (inside or mentions_repo):
            return 0
        findings = scan_text(command, "commande", attribution=True)
    else:
        return 0

    if not findings:
        return 0
    reason = "Hygiene SIAPSO : " + " ; ".join(f"{f.kind} ligne {f.line}" for f in findings[:5])
    reason += ". Pas de tiret cadratin, pas d'emoji, pas d'attribution a Claude."
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    return 0


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    command, rest = argv[0], argv[1:]
    if command == "files":
        return cmd_files(rest)
    if command == "staged":
        return cmd_staged()
    if command == "message" and rest:
        return cmd_message(rest[0])
    if command == "text":
        return cmd_text()
    if command == "claude-hook":
        root = rest[rest.index("--root") + 1] if "--root" in rest else None
        return cmd_claude_hook(root)
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
