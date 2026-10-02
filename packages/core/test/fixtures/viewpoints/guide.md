---
name: guide
description: Reusable instructions, who they are for and how to verify them.
termKinds:
  - name: guide
    description: One body of instructions a reader follows to produce something.
    sections:
      - name: definition
        type: md
        description: What the Guide is for, in one sentence.
      - name: target
        type: md
        description: The reader it is written for, and what they already have.
      - name: intention
        type: md
        description: What the reader should be able to do after reading it.
      - name: outline
        type: md
        description: The body's parts, in the order the body presents them.
      - name: body
        type: md
        description: The instructions themselves.
      - name: check
        type: md
        description: How to verify the Guide still holds against the thing it describes.
---

# Guide viewpoint

A Guide is read once and followed many times. Write the body so that a reader who
has only the body can act, and put everything they must not need elsewhere.

## Declaring dependencies

The reserved `.relations` section is available after definition, as in every
Viewpoint. Declare each non-self Term used in Guide prose there, for example
`uses _Review_`. Required context may carry a dagger on its Target.
Teaching examples belong in fenced code or escaped text, so illustrative Term
spellings do not become real References or Relation declarations.
The section is supplied by Aterm; do not declare it in the Viewpoint Schema.

## Keeping a Guide honest

The check section is what stops a Guide drifting from its subject. Write checks
someone can actually run: a command whose output the body quotes, an outline item
that must appear, a property a fresh reader's output must have.
