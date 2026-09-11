# Academy curriculum schema

The academy loads five core JSON files plus one question-bank file per module from `academy/data/`. This page is the human-readable contract; `academy/validate.mjs` enforces it mechanically. All identifiers use lowercase kebab case and remain stable after release because progress exports refer to them.

## Files

| File | Top-level value | Purpose |
|---|---|---|
| `modules.json` | array of module objects | Sequence, prerequisites, required skills, gate settings, canonical references, and the module's `questionFile`. |
| `concepts.json` | array of concept objects | Atomic learning outcomes and implementation evidence. |
| `questions/<module-id>.json` | array of question objects | One maintainable assessment bank per module. The validator concatenates them and requires each question's `moduleId` to match the file's module. |
| `labs.json` | array of lab objects | Guided and independent practical work with checker mappings. |
| `exams.json` | array of examination objects | Phase and final cumulative examination constraints. |
| `capstones.json` | array of capstone objects | Multi-artifact rubrics and critical criteria. |

Every file is UTF-8 JSON with two-space indentation and a final newline. JSON contains data only. No value is evaluated as code or passed to a shell.

## Module object

```json
{
  "id": "web-http",
  "order": 7,
  "title": "Web, networking, HTTP, and APIs",
  "summary": "Trace a request and reason about its protocol boundaries.",
  "prerequisites": ["dependencies-build"],
  "phase": "development-foundations",
  "requiredSkills": ["recall", "explain", "apply", "diagnose", "secure"],
  "requiredLabs": ["lab-http-observation"],
  "examQuestionCount": 15,
  "questionFile": "questions/web-http.json",
  "passPercent": 90,
  "minimumSkillPercent": 80,
  "references": ["docs/foundations.md#web-and-api-foundations"]
}
```

Rules:

- `order` is a unique positive integer beginning at 1 with no gaps.
- Every prerequisite names an earlier module. The graph must be acyclic.
- `phase` is one of `orientation`, `development-foundations`, `application-development`, `system-engineering`, `production-engineering`, `professional-practice`.
- Every required skill has enough eligible questions to calculate a score.
- `examQuestionCount` is at least 10 and no larger than the eligible bank.
- `passPercent` is at least 90; `minimumSkillPercent` is at least 80.
- Every reference is a valid repository-relative Markdown link and heading anchor.

## Concept object

```json
{
  "id": "http-request-response",
  "moduleId": "web-http",
  "title": "HTTP request and response",
  "definition": "An HTTP exchange consists of a request and one response.",
  "why": "Every browser and automation interaction with airDash uses this contract.",
  "outcomes": [
    "Identify method, path, headers, body, status, and response body.",
    "Trace GET /api/me through Caddy and Express."
  ],
  "references": ["docs/foundations.md#http-requests-and-responses"],
  "sourceEvidence": ["web/src/api.ts:api", "api/src/server.js:app.get(\"/me\")"],
  "critical": false
}
```

Rules:

- A concept belongs to exactly one module.
- `definition`, `why`, and at least two outcomes are required and cannot be duplicates.
- At least one canonical documentation reference and one inspectable source or configuration reference are required.
- Every concept appears in at least two questions: one `recall` or `explain` question and one higher-order question (`apply`, `diagnose`, `secure`, or `operate`).
- Every critical concept appears in at least three questions, one required lab or capstone criterion, and every applicable cumulative examination.

## Question object

```json
{
  "id": "web-http-004",
  "moduleId": "web-http",
  "type": "single",
  "skill": "diagnose",
  "difficulty": 4,
  "critical": false,
  "concepts": ["http-request-response", "caddy-routing"],
  "prompt": "Production /api/health works, but Vite returns Cannot GET /api/health. Which boundary is wrong?",
  "choices": [
    { "id": "a", "text": "The Vite proxy forwards the prefix while Express defines /health." },
    { "id": "b", "text": "PostgreSQL is missing the health table." },
    { "id": "c", "text": "React Router intercepted the API request." },
    { "id": "d", "text": "TLS cannot be used on localhost." }
  ],
  "answer": ["a"],
  "explanation": "Production Caddy removes /api; the committed Vite shorthand does not.",
  "remediation": ["docs/local-development.md#the-proxy-does-not-remove-the-api-prefix"],
  "sourceRefs": ["web/vite.config.ts", "api/src/server.js:app.get(\"/health\")"]
}
```

Types and answer representation:

| Type | Required fields | Correctness |
|---|---|---|
| `single` | 3 to 6 choices, one answer ID | Selected ID equals the answer ID. |
| `multi` | 4 to 8 choices, 2 or more answer IDs | Selected set equals the answer set. No partial mastery credit. |
| `boolean` | no choices; answer `["true"]` or `["false"]` | Exact normalized value. |
| `short` | `accepted` array of normalized strings; optional `pattern` is prohibited | Normalized input equals an accepted value. Regular expressions are not loaded from data. |
| `order` | 3 to 8 choices; `answer` lists every choice ID in order | Selected sequence equals the answer sequence. |

Question rules:

- Skills are `recall`, `explain`, `apply`, `diagnose`, `secure`, or `operate`.
- Difficulty is an integer 1 through 5.
- Every question maps one to three concepts in its own module, except cumulative integration questions, which may map concepts from prerequisite modules and set `integration: true`.
- Prompts and choices must not contain `all of the above`, `none of the above`, trick wording, double negatives, or unexplained acronyms.
- Choice text is unique within the question. Distractors must represent plausible misconceptions, not jokes.
- `explanation` states why the answer is correct and, where useful, why the nearest distractor is wrong.
- At least one remediation link and one source reference are required.
- Critical questions use difficulty 4 or 5 and skill `diagnose`, `secure`, or `operate`.

## Lab object

```json
{
  "id": "lab-api-validation",
  "moduleId": "testing",
  "title": "Run the API validation sequence",
  "class": "automated",
  "tier": "independent",
  "critical": true,
  "concepts": ["api-syntax-check", "unit-tests", "exit-codes"],
  "estimatedMinutes": 20,
  "prerequisites": ["lab-toolchain"],
  "instructions": [
    "Predict which failure class each command detects.",
    "Run the checker without modifying source.",
    "Explain any warning separately from the exit code."
  ],
  "checkerId": "api-validation",
  "evidence": "Structured exit codes and final verification lines.",
  "safety": "Read-only source checks; no database or network access.",
  "references": ["docs/testing.md#running-the-unit-tests"]
}
```

Rules:

- Classes are `automated`, `inspected`, or `self-attested` as defined in the mastery model.
- Tiers are `guided` or `independent`.
- Automated labs name a checker registered in `academy/checks.mjs`; data cannot define a command.
- Inspected labs require an evidence template and rubric. Self-attested labs cannot be critical.
- Every module has at least one lab. Critical modules have at least one automated or inspected lab.
- Lab instructions identify prerequisites, starting state, directory, actions, expected observation, cleanup, and safety.

## Examination object

```json
{
  "id": "exam-development-foundations",
  "title": "Development foundations cumulative examination",
  "kind": "phase",
  "modules": ["orientation", "shell-files", "tooling", "git-github", "javascript", "typescript-react", "dependencies-build", "web-http"],
  "questionCount": 40,
  "passPercent": 90,
  "minimumModulePercent": 85,
  "minimumSkillPercent": 80,
  "minimumDifficulty": 2,
  "requiredCriticalConcepts": ["command-safety", "git-destructive-operations"],
  "attemptCooldownMinutes": 30
}
```

The validator proves that enough questions exist to satisfy the count, module distribution, skills, and critical concepts. The final examination has at least 60 questions and a 24-hour cooldown after a failed attempt.

## Capstone object

A capstone has `id`, `title`, `summary`, `prerequisiteExamId`, `requiredModules`, `artifacts`, `rubric`, `passPoints`, and `references`. Each rubric criterion has an ID, description, points, `critical`, concept IDs, and the evidence expected. Total points equal 100, pass points are at least 90, and every critical criterion must receive nonzero evidence. The browser stores rubric entries and evidence references but does not claim to verify their quality; a human review is required.

## Progress object

Progress exports use this shape:

```json
{
  "schemaVersion": 1,
  "curriculumVersion": "2026.09.1",
  "learner": { "displayName": "", "startedAt": "ISO timestamp" },
  "concepts": {},
  "questions": {},
  "moduleAttempts": [],
  "examAttempts": [],
  "labs": {},
  "capstones": {},
  "studyEvents": [],
  "settings": { "textScale": 1, "highContrast": false, "reducedMotion": false },
  "updatedAt": "ISO timestamp"
}
```

Unknown keys are ignored on import, but known records are validated against current IDs. Imports never execute content. Invalid records are rejected as a whole with a readable error rather than partially merged.

## Coverage invariants

`academy/validate.mjs` fails unless all of the following hold:

1. IDs are unique and references resolve.
2. The prerequisite graph is ordered and acyclic.
3. Every concept meets its question, skill, reference, source-evidence, and practical-evidence requirements.
4. Every module has enough questions and labs for its gate.
5. Every critical concept appears in applicable cumulative exams and practical evidence.
6. Every examination can be sampled under its constraints.
7. Every lab checker is in the server allow-list, and every registered checker is documented by a lab.
8. Every Markdown link and anchor in academy data resolves.
9. Question-quality rules pass.
10. The curriculum version matches the application and progress schema versions.

A code or documentation change that alters a concept, command, route, table, security boundary, deployment procedure, or recovery step must update the academy data and pass this validator in the same pull request.
