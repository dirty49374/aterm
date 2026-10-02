import {
  groupPathPattern,
  localTermPattern,
  referencePattern,
  termTokens,
} from '../../../core/src/syntax-module/identity.js';
import { termKindPattern } from '../../../core/src/syntax-module/term-kind.js';

/** Lexical coloring only; the core parser remains responsible for validation. */
export default function trm(hljs) {
  const term = {
    match: [termTokens('trm'), /(?:\.[a-z][a-z0-9_]*)?/, /†?/],
    scope: { 1: 'symbol', 2: 'attribute', 3: 'operator' },
  };
  const group = {
    match: [/\bin\b/, /[ \t]+/, new RegExp(groupPathPattern)],
    scope: { 1: 'keyword', 3: 'title' },
  };
  const punctuation = { scope: 'punctuation', match: /[={}]/ };
  return {
    name: 'Aterm',
    aliases: ['aterm'],
    contains: [
      hljs.COMMENT(/^\/\//, /$/),
      // Code embedded in a TRM body stays opaque to the surrounding TRM grammar.
      {
        scope: 'code',
        begin: /^[ \t]+(`{3,}|~{3,})[^\n]*/,
        end: /^[ \t]+(`{3,}|~{3,})[ \t]*$/,
        'on:begin': (match, response) => {
          response.data.fence = match[1];
        },
        'on:end': (match, response) => {
          const fence = response.data.fence;
          if (match[1][0] !== fence[0] || match[1].length < fence.length) response.ignoreMatch();
        },
      },
      { scope: 'code', match: /`[^`\n]+`/ },
      {
        begin: /^@(knowledge|viewpoints|description|scope)\b/,
        beginScope: 'meta',
        end: /$/,
        contains: [punctuation, { scope: 'title', match: /[A-Za-z][A-Za-z0-9_-]*/ }],
      },
      {
        begin: new RegExp(`^${termKindPattern}(?=[ \\t]+${localTermPattern})`),
        beginScope: 'keyword',
        end: /$/,
        contains: [term, group, punctuation, hljs.QUOTE_STRING_MODE],
      },
      {
        begin: /^\.relations[ \t]*$/,
        beginScope: 'section',
        end: /^(?=\S)/,
        contains: [
          {
            match: [
              /^[ \t]+/,
              /[A-Za-z][A-Za-z0-9_'-]*(?:[ \t]+[A-Za-z][A-Za-z0-9'-]*){0,4}/,
              new RegExp(`(?=[ \\t]+${referencePattern})`),
            ],
            scope: { 2: 'built_in' },
          },
          term,
        ],
      },
      { scope: 'section', match: /^\.[a-z][a-z0-9_]*[ \t]*$/ },
      { scope: 'punctuation', match: /^}[ \t]*$/ },
      term,
      hljs.QUOTE_STRING_MODE,
    ],
  };
}
