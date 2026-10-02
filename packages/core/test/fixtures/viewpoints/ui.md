---
name: ui
description: What a user sees and can do, element by element, each tied to the Terms it shows or invokes.
termKinds:
  - name: panel
    description: A region of the screen that groups elements and holds a state of its own, such as a page, a pane or a dialog. It is a Term when something is shown or done in it, not for its frame.
    sections:
      - name: definition
        type: md
        description: What the region is for and where the user finds it. One or two sentences.
        question: What is _X_, and where does the user find it? _X_ is ___, found ___
        example: |
          _Coin_Slot_ is the opening on the front of the machine where a _Coin_ is inserted, found above the _Credit_Display_.
          Head noun "opening": the kind. _Coin_: a Term of the specification. _Credit_Display_: a candidate label, since the account says the credit is shown.
      - name: contract
        type: md
        description: What it contains, what it shows and from which Term, and the rules that hold, one per bullet.
        question: What does _X_ contain, and what does it show, from which Term? _X_ contains ___; it shows ___ of _Term_
        example: |
          _Front_Panel_ contains the _Coin_Slot_, one _Slot_Button_ per _Slot_, the _Refund_Credit_Button_ and the _Credit_Display_; it shows the _Credit_ and, per _Slot_, its price and whether it is empty.
          Every contained element is a candidate; the shown things are Relations, _Front_Panel_ shows _Credit_ and _Front_Panel_ shows _Slot_.
      - name: states
        type: md
        description: The states the region can be in, what the user sees in each, and which changes are forbidden.
        question: What states can _X_ be in, and what does the user see in each? _X_ is one of ___; in ___ the user sees ___
        example: |
          _Front_Panel_ is one of idle, credited, refusing; in refusing the user sees why _Purchase_Product_ refused, until the next _Coin_ or _Slot_Button_.
          Three states with what each shows; "why _Purchase_Product_ refused" binds the state to the procedure's refusal rules.
      - name: rules
        type: md
        description: What the user must never be able to do through it.
        question: What must the user never be able to do through _X_? Through _X_ the user must never ___
        example: |
          Through _Slot_Button_ the user must never start a second _Purchase_Product_ while one is delivering.
          A negative rule, the kind a test for a double click checks.
      - name: remarks
        type: md
        description: Layout, wording and styling choices. Never an obligation.
  - name: card
    description: A bounded element that presents one instance of a Term, such as one todo or one product. It is a Term when its content is more than the Term's name.
    sections:
      - name: definition
        type: md
        description: Which Term's instance it presents, and where it appears.
        question: What is _X_, and where does the user find it? _X_ is ___, found ___
        example: |
          _Coin_Slot_ is the opening on the front of the machine where a _Coin_ is inserted, found above the _Credit_Display_.
          Head noun "opening": the kind. _Coin_: a Term of the specification. _Credit_Display_: a candidate label, since the account says the credit is shown.
      - name: contract
        type: md
        description: What it contains and shows of that instance, and the rules that hold.
        question: What does _X_ contain, and what does it show, from which Term? _X_ contains ___; it shows ___ of _Term_
        example: |
          _Front_Panel_ contains the _Coin_Slot_, one _Slot_Button_ per _Slot_, the _Refund_Credit_Button_ and the _Credit_Display_; it shows the _Credit_ and, per _Slot_, its price and whether it is empty.
          Every contained element is a candidate; the shown things are Relations, _Front_Panel_ shows _Credit_ and _Front_Panel_ shows _Slot_.
      - name: states
        type: md
        description: The states it can be in and what each shows.
        question: What states can _X_ be in, and what does the user see in each? _X_ is one of ___; in ___ the user sees ___
        example: |
          _Front_Panel_ is one of idle, credited, refusing; in refusing the user sees why _Purchase_Product_ refused, until the next _Coin_ or _Slot_Button_.
          Three states with what each shows; "why _Purchase_Product_ refused" binds the state to the procedure's refusal rules.
      - name: rules
        type: md
        description: What the user must never be able to do through it.
        question: What must the user never be able to do through _X_? Through _X_ the user must never ___
        example: |
          Through _Slot_Button_ the user must never start a second _Purchase_Product_ while one is delivering.
          A negative rule, the kind a test for a double click checks.
      - name: remarks
        type: md
        description: Layout, wording and styling choices. Never an obligation.
  - name: list
    description: A repeating element that shows one row per instance of a Term, in an order the account decides.
    sections:
      - name: definition
        type: md
        description: Which Term it shows rows of, and where it appears.
        question: What is _X_, and where does the user find it? _X_ is ___, found ___
        example: |
          _Coin_Slot_ is the opening on the front of the machine where a _Coin_ is inserted, found above the _Credit_Display_.
          Head noun "opening": the kind. _Coin_: a Term of the specification. _Credit_Display_: a candidate label, since the account says the credit is shown.
      - name: contract
        type: md
        description: What each row shows, the order, and the rules that hold.
        question: |
          What does _X_ contain, and what does it show, from which Term? _X_ contains ___; it shows ___ of _Term_
          What does _X_ show one row per, and in what order? _X_ shows one row per _Term_, ordered by ___
        example: |
          _Front_Panel_ contains the _Coin_Slot_, one _Slot_Button_ per _Slot_, the _Refund_Credit_Button_ and the _Credit_Display_; it shows the _Credit_ and, per _Slot_, its price and whether it is empty.
          Every contained element is a candidate; the shown things are Relations, _Front_Panel_ shows _Credit_ and _Front_Panel_ shows _Slot_.

          _Slot_Row_List_ shows one row per _Slot_, ordered as the slots stand in the machine.
          A Relation, _Slot_Row_List_ shows _Slot_; the order is a contract rule.
      - name: states
        type: md
        description: Empty, loading and other states, and what each shows.
        question: What states can _X_ be in, and what does the user see in each? _X_ is one of ___; in ___ the user sees ___
        example: |
          _Front_Panel_ is one of idle, credited, refusing; in refusing the user sees why _Purchase_Product_ refused, until the next _Coin_ or _Slot_Button_.
          Three states with what each shows; "why _Purchase_Product_ refused" binds the state to the procedure's refusal rules.
      - name: rules
        type: md
        description: What the user must never be able to do through it.
        question: What must the user never be able to do through _X_? Through _X_ the user must never ___
        example: |
          Through _Slot_Button_ the user must never start a second _Purchase_Product_ while one is delivering.
          A negative rule, the kind a test for a double click checks.
      - name: remarks
        type: md
        description: Layout, wording and styling choices. Never an obligation.
  - name: button
    description: A control the user presses to invoke one procedure Term with what the screen holds.
    sections:
      - name: definition
        type: md
        description: What pressing it does, in the Term's words, and where it is.
        question: What is _X_, and where does the user find it? _X_ is ___, found ___
        example: |
          _Coin_Slot_ is the opening on the front of the machine where a _Coin_ is inserted, found above the _Credit_Display_.
          Head noun "opening": the kind. _Coin_: a Term of the specification. _Credit_Display_: a candidate label, since the account says the credit is shown.
      - name: contract
        type: md
        description: Which procedure it invokes and with what, when it is enabled, and what the user sees on refusal.
        question: |
          What does _X_ invoke or lead to, and with what? _X_ invokes _Procedure_ with ___
          When is _X_ enabled, and what does the user see when it is not? _X_ is enabled when ___; otherwise the user sees ___
        example: |
          _Slot_Button_ invokes _Purchase_Product_ with the _Slot_ it stands for.
          A Relation, _Slot_Button_ invokes _Purchase_Product_; the argument is a contract rule. A link answers "leads to _View_" instead.

          _Refund_Credit_Button_ is enabled when _Credit_ is above zero; otherwise the user sees it greyed.
          A rule that reads a Term's state; "greyed" is the visible consequence, which a test can check.
      - name: rules
        type: md
        description: What the user must never be able to do through it.
        question: What must the user never be able to do through _X_? Through _X_ the user must never ___
        example: |
          Through _Slot_Button_ the user must never start a second _Purchase_Product_ while one is delivering.
          A negative rule, the kind a test for a double click checks.
      - name: remarks
        type: md
        description: Wording, icon and placement. Never an obligation.
  - name: input
    description: A control the user fills, whose content is handed to a button or a procedure. It refuses on its own only what the account says it refuses.
    sections:
      - name: definition
        type: md
        description: What it takes and where it goes.
        question: What is _X_, and where does the user find it? _X_ is ___, found ___
        example: |
          _Coin_Slot_ is the opening on the front of the machine where a _Coin_ is inserted, found above the _Credit_Display_.
          Head noun "opening": the kind. _Coin_: a Term of the specification. _Credit_Display_: a candidate label, since the account says the credit is shown.
      - name: contract
        type: md
        description: What it accepts, what it refuses on its own, and which control or procedure receives its content.
        question: |
          What does _X_ invoke or lead to, and with what? _X_ invokes _Procedure_ with ___
          When is _X_ enabled, and what does the user see when it is not? _X_ is enabled when ___; otherwise the user sees ___
          What does _X_ take, and what does it refuse before anything is invoked? _X_ takes ___; it refuses ___
        example: |
          _Slot_Button_ invokes _Purchase_Product_ with the _Slot_ it stands for.
          A Relation, _Slot_Button_ invokes _Purchase_Product_; the argument is a contract rule. A link answers "leads to _View_" instead.

          _Refund_Credit_Button_ is enabled when _Credit_ is above zero; otherwise the user sees it greyed.
          A rule that reads a Term's state; "greyed" is the visible consequence, which a test can check.

          _Title_Input_ takes one line of text; it refuses nothing itself, and hands what it holds to _Add_Button_.
          An input that validates nothing leaves refusal to the procedure; say so, so that no reader assumes the input guards.
      - name: rules
        type: md
        description: What the user must never be able to do through it.
        question: What must the user never be able to do through _X_? Through _X_ the user must never ___
        example: |
          Through _Slot_Button_ the user must never start a second _Purchase_Product_ while one is delivering.
          A negative rule, the kind a test for a double click checks.
      - name: remarks
        type: md
        description: Placeholder, wording and placement. Never an obligation.
  - name: link
    description: A control that leads the user to another panel without invoking a procedure.
    sections:
      - name: definition
        type: md
        description: Where it leads and where it is.
        question: What is _X_, and where does the user find it? _X_ is ___, found ___
        example: |
          _Coin_Slot_ is the opening on the front of the machine where a _Coin_ is inserted, found above the _Credit_Display_.
          Head noun "opening": the kind. _Coin_: a Term of the specification. _Credit_Display_: a candidate label, since the account says the credit is shown.
      - name: contract
        type: md
        description: Which panel it leads to, and when it is enabled.
        question: |
          What does _X_ invoke or lead to, and with what? _X_ invokes _Procedure_ with ___
          When is _X_ enabled, and what does the user see when it is not? _X_ is enabled when ___; otherwise the user sees ___
        example: |
          _Slot_Button_ invokes _Purchase_Product_ with the _Slot_ it stands for.
          A Relation, _Slot_Button_ invokes _Purchase_Product_; the argument is a contract rule. A link answers "leads to _View_" instead.

          _Refund_Credit_Button_ is enabled when _Credit_ is above zero; otherwise the user sees it greyed.
          A rule that reads a Term's state; "greyed" is the visible consequence, which a test can check.
      - name: rules
        type: md
        description: What the user must never be able to do through it.
        question: What must the user never be able to do through _X_? Through _X_ the user must never ___
        example: |
          Through _Slot_Button_ the user must never start a second _Purchase_Product_ while one is delivering.
          A negative rule, the kind a test for a double click checks.
      - name: remarks
        type: md
        description: Wording and placement. Never an obligation.
  - name: label
    description: A read-only element that shows one value of a Term in a stated form.
    sections:
      - name: definition
        type: md
        description: What it shows and where.
        question: What is _X_, and where does the user find it? _X_ is ___, found ___
        example: |
          _Coin_Slot_ is the opening on the front of the machine where a _Coin_ is inserted, found above the _Credit_Display_.
          Head noun "opening": the kind. _Coin_: a Term of the specification. _Credit_Display_: a candidate label, since the account says the credit is shown.
      - name: contract
        type: md
        description: Which Term's value, in what form, and when it updates.
        question: What does _X_ show, from which Term, and in what form? _X_ shows ___ of _Term_, as ___
        example: |
          _Credit_Display_ shows the amount of _Credit_, as a sum in the machine's currency, updated on every change.
          A Relation, _Credit_Display_ shows _Credit_; the form and the update are contract rules.
      - name: rules
        type: md
        description: What the user must never be able to do through it.
        question: What must the user never be able to do through _X_? Through _X_ the user must never ___
        example: |
          Through _Slot_Button_ the user must never start a second _Purchase_Product_ while one is delivering.
          A negative rule, the kind a test for a double click checks.
      - name: remarks
        type: md
        description: Wording and placement. Never an obligation.
  - name: undecided
    description: An element whose kind is deliberately deferred.
    sections:
      - name: definition
        type: md
        description: What it is, as far as the account says.
        question: What is _X_, and where does the user find it? _X_ is ___, found ___
        example: |
          _Coin_Slot_ is the opening on the front of the machine where a _Coin_ is inserted, found above the _Credit_Display_.
          Head noun "opening": the kind. _Coin_: a Term of the specification. _Credit_Display_: a candidate label, since the account says the credit is shown.
      - name: contract
        type: md
        description: Whatever is already known to hold.
      - name: rules
        type: md
        description: What the user must never be able to do through it.
        question: What must the user never be able to do through _X_? Through _X_ the user must never ___
        example: |
          Through _Slot_Button_ the user must never start a second _Purchase_Product_ while one is delivering.
          A negative rule, the kind a test for a double click checks.
      - name: remarks
        type: md
        description: Why the kind is still open, and what would settle it.
---

# UI viewpoint

Describe what the user sees and can do, element by element, and tie every element
to the Terms it shows or invokes. A UI Term Declaration must stay true when the
stylesheet, the framework and the layout are replaced: it says what is shown, from
which Term, what is invoked, and what the user is never allowed to do. Everything
else is remarks.

## What becomes a Term

An element becomes a Term when it shows a Term's state, invokes a procedure Term,
leads to another panel, or holds a state of its own that the user can see. A
container that only groups elements, with no state and nothing of its own to show,
stays in the definition of its parent as layout. Spacing, colour, typography, icons
and wording are remarks, never Terms. The kind of element is its kind: a
region is a panel, one instance is a card, a repetition is a list, a press is a
button, a fill is an input, a jump is a link, a read-only value is a label.

Every Relation from a UI Term points at a Term of the specification or domain the
screen serves: `_Add_Button_ invokes _Todo_Add_`, `_Todo_Rows_ shows _Todo_List_`. A
UI Term that points at no such Term shows or does nothing the model knows about, and
that is the first thing to question.

## What earns a Term

Keep when any row holds; drop only when none does.

| Keep when | The row fails when |
| --- | --- |
| It shows a Term's state, invokes a procedure, or leads to a panel | It shows and does nothing the model names |
| It has a rule of its own: when enabled, what is refused, what is never allowed, what a state shows | Its only rules are its parent's |
| Two or more other elements' answers needed it before it had a name | Only one did |
| A test could fail on it | Nothing a test could check |

## Writing the definition

Say what the element is for in the Term's words, and where the user finds it. "The
button that invokes _Todo_Add_ with the _Title_Input_, at the end of the input row"
tells a reader and a test where to look.

## Writing the contract

One rule per bullet: `_X_ must invoke _Procedure_ with ___ when ___`, `_X_ must show
___ of _Term_ as ___`, `_X_ must be enabled only when ___`, `_X_ must show ___ when
_Procedure_ refuses`. A refusal the procedure makes is shown by the UI; say what
the user sees, because that is what a test can check.

## States

A panel, a card or a list has states the user can see: empty, loading, showing,
refusing. Name them, say what each shows, and say which changes are forbidden. The
empty state is the one every list forgets.

## Rules

What the user must never be able to do through this element: start a procedure
twice, submit a blank, lose an unsaved draft. These are the tests for the UI that
no procedure Term asks for, because the procedure's rules assume it was invoked
correctly.

## Remarks

Layout, wording, icons, styling, and every choice you made because the account did
not. Mark those `Chosen:`. Removing the remarks must leave an implementer able to
build the screen and a tester able to test it.

## Declaring connections

Use the reserved `.relations` section after definition for `phrase _Target_`
declarations, such as `shows _Credit_` or `invokes _Purchase_Product_`. Declare every
non-self Target used in the Term Declaration. Keep display and interaction conditions in
`contract`; declarations do not contain prose or prescribe action order.
