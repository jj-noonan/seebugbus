#!/usr/bin/env python3
"""
Update a value in .env without it appearing anywhere it shouldn't.

Typed through getpass, so it is not echoed to the screen, not written to shell
history, and not captured in a session transcript. Rewrites in place rather
than through sed, because a secret containing / or & silently corrupts a sed
expression, and a half-written credential fails in a confusing way much later.

    .venv/bin/python scripts/set_secret.py SPOTIFY_CLIENT_SECRET
"""
import getpass
import os
import sys
from pathlib import Path

ENV = Path(__file__).resolve().parent.parent / ".env"


def main() -> int:
    key = sys.argv[1] if len(sys.argv) > 1 else "SPOTIFY_CLIENT_SECRET"
    if not ENV.exists():
        print(f"no {ENV}", file=sys.stderr)
        return 1

    value = getpass.getpass(f"{key} (input hidden): ").strip()
    if not value:
        print("nothing entered, leaving the file alone")
        return 1

    lines = ENV.read_text().splitlines()
    out, seen = [], False
    for line in lines:
        if line.startswith(f"{key}="):
            out.append(f"{key}={value}")
            seen = True
        else:
            out.append(line)
    if not seen:
        out.append(f"{key}={value}")

    # Write via a private temp file next to the target, so the secret is never
    # briefly world-readable and a crash cannot leave .env truncated.
    tmp = ENV.with_suffix(".env.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write("\n".join(out) + "\n")
    os.replace(tmp, ENV)
    os.chmod(ENV, 0o600)

    print(f"{key} updated ({len(value)} chars), .env is 600")
    return 0


if __name__ == "__main__":
    sys.exit(main())
