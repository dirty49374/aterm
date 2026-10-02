---
name: generic
description: An unrestricted vocabulary with one Term Kind, free-form classification and explanation.
termKinds:
  - name: term
    description: Anything given a name and meaning in the subject, without assigning a structural Term Kind
      by category.
    sections:
      - name: definition
        type: md
        description: What this Term denotes, in a concise statement; the default section.
        question: What is _X_? _X_ is ___
        example: |
          _Skill_ is reusable organized knowledge and guidance for a particular range of work.
          State the meaning here; classification and further explanation have their own sections.
      - name: classification
        type: md
        description: Free-form labels describing how this Term is classified in this account; zero, one or
          several labels, with no fixed vocabulary.
        question: How is _X_ classified here? _X_ is classified as ___
        example: |
          concept
          Other Terms might be classified as procedure, policy or several relevant labels.
          These are examples of authored text, not additional Term Kinds or a closed enumeration.
      - name: description
        type: md
        description: Free-form explanation, context, examples, distinctions, connections and other
          information useful for understanding this Term.
        question: What else explains _X_? _X_ is explained by ___
        example: |
          A Skill can explain a subject or supply principles without an execution sequence.
          Explain its use and boundaries here, including how it differs from nearby concepts.

---

# Generic viewpoint

Use this to give anything in the subject a name and an explanation without first
choosing a domain-specific ontology. Every Term Declaration has the Term Kind `term`.
Classification is authored content, not another declaration Term Kind.

## What becomes a Term

Anything the account needs named can be a candidate: a concept, procedure,
policy, role, event, property, measure or another subject-specific idea.
These examples impose no category boundary or fixed classification vocabulary.
A name becomes useful when it lets the reader identify something whose meaning
would otherwise be implicit, ambiguous or repeatedly explained.

## What earns a Term

Keep when any row holds; drop only when none does.

| Keep when | The row fails when |
| --- | --- |
| The subject gives it a meaning or distinction a reader needs explained | The account adds nothing to an ordinary word |
| It has information useful to explain independently | Separating it only moves a phrase away from its owner |
| Other Terms need to refer to it as the same thing | The text needs only an incidental description |
| Different phrasings in the account identify the same thing | The phrasings denote different things |

A classification label does not by itself earn a Term Declaration. Use a Term reference
for a classification only when the category itself has a definition worth naming.
Otherwise write ordinary labels such as concept, procedure or policy.

## Sections

The text directly after the opening brace is `definition`. It states what the
Term denotes. `.classification` records how the author classifies it;
`.description` holds the rest of the explanation. Both named sections can be
omitted when there is nothing useful to say in them.

Classification accepts ordinary Markdown: a label, a list of labels, or labels
with context. Labels are not an enum, need not be mutually exclusive, and do not
select a Schema, imply inheritance or create extra Term Declarations. A Term Kind filter sees
`term`; it does not interpret classification text as a Term Kind.

Description can include examples, background, behavior, conditions, distinctions,
rationale and source-specific instructions. It has no prescribed outline or
prohibition on a subject merely because it is procedural or normative.
Place any modeling Chosen or Non-goal explanations here when needed.

The reserved `.relations` section comes after definition and before classification.
Declare each non-self Target used anywhere in the Term Declaration with `phrase _Target_`.
For example, `uses _Procedure_` declares the connection; the explanation stays in
`.description`. A Reference to a classification Term also needs a declaration.
Omit `.relations` when there are no declarations. Prose itself does not declare
Relations. The section is supplied automatically, not defined in Viewpoint YAML.
A specialized Viewpoint can be introduced when a task needs a stricter vocabulary;
using generic does not require that later step.
