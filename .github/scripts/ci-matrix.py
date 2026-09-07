#!/usr/bin/env python3
"""Decide which matrix cells a CI run schedules.

GitHub caps concurrent macOS runners at 5, and the full matrix asks for 16 of
them (8 Rocq versions x 2 build routes), so those jobs alone cost four waves of
queueing and set the wall clock for the whole run. A pull request therefore gets
a reduced set of macOS cells; ubuntu is never reduced, since its cap is 20 and it
does not queue.

Set FULL=true to get every cell. The workflow does that for anything that is not
a pull request, and for a pull request carrying the `ci-full` label.

The macOS lists are not symmetric between the two routes. See
docs/adr/0001-macos-ci-fast-path-is-asymmetric-between-nix-and-opam.md; the short
version is that the opam packaging of coq-core 8.17.0 through 8.19.1 injects an
OCAMLPARAM that crashes the OCaml 4.14 compiler on arm64 macOS, so 8.18.0 and
8.19.0 are kept off the blocking path on that route only. The nix route does not
go through the opam package and is unaffected.

Run it locally to see what a given event would schedule:

    FULL=false python3 .github/scripts/ci-matrix.py
"""

import json
import os
import sys

OCAML = "4.14.2"

# Devshell suffixes in flake.nix: `nix develop .#vsrocq-<coq>`.
NIX_ALL = ["8-18", "8-19", "8-20", "9", "9-1", "9-2", "9-3", "master"]
NIX_MACOS_FAST = ["8-18", "9-2"]

# opam package versions of rocq-core / coq-core.
OPAM_ALL = ["8.18.0", "8.19.0", "8.20.0", "9.0.0", "9.1.1", "9.2.0", "9.3.dev", "dev"]
OPAM_MACOS_FAST = ["8.20.0", "9.2.0"]


def nix_cells(full):
    macos = NIX_ALL if full else NIX_MACOS_FAST
    cells = [{"os": "ubuntu-latest", "coq": c, "profile": "dev"} for c in NIX_ALL]
    cells.append({"os": "ubuntu-latest", "coq": "master", "profile": "fatalwarnings"})
    cells += [{"os": "macos-latest", "coq": c, "profile": "dev"} for c in macos]
    return cells


def opam_cells(full):
    macos = OPAM_ALL if full else OPAM_MACOS_FAST
    cells = [{"os": "ubuntu-latest", "ocaml-compiler": OCAML, "coq": c} for c in OPAM_ALL]
    cells += [{"os": "macos-latest", "ocaml-compiler": OCAML, "coq": c} for c in macos]
    return cells


def summary(full, plan):
    macos = sum(1 for _, _, cells in plan for c in cells if c["os"] == "macos-latest")
    lines = [
        "### CI matrix",
        "",
        "Full matrix: `%s`" % ("yes" if full else "no, pull request fast path"),
        "",
        "| Job | cells | of them macOS |",
        "|---|---|---|",
    ]
    for job, _, cells in plan:
        lines.append(
            "| `%s` | %d | %d |"
            % (job, len(cells), sum(1 for c in cells if c["os"] == "macos-latest"))
        )
    waves = -(-macos // 5)
    lines.append("")
    lines.append(
        "%d macOS cells, %d %s against a cap of 5 concurrent macOS runners."
        % (macos, waves, "wave" if waves == 1 else "waves")
    )
    return "\n".join(lines) + "\n"


def main():
    full = os.environ.get("FULL", "true").lower() == "true"

    # (job in ci.yml, name of the output it reads, its cells)
    plan = [
        ("nix-dev-build", "nix", nix_cells(full)),
        ("install-opam", "opam", opam_cells(full)),
    ]

    outputs = "".join(
        "%s=%s\n" % (output, json.dumps({"include": cells}))
        for _, output, cells in plan
    )

    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as fh:
            fh.write(outputs)
    else:
        sys.stdout.write(outputs)

    text = summary(full, plan)
    step = os.environ.get("GITHUB_STEP_SUMMARY")
    if step:
        with open(step, "a") as fh:
            fh.write(text)
    sys.stderr.write(text)


if __name__ == "__main__":
    main()
