#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Hashes and checks the pinned Python requirements of the voice pack conversion.

    lock.py hash    write requirements.txt from requirements.in, with the
                    sha256 of every wheel of each pinned version
    lock.py check   for each supported platform and Python 3.10 to 3.12, check
                    that every requirement of every pin that applies is pinned
                    and satisfied, that each pin has a wheel, and that each
                    version was published on or before the cutoff

Run inside the conversion venv (it needs `packaging`):
    speech/convert/.venv/Scripts/python speech/convert/lock.py check

`--dir <folder>` works on another requirements.in/requirements.txt pair, for
example `--dir speech/train` (the training set). A requirements.in can limit
the platforms and Python versions to check with the header lines
`# lock-platforms: linux-x86_64` and `# lock-pythons: 3.11 3.12`.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from functools import lru_cache
from pathlib import Path

from packaging import tags
from packaging.markers import Marker
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name, parse_wheel_filename

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "requirements.in"
LOCK = HERE / "requirements.txt"
PLATFORMS_ONLY: list[str] | None = None
PYTHONS_ONLY: list[tuple[int, int]] | None = None
PYTORCH_INDEX = "https://download.pytorch.org/whl/cpu"
CUTOFF = "2026-10-22T23:59:59"
PYTHONS = [(3, 10), (3, 11), (3, 12)]


def manylinux(arch: str) -> list[str]:
    names = [f"manylinux_2_{minor}_{arch}" for minor in range(39, 16, -1)] + [f"manylinux2014_{arch}"]
    if arch == "x86_64":
        names += ["manylinux2010_x86_64", "manylinux1_x86_64"]
    return names


def macos_arm64() -> list[str]:
    names = []
    for major in (15, 14, 13, 12, 11):
        names += [f"macosx_{major}_0_arm64", f"macosx_{major}_0_universal2"]
    names += [f"macosx_10_{minor}_universal2" for minor in range(16, 8, -1)]
    return names


PLATFORMS = {
    "windows-x86_64": ("win32", "Windows", "AMD64", "nt", ["win_amd64"]),
    "linux-x86_64": ("linux", "Linux", "x86_64", "posix", manylinux("x86_64")),
    "linux-aarch64": ("linux", "Linux", "aarch64", "posix", manylinux("aarch64")),
    "macos-arm64": ("darwin", "Darwin", "arm64", "posix", macos_arm64()),
}


def get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()


class Pin:
    def __init__(self, line: str) -> None:
        self.line = line
        self.requirement = Requirement(line)
        self.name = canonicalize_name(self.requirement.name)
        specs = list(self.requirement.specifier)
        if len(specs) != 1 or specs[0].operator != "==":
            raise SystemExit(f"Not an exact pin: {line}")
        self.version = specs[0].version
        self.extras = set(self.requirement.extras)
        self.marker = self.requirement.marker

    def applies(self, environment: dict) -> bool:
        return self.marker is None or self.marker.evaluate(environment)


def read_source() -> tuple[list[str], list[Pin]]:
    global PLATFORMS_ONLY, PYTHONS_ONLY
    options, pins = [], []
    for raw in SOURCE.read_text(encoding="utf-8").splitlines():
        if raw.startswith("# lock-platforms:"):
            PLATFORMS_ONLY = raw.split(":", 1)[1].split()
        if raw.startswith("# lock-pythons:"):
            PYTHONS_ONLY = [tuple(map(int, v.split("."))) for v in raw.split(":", 1)[1].split()]
        line = raw.split(" #")[0].strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("--"):
            options.append(line)
        else:
            pins.append(Pin(line))
    return options, pins


@lru_cache(maxsize=None)
def release(name: str, version: str) -> dict:
    """Wheels (filename, sha256, upload time) and requirements of a pinned version."""
    if "+" in version:
        page = get(f"{PYTORCH_INDEX}/{name}/").decode("utf-8")
        wheels = []
        for href in re.findall(r'href="([^"]+)"', page):
            path, _, fragment = href.partition("#")
            filename = urllib.parse.unquote(path.rsplit("/", 1)[-1])
            if not filename.endswith(".whl"):
                continue
            if str(parse_wheel_filename(filename)[1]) != version:
                continue
            digest = fragment.removeprefix("sha256=")
            url = urllib.parse.urljoin(f"{PYTORCH_INDEX}/{name}/", path)
            wheels.append({"filename": filename, "sha256": digest, "uploaded": None, "url": url})
        if not wheels:
            raise SystemExit(f"No wheel of {name}=={version} on {PYTORCH_INDEX}")
        # PEP 658 metadata of one wheel: the CPU builds share their requirements.
        metadata = get(wheels[0]["url"] + ".metadata").decode("utf-8")
        requires = [line[len("Requires-Dist: "):] for line in metadata.splitlines() if line.startswith("Requires-Dist: ")]
        return {"wheels": wheels, "requires": requires}
    data = json.loads(get(f"https://pypi.org/pypi/{name}/{version}/json"))
    wheels = [
        {"filename": f["filename"], "sha256": f["digests"]["sha256"], "uploaded": f["upload_time_iso_8601"]}
        for f in data["urls"]
        if f["filename"].endswith(".whl")
    ]
    if not wheels:
        raise SystemExit(f"No wheel of {name}=={version} on PyPI")
    return {"wheels": wheels, "requires": data["info"].get("requires_dist") or []}


def write_lock() -> None:
    options, pins = read_source()
    lines = [
        "# SPDX-License-Identifier: MIT",
        "# Generated by speech/convert/lock.py from requirements.in: do not edit.",
        f"# Every version, transitive ones included, was published on or before {CUTOFF[:10]} (lock.py check).",
        "# Install with: pip install --require-hashes --only-binary=:all: -r requirements.txt",
        *options,
        "",
    ]
    for pin in pins:
        hashes = sorted({wheel["sha256"] for wheel in release(pin.name, pin.version)["wheels"]})
        lines.append(f"{pin.line} \\")
        lines += [f"    --hash=sha256:{digest} \\" for digest in hashes[:-1]]
        lines.append(f"    --hash=sha256:{hashes[-1]}")
    with LOCK.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(lines) + "\n")
    print(f"Wrote {LOCK.name}: {len(pins)} pins")


def environment(platform: str, python: tuple[int, int]) -> tuple[dict, set]:
    sys_platform, system, machine, os_name, platforms = PLATFORMS[platform]
    version = f"{python[0]}.{python[1]}"
    markers = {
        "python_version": version,
        "python_full_version": f"{version}.0",
        "implementation_name": "cpython",
        "implementation_version": f"{version}.0",
        "platform_python_implementation": "CPython",
        "sys_platform": sys_platform,
        "platform_system": system,
        "platform_machine": machine,
        "os_name": os_name,
        "platform_release": "",
        "platform_version": "",
        "extra": "",
    }
    interpreter = f"cp{python[0]}{python[1]}"
    supported = set(tags.cpython_tags(python, [interpreter, "abi3", "none"], platforms))
    supported |= set(tags.compatible_tags(python, interpreter, platforms))
    return markers, supported


def check() -> int:
    _, pins = read_source()
    problems: list[str] = []
    for pin in pins:
        for wheel in release(pin.name, pin.version)["wheels"]:
            if wheel["uploaded"] is not None and wheel["uploaded"] > CUTOFF:
                problems.append(f"{pin.name}=={pin.version}: {wheel['filename']} uploaded {wheel['uploaded']}")
    for platform in PLATFORMS_ONLY or PLATFORMS:
        for python in PYTHONS_ONLY or PYTHONS:
            markers, supported = environment(platform, python)
            where = f"{platform}, Python {python[0]}.{python[1]}"
            active = {pin.name: pin for pin in pins if pin.applies(markers)}
            extras = {name: set(pin.extras) for name, pin in active.items()}
            changed = True
            seen: set[tuple[str, str, str]] = set()
            while changed:
                changed = False
                for name, pin in list(active.items()):
                    for spec in release(pin.name, pin.version)["requires"]:
                        requirement = Requirement(spec)
                        wanted = [""] + sorted(extras.get(name, set()))
                        if requirement.marker is not None and not any(
                            requirement.marker.evaluate({**markers, "extra": extra}) for extra in wanted
                        ):
                            continue
                        dependency = canonicalize_name(requirement.name)
                        key = (name, dependency, str(requirement.specifier))
                        if key in seen:
                            continue
                        seen.add(key)
                        target = active.get(dependency)
                        if target is None:
                            problems.append(f"{where}: {name} needs {spec}, which is not pinned for this platform")
                            continue
                        if not requirement.specifier.contains(target.version, prereleases=True):
                            problems.append(f"{where}: {name} needs {spec}, pinned {target.version}")
                        new = set(requirement.extras) - extras.setdefault(dependency, set())
                        if new:
                            extras[dependency] |= new
                            changed = True
            for name, pin in active.items():
                wheels = release(pin.name, pin.version)["wheels"]
                if not any(parse_wheel_filename(w["filename"])[3] & supported for w in wheels):
                    problems.append(f"{where}: no wheel of {name}=={pin.version}")
    for problem in sorted(set(problems)):
        print(problem)
    if problems:
        print(f"{len(set(problems))} problems")
        return 1
    pythons = PYTHONS_ONLY or PYTHONS
    print(
        f"OK: {len(pins)} pins, {len(PLATFORMS_ONLY or PLATFORMS)} platforms, "
        f"Python {', '.join(f'{a}.{b}' for a, b in pythons)}"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["hash", "check"])
    parser.add_argument("--dir", type=Path, help="folder with requirements.in (default: this folder)")
    args = parser.parse_args()
    global SOURCE, LOCK
    if args.dir is not None:
        SOURCE, LOCK = args.dir / "requirements.in", args.dir / "requirements.txt"
    if args.command == "hash":
        write_lock()
        return 0
    return check()


if __name__ == "__main__":
    sys.exit(main())
