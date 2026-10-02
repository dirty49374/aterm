---
name: specification
description: Naming what a subject is and what it does, before any solution exists.
termKinds:
  - name: concept
    description: A thing, a data shape, a state or a rule set. In code it becomes a structure.
    sections:
      - name: definition
        type: md
        description: What the Term denotes and what distinguishes it. One or two sentences.
        question: What is _X_? _X_ is ___
        example: |
          _Slot_ is a position holding a stock of one _Product_ at one price.
          Head noun "position": the kind, no gap. _Product_: a Term, so a Relation, _Slot_ contains _Product_. Stock and price: plain properties; Field rule, on Given.
      - name: contract
        type: md
        description: The constraints that hold and the obligations it carries, one checkable rule per bullet.
        question: |
          What does _X_ have? _X_ has ___
          What changes _X_? _X_ is changed by ___
          What matters about _X_? What matters about _X_ is ___
        example: |
          _Slot_ has a stock count and a price.
          Two plain properties, already on Given. Each becomes an invariant bullet under an ordinary heading: `A _Slot_ stock count must not be negative.`

          _Slot_ is changed by _Purchase_Product_ and by the operator restocking it.
          _Purchase_Product_: a Term, so a Relation, written on _Purchase_Product_ as the active side. Restocking, a verb phrase: candidate procedure _Restock_Slot_. The operator: Actor rule, on Given. Nothing is written on _Slot_ for this answer.

          What matters about _Slot_ is that it can be empty.
          A state of the owner, made of a plain property: a rule under an ordinary heading, `A _Slot_ with a stock count of zero is empty.` The answer holds something; the prune counts that.
      - name: remarks
        type: md
        description: Rationale, examples, and the decisions you chose. Never an obligation.
  - name: procedure
    description: An operation with inputs, decisions, effects and outcomes. In code it becomes a function.
    sections:
      - name: definition
        type: md
        description: The operation, what it acts on, and what it produces. One or two sentences.
        question: What does _X_ do? _X_ does ___
        example: |
          _Purchase_Product_ does deliver one _Product_ from a selected _Slot_ in exchange for _Credit_.
          One clause of Terms. The verb, deliver, labels a Relation, _Purchase_Product_ delivers _Product_. No gap. This answer is the Definition.
      - name: contract
        type: md
        description: Accepted inputs, effects, ordering where order carries meaning, and failure behaviour.
        question: |
          What does _X_ take, produce, change? _X_ takes ___, produces ___, changes ___
          When does _X_ refuse? _X_ refuses when ___
          Who invokes _X_? _X_ is invoked by ___
        example: |
          _Refund_Credit_ takes nothing, produces coins, changes _Credit_ to zero.
          `nothing`: Open. Coins, an ordinary noun in the produces slot: candidate concept _Coin_. _Credit_: a Relation, _Refund_Credit_ consumes _Credit_, with the effect as a contract bullet: `_Refund_Credit_ must set _Credit_ to zero.`

          _Purchase_Product_ refuses when the _Slot_ is empty or _Credit_ is below the price; then it changes none.
          Terms and their fields: a rule, `_Purchase_Product_ must refuse when the selected _Slot_ is empty.`, in the contract; declare the checked Target in `.relations`. `none`: the account decided; the no-partial-effect rule goes under an ordinary heading, `_Purchase_Product_ must not change _Credit_ or any _Slot_ when it refuses.`

          _Restock_Slot_ is invoked by the operator.
          An actor: Actor rule, on Given, no bullet; it stays in the Definition. Had a procedure invoked it, that would be a Relation between the two procedures.
      - name: remarks
        type: md
        description: Rationale, examples, and the decisions you chose. Never an obligation.
  - name: undecided
    description: A Term whose classification is deliberately deferred.
    sections:
      - name: definition
        type: md
        description: What the Term denotes and what distinguishes it. One or two sentences.
        question: What is _X_, as far as the account says? _X_ is ___
      - name: contract
        type: md
        description: Whatever is already known to hold, one checkable rule per bullet.
      - name: remarks
        type: md
        description: Why the classification is still open, and what would settle it.
        question: What would settle whether _X_ is a concept or a procedure? It would be settled by ___
---

# Specification viewpoint

Name every important thing once, exactly, and say what each one is before saying
what any of them does.

## What becomes a Term

A noun that names a property of an existing Term is a field of that Term, not a
Term: stock and price belong to _Slot_. The one who acts becomes the subject of a
procedure and disappears from the Terms and Relations: the customer is carried by
_Purchase_Product_, and is a Term only when a rule depends on which actor it is. A place
where something happens, or the device that performs the procedure, stays in the
definition of the procedure. Every other noun the account cannot do without is a
concept, and every verb phrase that reads, produces or changes something is a
procedure.

## What earns a Term

Use these criteria to judge substantive independent meaning; the number of references or words is not a quality score. Keep when a supported criterion holds; preserve relevant content on its owner when dropping a candidate.

| Keep when | The row fails when |
| --- | --- |
| Its own answers hold something an implementation could contradict | Its own answers are `nothing`, or say only what no implementation could ever violate, such as a thing being open or closed |
| Other subjects need its independently meaningful identity | References were added only to justify a redundant name |
| Its answers hold what only this account says | Its answers are what anyone already knows |
| A named subject makes an important distinction usable | A short owner field preserves the same meaning without independent identity |
| It is a collection with answers of its own | It is a collection with no answer beyond membership |

## Choosing a kind

A grammatical noun does not decide the kind. Validation may name a policy, a
result or an act; classify the meaning, not the word. Separate a procedure from the
data it consumes or produces: a validation procedure, a validation policy and a
validation result can be distinct subjects. Declare only those with independently needed meaning; do not instantiate every possible role.

Use `undecided` rather than guessing. A deferred classification is visible and
cheap to settle later; a wrong one propagates into every reader's mental model.

## Writing the definition

State the applicable scope, not the usefulness. A definition that expands the name
has said nothing. Detailed constraints belong to the contract.

## Writing the contract

One obligation per bullet, in the form `Subject must behaviour when condition`. Use
the same subject wording every time. A refusal is a rule, not a step. Put ordering
in a rule only where the order carries meaning; most order in a flow is incidental.

A concept owns its fields and states; a procedure owns its effects and refusals. The
rule about what a procedure does to a concept is written in the procedure's
contract, never on the concept. Declare the concept in the procedure's reserved
`.relations` section after definition, for example `changes _Credit_`. Every
non-self Reference in the Term Declaration needs such a declaration. The declaration names
the connection; the contract states its detailed conditions and effects.

## Writing remarks

Rationale, examples, and every decision you made because the source did not decide.
Mark those `Chosen:`. Mark what the model deliberately does not cover `Non-goal:`.
Removing the remarks must leave the definition and contract sufficient.
