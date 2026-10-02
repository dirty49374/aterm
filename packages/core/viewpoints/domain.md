---
name: domain
description: What is true of a subject whether or not any software exists for it.
termKinds:
  - name: entity
    description: Something whose identity persists through change. Two with identical attributes can still be different things.
    sections:
      - name: definition
        type: md
        description: What the Term denotes, and what distinguishes it from the thing standing next to it.
        question: What is _X_, and what tells one from another? _X_ is ___; one _X_ is told from another by ___, and stays that same _X_ while ___ changes
      - name: invariants
        type: md
        description: What is always true of it, including how it connects to other Terms. Not chosen, not changeable.
        question: |
          What does _X_ hold? _X_ holds ___
          What is true of _X_ in every state? Always true of _X_ is ___
          How many _X_ can exist at once, and per what? At most ___ _X_ exist at once, per ___
      - name: states
        type: md
        description: The states it can be in and the transitions that are legal. Say which are forbidden.
        question: |
          What states can _X_ be in? _X_ is one of ___
          What moves _X_ between them? ___ takes _X_ from ___ to ___
          Which transition must never happen? _X_ must never go from ___ to ___
      - name: rules
        type: md
        description: What this domain decided and someone could decide differently.
        question: |
          What is done when _X_ is lost, destroyed or disputed? When _X_ is lost, destroyed or disputed, ___
          Which constraint could a different project drop? Without ___ it would still be _X_
      - name: boundary
        type: md
        description: What this Term deliberately does not decide, so no reader infers a rule that is not there.
        question: |
          What does _X_ deliberately not decide? _X_ does not decide ___
          What would a reader wrongly infer from _X_? _X_ says nothing about ___
      - name: remarks
        type: md
        description: Rationale, background and examples. Never an obligation.
  - name: value
    description: Something defined entirely by its attributes. Two that are equal are interchangeable, and it has no lifecycle of its own.
    sections:
      - name: definition
        type: md
        description: What the Term denotes, and what distinguishes it from the thing standing next to it.
        question: What is _X_, and when are two the same? _X_ is ___; two _X_ are the same _X_ exactly when ___
      - name: invariants
        type: md
        description: What is always true of it, including how it connects to other Terms. Not chosen, not changeable.
        question: |
          What does _X_ carry? _X_ carries ___
          What is always true of _X_? Always true of _X_ is ___
          What are the unit and the bounds of _X_, and which values must it never take? _X_ is counted in ___, from ___ to ___; it must never be ___
      - name: rules
        type: md
        description: What this domain decided and someone could decide differently.
        question: Which constraint could a different project drop? Without ___ it would still be _X_
      - name: boundary
        type: md
        description: What this Term deliberately does not decide, so no reader infers a rule that is not there.
        question: |
          What does _X_ deliberately not decide? _X_ does not decide ___
          What would a reader wrongly infer from _X_? _X_ says nothing about ___
      - name: remarks
        type: md
        description: Rationale, background and examples. Never an obligation.
  - name: event
    description: A fact about a completed occurrence, named so the event identity is explicit, that nothing can later alter.
    sections:
      - name: definition
        type: md
        description: What the Term denotes, and what distinguishes it from the thing standing next to it.
        question: What happened, and when is it settled? _X_ has happened once ___; after that ___ can no longer change
      - name: invariants
        type: md
        description: What is always true of it, including how it connects to other Terms. Not chosen, not changeable.
        question: |
          What must be recorded of _X_ for a later rule to read it, and which rule reads it? _X_ records ___; ___ reads it later
          What must have been true for _X_ to happen? _X_ happens only after ___
      - name: boundary
        type: md
        description: What this Term deliberately does not decide, so no reader infers a rule that is not there.
        question: |
          What does _X_ deliberately not decide? _X_ does not decide ___
          What would a reader wrongly infer from _X_? _X_ says nothing about ___
      - name: remarks
        type: md
        description: Rationale, background and examples. Never an obligation.
  - name: policy
    description: A decision the domain made that could have been made otherwise, named because many places refer to it.
    sections:
      - name: definition
        type: md
        description: What the Term denotes, and what distinguishes it from the thing standing next to it.
        question: What was decided, and what is the opposite? _X_ decides ___; it could instead have decided ___
      - name: invariants
        type: md
        description: What is always true of it, including how it connects to other Terms. Not chosen, not changeable.
        question: |
          What does _X_ govern? _X_ governs ___
          What is always true wherever _X_ applies? Always true under _X_ is ___
      - name: rules
        type: md
        description: What this domain decided and someone could decide differently.
        question: |
          What does _X_ require, one checkable rule at a time? _X_ requires ___
          When would _X_ change? _X_ changes when ___
          Who may set _X_ aside or override it, and on what grounds? _X_ may be set aside by ___ when ___
      - name: boundary
        type: md
        description: What this Term deliberately does not decide, so no reader infers a rule that is not there.
        question: |
          What does _X_ deliberately not decide? _X_ does not decide ___
          What would a reader wrongly infer from _X_? _X_ says nothing about ___
      - name: remarks
        type: md
        description: Rationale, background and examples. Never an obligation.
  - name: procedure
    description: An operation with inputs, decisions, effects and outcomes.
    sections:
      - name: definition
        type: md
        description: What the Term denotes, and what distinguishes it from the thing standing next to it.
        question: What does _X_ do? _X_ does ___
      - name: invariants
        type: md
        description: What is always true of it, including how it connects to other Terms. Not chosen, not changeable.
        question: |
          What does _X_ take, produce, change? _X_ takes ___, produces ___, changes ___
          What does _X_ leave untouched? _X_ leaves ___ exactly as it was
          What invokes _X_, and what does _X_ invoke? _X_ is invoked by ___ and invokes ___
          What is true of the result whatever the input? Whatever it is given, _X_ ___
      - name: rules
        type: md
        description: What this domain decided and someone could decide differently.
        question: |
          What does running _X_ twice do? _X_ run twice ___
          What must be true before _X_ may run? _X_ may run only when ___
          When does _X_ refuse? _X_ refuses when ___
          What is left changed when _X_ refuses? When _X_ refuses, ___ is left changed
          Where does order carry meaning? _X_ must ___ before ___
      - name: boundary
        type: md
        description: What this Term deliberately does not decide, so no reader infers a rule that is not there.
        question: |
          What does _X_ deliberately not decide? _X_ does not decide ___
          What would a reader wrongly infer from _X_? _X_ says nothing about ___
      - name: remarks
        type: md
        description: Rationale, background and examples. Never an obligation.
        question: Why is _X_ separate from _Y_? _X_ is separate because ___
  - name: undecided
    description: A Term whose classification is deliberately deferred.
    sections:
      - name: definition
        type: md
        description: What the Term denotes, and what distinguishes it from the thing standing next to it.
        question: What is _X_, as far as the account says? _X_ is ___
      - name: invariants
        type: md
        description: What is always true of it, including how it connects to other Terms. Not chosen, not changeable.
        question: What is already known to hold? Already true of _X_ is ___
      - name: rules
        type: md
        description: What this domain decided and someone could decide differently.
      - name: boundary
        type: md
        description: What this Term deliberately does not decide, so no reader infers a rule that is not there.
        question: |
          What does _X_ deliberately not decide? _X_ does not decide ___
          What would a reader wrongly infer from _X_? _X_ says nothing about ___
      - name: remarks
        type: md
        description: Rationale, background and examples. Never an obligation.
        question: |
          Which test nearly answered, and what stopped it? ___ nearly answered, stopped by ___
          What would settle the classification? It would be settled by ___
---

# Domain viewpoint

Describe the subject, not the system. A domain Term Declaration must stay true if the
software is thrown away and the work is done by hand on paper. Everything that is
only true because of a database, a framework, a screen or a deadline belongs to a
different viewpoint.

Name every important thing once. One thing must not have two names, and two things
must not share one. Every later section hangs off those names, so a vocabulary that
drifts takes the rest of the model with it.

## Two tests

Apply both to every sentence before you keep it.

**Would it still be true by hand?** If yes, it is domain. If it is true only because
of how the system stores, computes or transports something, it belongs to the
specification or the design.

**Can code contradict it?** You must be able to say *the domain says this, the code
does that, so the code is wrong*. A sentence that no implementation could ever
violate is decoration. Most decoration is a definition repeating the name, or a
wish wearing the grammar of an invariant.

The second test removes more text than the first.

## What becomes a Term

A noun that names a property of an existing Term is a field of that Term, not a
Term. The one who acts is carried by the procedure and is a Term only when a rule
depends on which actor it is. A place or a device stays in the definition of what
happens there. Every other noun the subject cannot be told without is an entity, a
value or a policy by the tests above; every verb phrase that changes something is a
procedure. A fact about a completed occurrence that a rule later depends on is an event, not a
property of what carries its record: "since it was paid" names the payment as a fact
with a moment, and the stamp on the ticket is only where that fact is written down.

## What earns a Term

Use these criteria to judge substantive independent meaning; the number of references or words is not a quality score. Keep when a supported criterion holds; preserve relevant content on its owner when dropping a candidate.

| Keep when | The row fails when |
| --- | --- |
| Its own answers hold something code could contradict | Its own answers are `nothing`, or decoration no implementation could violate |
| Other subjects need its independently meaningful identity | References were added only to justify a redundant name |
| Its answers hold what only this subject says | Its answers are what anyone already knows |
| A named subject makes an important distinction usable | A short owner field preserves the same meaning without independent identity |
| The model could not say something without it | Everything it says, the other Terms say |
| Other Terms name it under other words, which one name gathers | No other Term reaches for it |

Reconciling a model with code is a separate pass, not part of these questions: what the
evidence holds, reaches, contradicts, enforces or refuses on that the model does not. Ask
it when code exists and the comparison can test the current claim; inspect affected Terms, keep uncertainty explicit and do not treat code alone as the intended contract.

## Writing the definition

Say what the Term denotes and what separates it from its nearest neighbour. The
second half carries the weight. A definition that expands the name has said nothing,
and a definition that lists usefulness has described a benefit rather than a thing.

## Invariants and rules

Split them, because code disagreeing with each means something different. Code that
breaks an invariant is a defect. Code that breaks a rule may instead mean the rule
changed and nobody updated this document. The reader cannot reach either verdict
if both live in one list.

An invariant is derivable or definitional. *An order total equals the sum of its
line items.* A rule was chosen and could have gone the other way. *A refund is
allowed within thirty days.* When you cannot tell, ask whether a person in the
business could decide otherwise next quarter. If they could, it is a rule.

Declare connections in the reserved `.relations` section after definition.
Write `phrase _Target_` on the active side, for example `contains _Order_Line_`.
Declare every non-self Term referenced by that Term Declaration. Structural conditions stay
in `invariants`; chosen policies stay in `rules`. A Relation label alone does not
imply that every condition of its use is always true.

## States and transitions

An `entity` earns its kind by having a lifecycle, so write it. List the states
and the transitions that are legal. Which transitions are forbidden is usually the
more useful half, and it is the half a reader cannot guess.

## The boundary

Write what the Term does not decide. This section exists as its own field because
a field gets filled and a habit gets skipped, and because leaving it out is how a
domain quietly spreads into everything below it.

Two things go here. What is genuinely outside the subject, and what is inside the
subject but deliberately left open. Say which. Without it the next reader infers a
rule from the first implementation they happen to read.

## Exceptional cases

The exceptions the domain itself has an answer for are domain, not noise. How a
discrepancy is reconciled when the money does not balance, what the clerk does on
paper when the terminal is down, who is allowed to override and on what grounds.
These are rules, and they belong here. Only technical failure handling is excluded.

## What never goes in

Storage, computation and transport. Anything whose reason is a framework, a
performance concern or a release date. Screens, actors and the order a user happens
to click things in. Error handling that exists because a machine can fail.
