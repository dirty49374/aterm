---
name: skill
description: Reusable task knowledge with prerequisite Skills, example-led Markdown bodies and short Reminders.
termKinds:
  - name: skill
    description: Reusable task knowledge, with prerequisite Skills and a Markdown body.
    sections:
      - name: definition
        type: md
        description: The Skill's identity and purpose.
        question: What reusable knowledge does this Skill teach?
      - name: description
        type: md
        description: Standalone text explaining when to choose this Skill.
        question: Which task needs this Skill, and which nearby task does not?
      - name: body
        type: md
        description: Examples and practical guidance, including any inputs, procedure, conditions and completion evidence.
        question: What must the reader understand or do, and how will they know the work is complete?
      - name: reminder
        type: md
        description: Optional short recall cues for a reader who understands this Skill; no new obligations.
        question: Which distinctions, conditions or completion checks should the reader recall before applying this
          Skill again?
  - name: explanation
    description: Reusable explanatory content that makes a subject understandable; it need not direct behavior.
    sections:
      - name: definition
        type: md
        description: The meaning that identifies this Term.
        question: What is _X_? _X_ is ___
        example: >
          User Visible Effect Guide is explanatory material about how a change affects what a product user can
          do.
      - name: applicability
        type: md
        description: The situations and decisions this guidance covers, including relevant boundaries.
        question: Where does _X_ apply? _X_ applies to ___ when ___
        example: |
          Use this explanation when distinguishing a user-visible change from its internal mechanism.
      - name: contract
        type: md
        description: Obligations, including the conditions and purpose of connections to reused guidance.
        question: What governs _X_? _X_ requires ___ and uses ___ when ___
        example: |
          A claim about an effect must be supported by the source change.
      - name: explanation
        type: md
        description: The concepts, context and reasons needed to understand the subject.
        question: What explains _X_? _X_ is understood through ___
        example: |
          A cache rewrite can let users reopen saved searches without adding a new feature.
      - name: validation
        type: md
        description: Evidence for the stated claim, including what the evidence does not establish.
        question: What supports the claim about _X_? The claim about _X_ is supported by ___
        example: |
          Compare the described effect with the behavior changed by the source.
      - name: examples
        type: md
        description: Short contextual GOOD/BAD pairs showing the distinction the reader should apply.
        question: What illustrates _X_? For ___, GOOD is ___; BAD is ___
        example: >
          For a cache rewrite, BAD: assume a new feature; GOOD: identify whether existing search behavior
          changed.
      - name: remarks
        type: md
        description: Chosen modeling decisions and deliberate Non-goals; keep operational obligations in contract.
  - name: principle
    description: A reusable criterion for judging decisions or guiding behavior, independent of any Skill that follows it.
    sections:
      - name: definition
        type: md
        description: The meaning that identifies this Term.
        question: What is _X_? _X_ is ___
        example: >
          Audience Language Principle is the criterion that changes are described through their meaning to the
          intended audience.
      - name: applicability
        type: md
        description: The situations and decisions this guidance covers, including relevant boundaries.
        question: Where does _X_ apply? _X_ applies to ___ when ___
        example: |
          The audience criterion applies to wording intended for product users.
      - name: contract
        type: md
        description: Obligations, including the conditions and purpose of connections to reused guidance.
        question: What governs _X_? _X_ requires ___ and uses ___ when ___
        example: |
          Describe the user-visible effect supported by the source change.
      - name: explanation
        type: md
        description: The concepts, context and reasons needed to understand the subject.
        question: What explains _X_? _X_ is understood through ___
        example: |
          Internal mechanism names can hide the task the audience recognizes.
      - name: validation
        type: md
        description: Evidence for the stated claim, including what the evidence does not establish.
        question: What supports the claim about _X_? The claim about _X_ is supported by ___
        example: |
          Compare the wording with the source change and the audience's vocabulary.
      - name: examples
        type: md
        description: Short contextual GOOD/BAD pairs showing the distinction the reader should apply.
        question: What illustrates _X_? For ___, GOOD is ___; BAD is ___
        example: |
          For product users managing saved searches, BAD: cache entry; GOOD: saved search.
      - name: remarks
        type: md
        description: Chosen modeling decisions and deliberate Non-goals; keep operational obligations in contract.
  - name: rule
    description: A direction stating required, prohibited or recommended behavior under specified conditions.
    sections:
      - name: definition
        type: md
        description: The meaning that identifies this Term.
        question: What is _X_? _X_ is ___
        example: >
          Missing Source Rule is the rule requiring the author to request evidence for an unsupported
          release-note claim.
      - name: applicability
        type: md
        description: The situations and decisions this guidance covers, including relevant boundaries.
        question: Where does _X_ apply? _X_ applies to ___ when ___
        example: |
          Apply when a proposed claim has no identified source change.
      - name: contract
        type: md
        description: Obligations, including the conditions and purpose of connections to reused guidance.
        question: What governs _X_? _X_ requires ___ and uses ___ when ___
        example: |
          Request the missing source before including the claim as a fact.
      - name: explanation
        type: md
        description: The concepts, context and reasons needed to understand the subject.
        question: What explains _X_? _X_ is understood through ___
        example: |
          Plausible wording does not establish that a behavior shipped.
      - name: validation
        type: md
        description: Evidence for the stated claim, including what the evidence does not establish.
        question: What supports the claim about _X_? The claim about _X_ is supported by ___
        example: |
          Inspect whether unsupported claims were held for source confirmation.
      - name: examples
        type: md
        description: Short contextual GOOD/BAD pairs showing the distinction the reader should apply.
        question: What illustrates _X_? For ___, GOOD is ___; BAD is ___
        example: |
          For an unsupported speed claim, BAD: include it as fact; GOOD: request its source first.
      - name: remarks
        type: md
        description: Chosen modeling decisions and deliberate Non-goals; keep operational obligations in contract.
  - name: constraint
    description: A condition limiting acceptable states, results or behavior; a Rule may prescribe how to preserve it.
    sections:
      - name: definition
        type: md
        description: The meaning that identifies this Term.
        question: What is _X_? _X_ is ___
        example: |
          Release Scope Constraint is the condition that reported changes belong to the selected release.
      - name: applicability
        type: md
        description: The situations and decisions this guidance covers, including relevant boundaries.
        question: Where does _X_ apply? _X_ applies to ___ when ___
        example: |
          Apply to the set of changes described in release notes.
      - name: contract
        type: md
        description: Obligations, including the conditions and purpose of connections to reused guidance.
        question: What governs _X_? _X_ requires ___ and uses ___ when ___
        example: |
          Every described change must belong to the selected release.
      - name: explanation
        type: md
        description: The concepts, context and reasons needed to understand the subject.
        question: What explains _X_? _X_ is understood through ___
        example: |
          A true change can still belong to a later release.
      - name: validation
        type: md
        description: Evidence for the stated claim, including what the evidence does not establish.
        question: What supports the claim about _X_? The claim about _X_ is supported by ___
        example: |
          Compare the release membership of each described change with the selected release.
      - name: examples
        type: md
        description: Short contextual GOOD/BAD pairs showing the distinction the reader should apply.
        question: What illustrates _X_? For ___, GOOD is ___; BAD is ___
        example: |
          For release 2.0, BAD: include a 2.1-only change; GOOD: include only 2.0 changes.
      - name: remarks
        type: md
        description: Chosen modeling decisions and deliberate Non-goals; keep operational obligations in contract.
  - name: procedure
    description: A described method with actions and control flow; it can serve as a Step within another Procedure.
    sections:
      - name: definition
        type: md
        description: The meaning that identifies this Term.
        question: What is _X_? _X_ is ___
        example: >
          Release Coverage Review Procedure is a described method for checking a draft against the selected
          release changes.
      - name: applicability
        type: md
        description: The situations and decisions this guidance covers, including relevant boundaries.
        question: Where does _X_ apply? _X_ applies to ___ when ___
        example: |
          Use when a release-note draft is ready for a coverage review.
      - name: inputs
        type: md
        description: Information, materials and preconditions needed for the described work, including missing-input
          handling.
        question: What does _X_ need? _X_ needs ___; if missing, ___
        example: |
          Review needs a draft and the selected release changes; request either when missing.
      - name: contract
        type: md
        description: Obligations, including the conditions and purpose of connections to reused guidance.
        question: What governs _X_? _X_ requires ___ and uses ___ when ___
        example: |
          Release Coverage Review Procedure satisfies Release Scope Constraint when assessing each claim.
      - name: explanation
        type: md
        description: The concepts, context and reasons needed to understand the subject.
        question: What explains _X_? _X_ is understood through ___
        example: |
          A completed review may find that the draft is not ready to publish.
      - name: procedure
        type: md
        description: Actions and their control flow, including dependent inputs, branches, repetition and stopping.
        question: How is work under _X_ performed? Under _X_, perform ___; continue when ___; stop when ___
        example: |
          Match draft claims to changes, identify missing or unsupported claims, then return findings.
      - name: outputs
        type: md
        description: Results or changed state, including what is reported when work remains incomplete.
        question: What results from _X_? _X_ produces ___; if incomplete, it reports ___
        example: |
          Return coverage findings, or report which missing input prevents review.
      - name: validation
        type: md
        description: Evidence for the stated claim, including what the evidence does not establish.
        question: What supports the claim about _X_? The claim about _X_ is supported by ___
        example: |
          Verify that every draft claim and source change has a recorded review outcome.
      - name: examples
        type: md
        description: Short contextual GOOD/BAD pairs showing the distinction the reader should apply.
        question: What illustrates _X_? For ___, GOOD is ___; BAD is ___
        example: >
          For an unsupported claim, BAD: mark the draft valid because review finished; GOOD: return the
          finding.
      - name: remarks
        type: md
        description: Chosen modeling decisions and deliberate Non-goals; keep operational obligations in contract.
  - name: resource
    description: Supporting material that can be read, executed or incorporated into work, distinct from the roles
      of its content.
    sections:
      - name: definition
        type: md
        description: The meaning that identifies this Term.
        question: What is _X_? _X_ is ___
        example: |
          Release Notes Template is the source material for a draft structure.
      - name: applicability
        type: md
        description: The situations and decisions this guidance covers, including relevant boundaries.
        question: Where does _X_ apply? _X_ applies to ___ when ___
        example: |
          Use the template when creating a release-note draft.
      - name: location
        type: md
        description: The Resource address and the environment or version needed to resolve it.
        question: Where is _X_ found? _X_ is found at ___ under ___
        example: |
          The release-note template is at templates/release-notes.md relative to the project root.
      - name: contract
        type: md
        description: Obligations, including the conditions and purpose of connections to reused guidance.
        question: What governs _X_? _X_ requires ___ and uses ___ when ___
        example: |
          Replace template placeholders with supported release-specific content before publication.
      - name: explanation
        type: md
        description: The concepts, context and reasons needed to understand the subject.
        question: What explains _X_? _X_ is understood through ___
        example: |
          Template headings organize the draft but do not establish its factual claims.
      - name: usage
        type: md
        description: How to read, execute or incorporate the Resource, including necessary prerequisites.
        question: How is _X_ used? Use _X_ by ___ when ___
        example: |
          Copy the template headings when drafting release notes.
      - name: validation
        type: md
        description: Evidence for the stated claim, including what the evidence does not establish.
        question: What supports the claim about _X_? The claim about _X_ is supported by ___
        example: |
          Check that the template resolves and its headings suit the intended release notes.
      - name: examples
        type: md
        description: Short contextual GOOD/BAD pairs showing the distinction the reader should apply.
        question: What illustrates _X_? For ___, GOOD is ___; BAD is ___
        example: >
          For a new draft, BAD: publish template placeholders; GOOD: fill relevant sections with supported
          content.
      - name: remarks
        type: md
        description: Chosen modeling decisions and deliberate Non-goals; keep operational obligations in contract.
---

# Skill

A Skill teaches reusable knowledge or a way to perform work. It need not contain a procedure.
Supporting principles, rules, constraints, explanations, procedures and resources remain plain Knowledge; no guidance protocol is interpreted for them.

## Author with the common Skills

Use Corpus Authoring Skill for source changes, Modeling Skill for unsettled meaning, and Model Review Skill for evidence and coverage.
This Viewpoint owns the Skill-specific guidance below; it takes precedence over general Skill guidance when writing in this Viewpoint.
Read unfamiliar or forgotten common Skills in this order. Reading is not execution.

1. _aterm_skills:Corpus_Authoring_Skill_
2. _aterm_skills:Model_Review_Skill_

```sh
aterm viewpoint view skill
aterm skill view _aterm_skills:Aterm_Basics_Skill_ _aterm_skills:Corpus_Authoring_Skill_ _aterm_skills:Corpus_Reading_Skill_ _aterm_skills:Naming_Skill_ _aterm_skills:Model_Review_Skill_
```

Use only the relevant sections below. For non-Skill supporting Terms, follow their own Term Kind schemas; description/body/reminder and requires apply to the skill Term Kind.

## Choose the authoring scope

- Design and writing use the shared guidance below; evaluate the actual consumer readings before authoritative apply, with verification proportionate to the semantic impact.
- Independent review is mandatory for changes to Aterm-provided Skills, including additions, deletions and shared-source changes that alter their rendered guidance.
- User-authored Skills do not inherit this requirement; review them independently only when requested or required by their own project policy.
- Apply the Independent review section when required. Merely reading this Viewpoint does not launch subagents.

## Give the Skill one readable purpose

- Read the current skill Viewpoint before authoring. The Term Kind is skill.
- Definition names the guidance; description says when to read it; body teaches its knowledge or application.
- Optional reminder recalls existing knowledge for a reader who already understands the Skill; if authored, it must be nonempty.
- Keep a meaningful Skill head and an activation description that distinguishes nearby tasks.

> Update — unclear identity and activation.
>
> Corpus Maintenance Skill — clarify, rename, move or repair while preserving supported meaning.

- State needed current inputs, expected outcomes and limits in plain Markdown; read inputs again for each task.
- Use only the sections the explanation needs. A Skill may teach a concept, criterion or reference; it need not invent a procedure.
- Target at most 300 rendered view lines per Skill, including title, Definition and Reminder, and 20 rendered reminder lines. These advisory targets do not truncate output or reject longer readings.
- Count the whole prerequisite chain separately; short lines alone do not prove a low reading cost.

## Declare knowledge dependencies

- requires points to another skill whose knowledge is needed throughout this Skill; a task-specific branch reads its additional guidance only when that branch applies.
- Read unknown or forgotten prerequisites in the entrypoint's dependency-first order, then read the selected Skill.
- A prerequisite does not instruct the reader to execute its procedure.

> Requires Naming Skill, therefore rename something before reading this Skill — BAD.
>
> Understand subject naming before evaluating a proposed identity change — GOOD.

- Put conditional actions in body with their condition and return point; declare an ordinary reference to the target Skill.

> If ownership is unsettled, perform Modeling Skill, then refresh the original rename request — GOOD.

- Keep one shared owner for reusable knowledge; link to it rather than duplicating its complete instructions.
- derived_from records the authoritative Terms used to write an explanation; it is neither a prerequisite nor an execution edge.
- Declare every non-self reference per Term Declaration. Avoid circular prerequisites and circular derivation.

```trm
@knowledge stock_guidance
@viewpoints skill
skill _Stock_Identity_Skill_ = {
  A Skill for understanding stable stock identity.
.description
  Use before naming stock-change operations.
.body
  - A stock identity survives a display-label change.
.reminder
  - Label changes do not create a new stock identity.
}
skill _Stock_Naming_Skill_ = {
  A Skill for choosing stable stock-operation names.
.relations
  requires _Stock_Identity_Skill_
.description
  Use when naming stock-change operations.
.body
  - Name the operation by its defined effect.

  > Update — BAD.
  >
  > Reserve Stock — GOOD for the act of reserving stock.
}
```

- Add derived_from declarations to the actual authoritative Terms used by a rewritten Skill; this standalone syntax example has no external sources.
- A section dagger expands shared content where written. Preserve its prerequisites and conditions when selecting a fragment; expansion alone does not perform its instructions.

## Separate the entrypoint from its reading

- SKILL.md is the entrypoint: Definition, prerequisite reading order, selected Skill and one batch-reading command.
- Generate it with `aterm skill toc <Skill>` from Definition and requires; do not author a second TOC or prerequisite list.
- `aterm skill view <Skill...>` prints the actual selected bodies and Reminders without repeating navigation.
- Put shared prerequisites first and the selected Skill last; omit prerequisites the reader already understands.

> Read each body and receive the same prerequisite navigation again — BAD.
>
> Read the entrypoint once, then fetch the needed bodies together — GOOD.

- Keep application conditions and current-input acquisition in body; a TOC is not task knowledge.
- skill install/update wraps each generated TOC in activation frontmatter. Every skill Term Declaration is included; no registration YAML is needed.
- Keep descriptions nonempty and at most 1024 characters; qualified-name-derived install IDs must be unique and fit the 64-character naming limit.

## Recall without reteaching

- Put .reminder after .body; use short Markdown cues rather than a generated summary.
- Recall important distinctions, conditions and completion checks already taught by the Skill or its prerequisites.

> Body allows a retry only after checking current state; Reminder says always retry — BAD.
>
> Check current state before retrying — GOOD.

- Do not introduce new obligations in Reminder or invent steps for a knowledge-oriented Skill.
- Name a shared Skill when its knowledge needs recalling; forgotten guidance requires view.
- Full view includes Reminder. Remind prints only selected Skills' cues and a full-reading command; it does not automatically compose prerequisite reminders.
- A missing Reminder is reported explicitly. It does not imply that nothing needs recalling.
- Review body and Reminder together when either the Skill or a prerequisite changes; structural checks cannot establish semantic agreement.

## Put the example beside the decision

- Follow each rule or step with its relevant example, preferably a compact blockquote or executable snippet.

> Separate ten rules from a later Examples section — BAD.
>
> Explain canonical naming, then show the conflicting and canonical names immediately below — GOOD.

- Use representative GOOD and BAD cases that demonstrate the distinction; do not manufacture a counterpart for every bullet.
- State conditions, failures, stopping criteria and completion evidence where the reader applies them.
- Check the consumer-visible reading using only declared prerequisites and current inputs; exercise affected behavior when the change warrants it. Hidden prior conversation is not a prerequisite.
- Keep authoritative obligations authoritative; an example cannot introduce a new policy without a supported source decision.
- Use English examples that change a decision; omit generic advice the intended reader already knows.
- Distinguish the Definition of the guidance artifact from the result of applying it.

- An Agent can choose a useful alternative method while preserving constraints and outcomes; do not encode one reasoning sequence as the only valid intelligence.

> Use a counterexample to reveal a missing boundary — GOOD.
>
> Require ten intermediate reports for a wording correction — BAD.

## Draft from the task and evidence

1. Obtain the requested outcome, source account, intended environment and current owning Term Declarations with Scope.
2. Create a draft from that evidence; validate any supplied seed against the current context.
3. Define activation, applicability, required current inputs and the intended outcome.
4. Compose shared Skills through requires; keep conditional calls and their return points in body.
5. Add authoritative derived_from sources, completion evidence and representative GOOD/BAD examples next to the rule they illustrate.

> Paste an entire supporting Skill into each body — BAD.
>
> Require the common Skill and teach only this task's additional decisions — GOOD.

- Author a separate Reminder from existing knowledge and conditions; check its agreement with body and prerequisites. Put any cue example immediately below that cue.

6. If a reusable subject lacks a settled identity or boundary, use _aterm_skills:Modeling_Skill_ (“Choose the entry condition” through “Return a consistent final state”) for a new or revised model without saving. Return with supported identities and boundaries for this guidance, explicit pending questions and any revision impact plan, then refresh this combined draft and include its preservation/migration changes before acceptance.
7. Perform _aterm_skills:Model_Review_Skill_ (“Review the complete subject”) on the complete draft and source coverage.
8. Preserve baseline and candidate sources. Choose validation by impact: wording/example changes need a source diff, relevant rendered readings and structural checking; activation, dependency or shared behavioral changes need affected-route exercises.
9. Use an isolated candidate Home/package when needed to render or exercise changed dependencies without changing authoritative guidance. For shipped assets, --home alone does not replace the executable’s packaged sources; use an independent package with the proposed assets and same build.
10. Render the exact candidate TOC, body, Reminder and affected prerequisites; verify selected-Skill-last order, references and cue agreement. For pure prose changes, a faithful rendering of the changed sections plus the unchanged renderer’s output is sufficient; disclose how it was produced.
11. Exercise representative normal, refusal/recovery or nearby non-activating cases where the changed behavior makes them relevant. Keep mutations disposable and distinguish observed execution from a document-based scenario review.

```sh
aterm --home /tmp/stock-candidate/.aterm corpus check
aterm --home /tmp/stock-candidate/.aterm skill toc _stock_guidance:Stock_Naming_Skill_
aterm --home /tmp/stock-candidate/.aterm skill view _stock_guidance:Stock_Identity_Skill_ _stock_guidance:Stock_Naming_Skill_
aterm --home /tmp/stock-candidate/.aterm skill remind _stock_guidance:Stock_Naming_Skill_
```

12. Resolve findings, refresh the candidate and repeat affected checks. Derive the final change set from the accepted candidate and original baseline; evidence for an earlier candidate does not verify a later edit.
13. Perform _aterm_skills:Corpus_Authoring_Skill_ (“Apply and verify”) on the intended authoritative Home, then compare its saved source and toc/view/remind with the accepted candidate and verify affected uses against any revision impact plan. Return blockers rather than applying an unaccepted state.

Completion: the saved Skill teaches its supported purpose with reusable dependencies and current validation evidence proportionate to its impact. Record observed application evidence where affected behavior warrants execution, and label document-only validation honestly. A reference must not silently execute an action; a clean structural check is not an efficacy test. For Aterm-provided Skills, complete Independent review before applying the candidate; for user-authored Skills, apply it only when requested or required by their project policy.

## Independent review

- Review the intended change, not conformity to the old wording. An intentional deletion can improve a Skill.
- Use a fresh subagent that did not author the candidate. In the Aterm repository, use the Aterm Skill Reviewer agent defined by its repository instructions.
- Let the reviewer choose its reasoning method; require evidence for its conclusions, not a fixed thinking sequence.

### Prepare the review packet

- State the requested outcome, why it matters, what should change and what should remain supported.
- Preserve the original baseline and the candidate, with their complete TOC, body and Reminder readings, prerequisites and conditional guidance needed for the reviewed task.
- Include source diffs, exact Skill IDs, current validation/exercise evidence and known limitations. For additions or deletions, explicitly mark the absent side and account for callers and prerequisite edges.
- Select every Skill affected by changed shared guidance; include all Skills when the impact boundary is uncertain.
- Freeze one packet per selected Skill with content hashes and a packet SHA-256. The packet must identify the exact sources and readings under review.

> Review a shortened body without its previous conditions — BAD.
>
> Compare the old and proposed readings against the request, including deliberately removed conditions — GOOD.

- skill provides list/toc/view/remind, not export/review commands. Capture CLI or MCP output without inventing a skill export command.
- Keep earlier packets after revisions; evidence for an old candidate does not validate a new edit.

### Obtain an independent report

- Assign each selected packet to a distinct fresh subagent. Supply the packet and review instructions, without other reviewers' conclusions; the reviewer reports without editing the candidate.
- Require skill ID, reviewer ID, packet_sha256, verdict (pass or revise), intent assessment and a change inventory separating changed, removed, added and accidentally omitted information.
- Require findings with necessity (required or optional), source location/evidence, the concrete consequence and a suggested correction; include strengths and open questions.
- Compare meaning, activation, prerequisites, conditions, examples, provenance, completion evidence, TOC and Reminder agreement. Use these as review lenses, not quotas for extra content.
- Distinguish an intended removal from an accidental omission. Do not restore a constraint merely because it existed before.

> Request: allow useful alternative methods. Review: restore the old fixed sequence — BAD without a concrete reason.
>
> Check that alternatives remain possible and that scope, supported meaning and material problem reporting survive — GOOD.

- Return revise for a concrete intent mismatch, unsupported loss, contradiction or insufficient evidence to assess the change. Explain the failing case.
- Optional improvements and stylistic preferences do not block pass. Do not invent missing content just to fill a checklist.
- Document review does not prove real-world effectiveness. State what was exercised and what remains untested.

### Accept only the reviewed candidate

- Check the report's Skill ID, reviewer identity and packet hash before counting it. Missing reports, invalid reports and mismatched snapshots are incomplete review.
- Resolve required findings at their owners, then freeze and independently review the affected packets again. Record optional suggestions separately.
- Every affected Aterm-provided Skill must have a matching pass before authoritative apply, commit as accepted, installation or publication. Pending required findings are not a pass.
- Compare the applied source and rendered readings with the accepted candidate; later source or dependency changes invalidate the affected pass.
- If review cannot be completed, preserve the draft and report the blocker. Do not substitute the author's own approval.

Completion: the intended change is supported by matching independent reports, the accepted snapshot matches the applied result, and remaining execution-evidence limits are explicit.

## Authoring reminders

- Teach useful methods with room for alternatives; preserve constraints and report material guidance problems.
- State purpose, activation, current inputs and completion evidence.
- Use requires for universal prerequisite knowledge and conditional body routes for optional work.
- Keep examples beside decisions and derived_from tied to authoritative sources.
- Reminder recalls existing conditions; inspect TOC, body, cues and complete reading cost.
- Validate exact candidate readings with effort matched to impact; use isolation and execution exercises where needed, and compare the saved result.
- Aterm-provided Skill changes require independent pass on the exact candidate; user-authored Skills are exempt unless their task or policy requires review.
- Compare intent and changed, removed, added or omitted information; refresh affected reviews after edits.
- Resolve findings at their owners; keep document review separate from execution evidence.

## Guidance sources

This explanation is derived from the following authoritative Terms. These are provenance, not a prerequisite reading or execution list.

- _aterm:Method_Selection_Principle_
- _aterm:Skill_Reading_
- _aterm:Command_Invocation_Guide_
- _aterm:Skill_
- _aterm:Query_Service_
- _aterm:Modeling_Convergence_Procedure_
- _aterm:Model_Term_Declaration_Completion_Procedure_
- _aterm:Modeling_Coverage_Check_Procedure_
- _aterm:Specification_Synchronization_Rule_
- _aterm:Task_
- _aterm:Consistent_Naming_Principle_
- _aterm:Environment_
- _aterm:Change_Set_
- _aterm:Corpus_Validation_Procedure_
- _aterm:Guidance_Catalog_
- _aterm:Skill_Composition_Guidance_
- _aterm:Skill_Viewpoint_Guidance_
- _aterm:Source_Authoring_
- _aterm:Workspace_File_Access_
- _aterm:Syntax_
- _aterm:Edit_Term_Declarations_
- _aterm:Rename_Corpus_Identities_
- _aterm:Move_Terms_
- _aterm:Knowledge_
- _aterm:Target_Context_
- _aterm:Account_
- _aterm:Model_Development_Procedure_
- _aterm:Change_Impact_Review_Procedure_
- _aterm:Model_Authoring_Guidance_
- _aterm:Semantic_Review_Procedure_
- _aterm:Corpus_Change_Application_Procedure_
- _aterm:GraphQL_Query_
- _aterm:Corpus_Query_Procedure_
- _aterm:Corpus_Notation_Guide_
- _aterm:Relation_
- _aterm:Search_Space_
- _aterm:Semantic_Review_Guidance_
- _aterm:Change_Review_Guidance_
