"""Run the repository's deterministic local quality gates."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parents[2]


def run(command: list[str], cwd: Path = PROJECT_ROOT) -> None:
    """Run one quality command and stop immediately on failure."""

    print(f"\n$ {' '.join(command)}", flush=True)
    subprocess.run(command, cwd=cwd, check=True)  # noqa: S603


def main() -> None:
    """Check backend lint/tests and the frontend production build."""

    run([sys.executable, "-m", "ruff", "check", "."])
    run([sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"])

    pnpm = shutil.which("pnpm")
    corepack = shutil.which("corepack")
    if pnpm:
        frontend_command = [pnpm, "build"]
    elif corepack:
        frontend_command = [corepack, "pnpm", "build"]
    else:
        raise SystemExit("pnpm or corepack is required to check the frontend")
    run(frontend_command, PROJECT_ROOT / "frontend")


if __name__ == "__main__":
    main()
