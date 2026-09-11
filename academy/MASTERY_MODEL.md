# airDash Academy mastery model

airDash Academy is a local, evidence-based learning system for progressing from no software-development experience to independently contributing to and operating airDash. It combines explanation, active recall, diagnosis, practical execution, cumulative examinations, delayed review, and capstone work. The academy records evidence; it does not confer accreditation, employment credentials, or a guarantee of professional competence.

## Definition of mastery

Mastery means that the learner can retrieve, explain, apply, diagnose, and execute a concept under multiple conditions without relying on the answer being visible. Durable mastery adds successful delayed retrieval over at least 30 calendar days. Reading a page, recognizing an answer, or obtaining one high quiz score is not mastery.

Every concept advances through the following evidence levels.

| Level | Name | Evidence required | What it supports |
|---:|---|---|---|
| 0 | Unseen | No recorded interaction. | Nothing. |
| 1 | Introduced | The learner opens the concept's study reference and records completion. | Familiarity only. |
| 2 | Recalled | At least two correct active-recall responses on separate question IDs. | The learner can retrieve definitions and mechanics. |
| 3 | Applied | At least two correct application, analysis, diagnosis, security, or operations responses, including one answered with calibrated confidence. | The learner can use the concept in a constrained scenario. |
| 4 | Demonstrated | The concept is covered by a passed practical lab or cumulative examination, with the module gate satisfied. | The learner has demonstrated the skill in the academy environment. |
| 5 | Retained | Correct delayed reviews at the 1-, 3-, 7-, 14-, and 30-day stages, with no unresolved high-confidence misconception. | Evidence of retention over at least 30 days. |
| 6 | Integrated | A capstone rubric criterion covering the concept is marked complete with inspectable evidence, and the final cumulative examination passes. | Evidence that the learner can combine the concept with adjacent skills. |

The interface uses the exact names above. It never labels a learner "professional," "certified," or "guaranteed." Those claims require external observation in real work over time and are outside what a local application can prove.

## Instruction sequence

Each module follows the same sequence so that the learner knows what kind of effort is required.

1. **Diagnostic.** Questions sample prerequisite and target concepts. Diagnostic results do not lower mastery; they identify what can be reviewed quickly and what requires full study.
2. **Study.** The learner reads the linked canonical documentation and source evidence. Opening a link does not count as understanding; it records only level 1.
3. **Guided retrieval.** The academy asks recall questions without showing the answer. The learner reports confidence before submitting.
4. **Application and diagnosis.** Scenario questions require predicting behavior, selecting a corrective action, interpreting output, or identifying a violated invariant.
5. **Practical lab.** The learner performs a real, reversible task in the repository. The local server runs only a named, audited checker. No arbitrary command supplied by curriculum data or browser input is executed.
6. **Module gate.** The learner completes an independently sampled module examination. The gate reports skill-area scores and concept gaps.
7. **Cumulative examination.** After a phase of modules, questions mix old and new concepts so that success cannot depend on short-term context.
8. **Delayed review.** Correct answers are scheduled at increasing intervals. Incorrect or overconfident answers return sooner and create a remediation item.
9. **Capstone.** The learner traces, changes, tests, documents, reviews, and explains a controlled repository change, then responds to an incident scenario.

## Module gate

A module is **demonstrated** only when all conditions are true:

- Every prerequisite module is demonstrated.
- The learner has opened every required concept reference.
- At least 90 percent of the most recent module examination is correct.
- Every required skill area scores at least 80 percent. The skill areas are `recall`, `explain`, `apply`, `diagnose`, `secure`, and `operate`; a module declares which it requires.
- No concept in the module is below evidence level 3.
- Every required practical lab passes.
- No unresolved misconception has an incorrect answer recorded at confidence 4 or 5.

Retaking an examination is allowed. The next attempt uses a deterministic but different sample where the bank permits. The application records every attempt rather than replacing low scores.

## Cumulative gate

A phase examination covers every module in that phase and all preceding prerequisite phases. Passing requires:

- At least 90 percent overall.
- At least 85 percent for every represented module.
- At least 80 percent for every represented skill area.
- No critical question answered incorrectly. Critical questions cover destructive operations, authentication and authorization, secrets, database restoration, production deployment, and source-versus-generated-file boundaries.

The final examination uses at least 60 questions, including at least 10 diagnosis or operations scenarios and every critical concept. The academy validator proves that the bank can satisfy those constraints before the examination is offered.

## Active recall and confidence calibration

Active recall means producing or selecting an answer before seeing the explanation. Each response includes confidence from 1 to 5:

| Confidence | Meaning |
|---:|---|
| 1 | Guessing. |
| 2 | Some evidence, substantial uncertainty. |
| 3 | Reasonably confident but would verify before production use. |
| 4 | Confident and can explain why. |
| 5 | Certain enough to act without reference material. |

A correct low-confidence answer receives credit but schedules an earlier review. An incorrect answer at confidence 4 or 5 is an **overconfident misconception**. It blocks the module gate until the learner answers two related questions correctly on later attempts and completes the linked remediation reference.

## Scoring

Questions are all-or-nothing for mastery gates. Partial selection on a multiple-answer question is recorded for feedback but does not count as correct. This prevents a learner from passing by recognizing only part of an invariant.

Weighted score uses question difficulty:

| Difficulty | Weight | Expected reasoning |
|---:|---:|---|
| 1 | 1 | Definition or direct identification. |
| 2 | 1.25 | Explain a relationship or predict one step. |
| 3 | 1.5 | Apply a mechanism to a project scenario. |
| 4 | 2 | Diagnose competing causes or choose a safe recovery. |
| 5 | 2.5 | Integrate security, data, runtime, and operational constraints. |

The score is the sum of weights for correct responses divided by the sum of all offered weights. The interface also reports unweighted counts so the weighting is transparent.

## Delayed-review schedule

Correct responses advance through fixed review stages measured from the response time:

| Stage | Delay |
|---:|---:|
| 0 | 10 minutes, used after an incorrect answer in the current session. |
| 1 | 1 day. |
| 2 | 3 days. |
| 3 | 7 days. |
| 4 | 14 days. |
| 5 | 30 days. |
| 6 | 60 days. |
| 7 | 120 days. |

A correct response at confidence 1 or 2 advances at most one stage and is also queued for a same-session related question. A correct response at confidence 3 to 5 advances one stage. An incorrect response resets the item's interval to 10 minutes and lowers the concept's retained evidence. The system does not accept future timestamps more than five minutes ahead of the server clock when importing progress.

## Adaptive review queue

The review queue prioritizes, in order:

1. Overdue critical questions.
2. Unresolved overconfident misconceptions.
3. Other overdue questions, oldest due first.
4. Concepts below the current module's required evidence level.
5. Low-confidence correct answers.
6. New questions selected to balance concepts and skill areas.

The queue never repeats the same question immediately when another question covers the same concept. A deterministic seeded shuffle makes sessions reproducible for tests while varying them for learners.

## Practical evidence

A practical lab has one of three evidence classes.

| Class | Evidence | Strength and limit |
|---|---|---|
| Automated | A whitelisted local checker exits successfully and returns structured observations. | Strong evidence that the specified state or command result exists. It cannot prove who performed the work or that the learner can repeat it without help. |
| Inspected | The learner records a file path, commit hash, command output, or diff and applies a rubric. | Inspectable by a human reviewer, but the academy cannot independently judge quality. |
| Self-attested | The learner confirms a manual or external step, such as using a screen reader or PowerPoint on Windows. | Useful as a reminder; not proof. Never sufficient alone for a critical module gate. |

Automated checkers may read repository files and run a fixed allow-list of validation commands. They may create and remove temporary directories under the operating-system temporary directory. They must not read `api/.env`, print environment variables, contact third-party endpoints, mutate Git history, modify production data, restart processes, run migrations against an unspecified database, or accept shell text from the browser.

## Capstone evidence

The final capstone requires all of the following artifacts on a non-release branch:

- A written problem statement and explicit non-goals.
- A source trace from user action to side effect.
- A small controlled implementation.
- A test or a documented reason the behavior is verified by a smoke test instead.
- Updated canonical documentation.
- Full validation output.
- A reviewed diff with no secrets or generated artifacts.
- A pull request draft with risk and rollback analysis.
- An incident-response exercise that diagnoses a provided failure without making a destructive change.
- An oral or written explanation, in the learner's own words, of the security boundary and data invariant involved.

The academy provides a 100-point rubric. A score of 90 is required, no critical criterion may be zero, and a human reviewer must assess the explanation and change quality before the capstone can be treated as integrated evidence.

## Progress and privacy

Browser progress is stored in `localStorage` under one versioned key. It is never sent over the network. Export produces a JSON file containing question attempts, confidence, review dates, lab results, examination results, capstone rubric entries, and optional learner notes. It contains no cookie, credential, environment variable, or repository file content. Import validates the schema and rejects unknown versions, malformed timestamps, future timestamps, unknown IDs, and impossible scores.

Reset requires typing `RESET` and deletes only the academy key. It never alters repository files.

## What the evidence cannot prove

Even level 6 cannot prove that a learner is a professional or will perform correctly under every real-world condition. The academy cannot independently prove authorship, detect all outside help, simulate team communication and production pressure, or observe months of real operations. Durable mastery is therefore an evidence statement with a documented scope, not a guarantee. The strongest confirmation is academy evidence plus repeated independent work reviewed by experienced maintainers in real conditions.
