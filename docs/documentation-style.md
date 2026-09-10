# airDash documentation style standard

Adopted 2026-08-09. All documentation in this project is written in the style of an AWS
technical user guide. This standard applies to project documentation (roadmap, operations
manual, design documents, certification documents). It does not apply to chat conversation,
Discord posts, or marketing copy on the website.

The document must read like durable technical documentation intended for a competent reader
who has no prior knowledge of the project. Do not write it like personal notes, a startup
manifesto, a README, a project tracker, a Discord message, or an AI-generated implementation
plan. Optimize for clarity and unambiguous understanding, not brevity.

## Style rules

- Use complete grammatical sentences in normal prose.
- Prefer neutral, declarative language. Make the subject of the documentation more prominent
  than the personality of the author.
- Begin a major section by explaining what the subject is, what purpose it serves, and how it
  relates to the larger system before describing what the reader must do.
- Explain relationships explicitly. Do not rely on compressed phrases such as "X + Y", arrows,
  shorthand, or sentence fragments when a complete sentence would explain the relationship
  more clearly.
- It is acceptable to repeat important terminology when repetition prevents ambiguity. Do not
  aggressively eliminate repetition merely to make the document shorter.
- Use active voice when practical.
- Use "you" when explaining an action that the reader performs. Use the name of the component,
  organization, process, or system when describing its behavior.
- Define specialized terminology and acronyms when they are first introduced.
- Prefer specific nouns over vague references such as "this", "that", or "it" when the
  specific noun improves clarity.
- When describing a sequence, state the sequence explicitly with terms such as "first",
  "then", "after", "before", and "when".
- When describing a dependency, state why the dependency exists.
- When describing a requirement, distinguish requirements from recommendations and optional
  behavior.
- Do not imitate marketing copy. Avoid superlatives, hype, and dramatic language.
- Never optimize a sentence merely because a shorter sentence sounds cooler.
- Do not use em dashes.

## Information structure

Organize information by concept rather than by the author's train of thought. Where
appropriate, structure a topic in this order: definition or overview, purpose, relationship
to other components, requirements or prerequisites, procedure, expected result, exceptions
or limitations, references.

Separate conceptual information from procedures. Separate requirements from implementation
decisions. Separate current behavior from planned behavior. Give independent concepts their
own descriptive subsection headings.

## Headings

Use descriptive headings that identify the subject, such as "DOT economic authority" or
"Performance assessment and proving tests". Avoid headings whose primary purpose is
personality or dramatic effect.

## Prohibited voice

Do not use an edgy, clever, punchy, founder-journal, or "cool technical" voice. Avoid
label-as-sentence constructions ("BUILD:", "READ:", "TASKS:", "Parked", "Canon ruling"),
rhetorical shorthand ("the X playbook", "no X before Y", "anti-slop", "ship it"), and
fragments used as stylistic punch lines. Write the complete sentence instead.
