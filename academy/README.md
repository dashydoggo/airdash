# airDash Academy

airDash Academy is a dependency-free local learning application that turns the airDash technical documentation into an active curriculum with adaptive quizzes, delayed review, practical checks, cumulative examinations, and capstone rubrics. It runs only on the learner's computer, stores progress locally, and never requires a login.

## Start the academy

Prerequisites: a clone of this repository and Node.js 24.x. Dependency installation is not required to open the academy; practical checks that exercise the API or frontend require the matching `node_modules/` directories from [installation](../docs/installation.md).

From the repository root:

```bash
npm --prefix academy run validate
npm --prefix academy test
npm --prefix academy start
```

The first command validates the complete curriculum and coverage. The second runs engine, progress, checker, and server tests. The third starts a local server bound to `127.0.0.1:4174`. Open `http://127.0.0.1:4174/academy/` in a browser. Press Ctrl+C in the terminal to stop it.

The server does not listen on the local-network interface and does not transmit progress. It serves repository files needed by the academy and exposes only fixed checker IDs under `/api/academy/checks/`. It rejects arbitrary command text and path traversal.

## Learning modes

| Mode | Purpose | Evidence produced |
|---|---|---|
| Dashboard | Show prerequisites, module gates, due reviews, misconceptions, examination readiness, and capstone status. | None by itself. |
| Study | Open the canonical documentation and source evidence for one concept. | Introduced evidence only. |
| Diagnostic | Sample concepts before study to focus effort. | Baseline results; no penalty. |
| Practice | Active recall and application with confidence recorded before feedback. | Recall and applied evidence. |
| Review | Present due questions according to the retention schedule. | Delayed-retention evidence. |
| Module examination | Independently sample a module and enforce overall and skill minima. | Demonstrated evidence when the gate passes. |
| Cumulative examination | Mix modules and critical concepts. | Phase or final examination evidence. |
| Lab | Guide a real repository task and run a whitelisted check or record inspectable evidence. | Practical evidence. |
| Capstone | Collect artifacts against the 100-point rubric. | Integrated evidence after human review. |

## Current curriculum inventory

| Evidence resource | Count |
|---|---:|
| Prerequisite modules | 21 |
| Atomic concepts | 105 |
| Critical concepts | 28 |
| Authored questions | 252 |
| Critical questions | 53 |
| Practical labs | 24 (21 automated, 3 human-inspected) |
| Cumulative examinations | 6 |
| Capstone | 1 rubric, 100 points, all 105 concepts mapped |
| Fixed local checkers | 18 |
| Automated academy tests | 47 |

Every concept has at least two recall or explanation mappings and two higher-order mappings. A validator fails if that coverage, practical critical evidence, source references, question quality, or examination feasibility drops below the declared standard.

## Mastery standard

Read [MASTERY_MODEL.md](MASTERY_MODEL.md) before relying on a dashboard label. In summary:

- Recognition is not recall.

- One quiz is not durable mastery.
- A demonstrated module requires at least 90 percent overall, at least 80 percent in every required skill, every concept at applied evidence or higher, required labs, and no unresolved overconfident misconception.
- Retained evidence requires successful reviews at 1, 3, 7, 14, and 30 days.
- Integrated evidence requires the final cumulative examination and a human-reviewed capstone.

No local application can guarantee professional competence, authorship, or correct performance in every production situation. The academy reports exactly what evidence it recorded and no more.

## Progress controls

Progress is stored by the browser under `airdash-academy-progress-v1`. The Settings panel provides:

- Export to a versioned JSON file.
- Import with complete schema and ID validation.
- Reset after typing `RESET`.
- Text scale from 90 to 140 percent.
- High-contrast mode.
- Reduced-motion mode independent of the operating-system preference.

An export contains only academy results, optional learner display name and notes, and evidence references entered by the learner. It does not contain cookies, repository contents, environment variables, or credentials.

## Practical checks

The server's checker registry is in `checks.mjs`. Checks are grouped by risk:

- **Inspect:** read file existence, package versions, Git metadata, route and table inventory, configuration key names, and documentation links.
- **Validate:** run fixed scripts already defined by the repository, such as `npm --prefix api run check` and the two unit-test scripts.
- **Build:** run the fixed frontend type check or an isolated Vite build into an operating-system temporary directory and remove it afterward.

A check never runs a string from `labs.json`, never reads `api/.env`, never prints environment variables, never invokes a shell, never writes to the repository, never changes Git history, never starts or restarts production processes, and never contacts an application endpoint. See [checks.mjs](checks.mjs) for the complete allow-list.

## Maintainer commands

```bash
npm --prefix academy run validate       # schema, references, coverage, question quality
npm --prefix academy test               # all Node.js tests
npm --prefix academy run test:engine    # adaptive engine and progress only
npm --prefix academy run test:server    # local server and API boundary
npm --prefix academy start              # 127.0.0.1:4174
npm --prefix academy start -- --port 4180
```

`--port` accepts 1024 through 65535. The host remains `127.0.0.1` and cannot be overridden from the command line.

## Curriculum maintenance

The curriculum schema and invariants are in [SCHEMA.md](SCHEMA.md). A code or documentation change that alters a documented concept must update the corresponding concept, question, lab, exam, or source evidence in `data/`. The validator fails when a concept lacks both recall and higher-order assessment, when a critical concept lacks practical evidence, when a link or symbol is missing, or when an examination cannot meet its declared distribution.

## Accessibility

The application supports keyboard-only operation, a skip link, visible focus, semantic headings and controls, an `aria-live` result region, no information conveyed by color alone, text scaling, high contrast, and reduced motion. Questions do not auto-advance after feedback; the learner controls the pace. Source excerpts and commands remain selectable text rather than images.
