---
name: design
description: The seams of a system, what each part owns and what flows between parts.
termKinds:
  - name: module
    description: An internal unit holding one responsibility, reaching no resource outside the process.
    sections:
      - name: definition
        type: md
        description: The one responsibility this part holds.
      - name: contract
        type: md
        description: Its obligations, what it must not do, how it reports failure, and what it leaves unconstrained.
      - name: remarks
        type: md
        description: Why the seam is where it is.
  - name: adapter
    description: The sole component permitted to touch one outside resource. It interprets no content.
    sections:
      - name: definition
        type: md
        description: The one outside resource this part alone may touch.
      - name: contract
        type: md
        description: Its obligations, what it must not do, how it reports failure, and what it leaves unconstrained.
      - name: invariants
        type: md
        description: Properties of the outside resource that hold at every moment, whoever is looking.
      - name: remarks
        type: md
        description: Why the seam is where it is.
  - name: value
    description: Something passed between components. It has no behaviour, only invariants.
    sections:
      - name: definition
        type: md
        description: What this value carries, and where it crosses.
      - name: invariants
        type: md
        description: Everything that is always true of it, in a form a test would fail if broken.
      - name: remarks
        type: md
        description: Why the seam is where it is.
---

# Design viewpoint

Describe the seams, never the interiors. A design Term Declaration must stay true when
the inside of its part is rewritten from scratch. If a rewrite would falsify what
you wrote, you described the code instead of the seam, and it will rot.

## The half that does the work

State what each part must **not** do. A responsibility alone does not prevent a
hand being attached to a foot; the exclusion does. Name the component that alone
may touch each outside resource, and the rule becomes checkable against imports.

## Declaring the flow

Give every component `produces` and `reads` Relations for the values it handles.
Write each as `phrase _Target_` in the reserved `.relations` section after
definition. Declare all non-self Targets referenced by the Term Declaration there; keep
the detailed obligations in contract or invariants.
Then every value that is read must be produced by something, or be named as an
input from outside, and every value produced must be read or be named as an output.
That check finds a broken decomposition without anyone reading the code.

## Values

A value is defined by its invariants more than by its fields. Write what is always
true of it, in a form that a test would fail if broken.

## What to leave out

Say plainly what you deliberately leave unconstrained, so the next reader does not
infer a rule from the first implementation they read.
