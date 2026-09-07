# ADR-0001: The macOS CI fast path is deliberately asymmetric between the nix and opam routes

**Status:** TBD
**Date:** 2026-08-24

## Context

Most of a CI run is macOS jobs waiting for a free runner.
For instance, [run 32170095477](https://github.com/rocq-prover/vsrocq/actions/runs/32170095477) for a PR took 26 minutes end to end, and what ended it was `nix-dev-build (macos-latest, 9-1, dev)`, which spent 19.9 of those minutes queued and 6.2 running.
Its 17 macOS jobs averaged 9.5 minutes queued against 6.2 running, while the 20 ubuntu jobs of the same run averaged 0.5 minutes queued, 3.1 at worst.
Similarly, [run 32649544820](https://github.com/rocq-prover/vsrocq/actions/runs/32649544820), a push to `main` five days later, has the same shape, 26.7 minutes end to end with 7.7 minutes queued against 5.1 running on macOS and 0.2 queued on ubuntu.

`ci.yml` schedules 16 macOS cells per run, 8 Rocq versions × 2 independent build routes (`nix-dev-build` and `install-opam`), and GitHub caps concurrent macOS jobs at 5 on the Free, Pro and Team plans ([job concurrency limits](https://docs.github.com/en/actions/reference/limits#job-concurrency-limits-for-github-hosted-runners)), so those 16 cells execute in 4 waves of about 6 minutes.
The ubuntu cap is 20 and is never reached.

The two routes do not cover the same ground:

- **nix** builds Rocq from nixpkgs and is the only place where tests actually execute on Darwin (the Electron suite and the LSP suite over stdio).
- **opam** builds `rocq-core` from source with the system toolchain.
  On macOS it runs no tests at all, since every test step in `install-opam` is gated on `runner.os == 'Linux'`.
  Its entire value on Darwin is as a build check of the opam packaging route.

The opam route fails intermittently on older macOS cells.
What is observed is that the `install-opam` macOS cell for `coq-core` 8.19.0 fails part of the time, with the OCaml compiler aborting during the build, and that the same cell passes on a rerun.
The nix route has never shown it.

The suspected cause is the `build-env` the `coq-core` opam package sets, `OCAMLPARAM = "_,w=-46,warn-error=-a,keywords=5.2"`.
Compiler-libs binaries parse `OCAMLPARAM` at startup, and `keywords=5.2` means nothing to a compiler older than 5.2, which appears to reach an `assert false` in `utils/warnings.ml`.
That would make the affected range `coq-core` 8.17.0 through 8.19.1, with 8.19.2 and later unaffected because the variable is added in opam packaging rather than being present in the Rocq source tarball, and it would explain why 8.18.0 sits inside the range yet is not seen failing, the fault being sensitive to the exact argv, environment and paths of each build.

The mechanism has not been confirmed end to end, and only the 8.19.0 cell has been seen failing.
The decision below rests on the observation that those cells are unreliable on Darwin, and holds whatever the explanation turns out to be.
If opam's `build-env` is the cause there is no CI-side workaround, since it overrides the ambient value.

## Decision

On `pull_request`, macOS runs 4 cells instead of 16, one wave instead of four:

| Route | Versions on the PR fast path |
|---|---|
| nix | `8-18`, `9-2` |
| opam | `8.20.0`, `9.2.0` |

ubuntu keeps the full 8-version sweep on both routes, where it costs nothing in wall clock.
The complete 16-cell macOS matrix runs on push to the default branch, and on demand on a PR via the `ci-full` label.

The version lists differ between the two routes **on purpose**:

- The oldest-supported end is represented by `nix 8-18`, not by `opam 8.18.0`, because only the opam route shows the intermittent failure.
  Putting `8.18.0` on the fast path would place a cell from the suspect range on the blocking path of every PR, and with only two opam-macOS cells that is half the signal.
  A red run there is not attributable to the PR that triggered it.
- `opam 8.20.0` is the oldest 8.x outside the suspect range, so the fast path still checks an 8.x opam build on Darwin.
- `9.2.0` and `9-2` are on both routes because that is the current stable release, the one most users build against.
- The macOS `master`, `9-3`, `dev` and `9.3.dev` cells are off the fast path.
  When they break, they break because upstream moved rather than because of the PR under review.
  They keep running on ubuntu, where they cost no wall clock, so the signal is delayed on Darwin only.

`8.18.0` and `8.19.0` on the opam route are not dropped, but move to the full sweep, where a failure informs instead of blocking.

The cells are emitted as JSON by `.github/scripts/ci-matrix.py`, run in a `matrix-plan` job, and consumed as `matrix: ${{ fromJSON(...) }}`.
A cross product `os × coq` cannot express different version lists per OS, and duplicating the step lists per OS would double an already-drifting set of steps.
Running the script with `FULL=true` reproduces today's matrix cell for cell, which is what makes the reduced set the only thing this change alters.

The `ci-full` label requires `on: pull_request: types: [opened, synchronize, reopened, labeled]`.
Declaring `types` overrides the defaults, so all four must be listed.
Without `labeled`, applying the label fires no run at all, and "Re-run all jobs" replays the original payload, which does not carry the label.

## Alternatives considered

**Keep `opam 8.18.0` and mitigate the flake** (retry the step, or `continue-on-error` on that cell).
Rejected, because `continue-on-error` reports the cell green whether or not it built, which removes the only signal that route provides on Darwin, and a retry does not fix a layout-sensitive fault, since perturbing the build moves the failure rather than removing it.

**Drop the opam route from macOS entirely** and rely on nix there.
Rejected, because nix cannot see opam-packaging failures on Darwin at all, and the intermittent failure above is exactly the class of bug that only this route reports.

**Trim by version for all events rather than adding a fast path.**
Rejected, because it would also reduce coverage on the default branch and on releases, which is where the full sweep is worth its cost.

**A nightly `cron` for the full sweep.**
A reasonable alternative, and compatible with this change rather than a replacement for it.
It would also bound how long a break in the `master` and `dev` cells goes unnoticed, which is the delay this decision accepts on Darwin.
`schedule` only fires from the workflow file on the default branch, so it cannot be exercised from a pull request branch, whereas the `ci-full` label can.

## Consequences

- A PR that breaks the opam build on macOS specifically for Rocq 8.18.0 or 8.19.0 is not caught until the full sweep runs.
  Given that the only known failure mode in that range is upstream packaging rather than this codebase, this is an accepted loss.
- The asymmetry between the two version lists looks like an oversight.
  Anyone "restoring symmetry" by adding `8.18.0` back to the opam fast path reintroduces the blocking flake, and this ADR is the reason it is not there.
- If the `install-opam` matrix is ever bumped from `8.19.0` to `8.19.2`, which would be the cheapest remedy if the hypothesis above is right, the argument for excluding `8.18.0` still holds, since no 8.18.x is outside the suspect range.
- ubuntu still runs the `master` and `dev` cells on every pull request, so a merge can still be blocked by upstream having moved.
  Cutting those from the fast path as well is a separate decision, not taken here, since on ubuntu they cost no wall clock and they are the earliest warning that upstream broke us.
- The label path is code that nothing exercises unless someone uses it.
  It has to be verified deliberately, by applying `ci-full` to a PR once and confirming the 16 macOS cells come back.
  Otherwise it will be discovered broken at the moment it is first needed.
