import { expect, test } from 'vitest';
// @ts-expect-error Native browser module.
import { createMarkdownRenderer } from '../src/markdown.js';
const { markdown, codeBlock } = createMarkdownRenderer(
  (id: string, label: string) => `<a class="term-link" data-term="${id}">${label}</a>`,
);

// Recover the visible code rather than assuming highlighting emits one text node.
const codeText = (html: string) =>
  html
    .match(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/)![1]!
    .replace(/<[^>]+>/g, '')
    .replace(
      /&(amp|lt|gt|quot|#x27|#39);/g,
      (_, entity: string) =>
        ({ amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'" })[entity]!,
    );

test('Term links retain grammar, Knowledge and Markdown context without changing code or nesting anchors', () => {
  const result = markdown(
    '**_Order_** _other:Item_ \\_Literal_ `\u005fCode_` [_Label_](https://example.com) normal_word_word\n\n```ts\nconst name = "_Opaque_";\n```',
    'shop',
  );
  expect(result).toContain(
    '<strong><a class="term-link" data-term="_shop:Order_">_Order_</a></strong>',
  );
  expect(result).toContain('data-term="_other:Item_"');
  expect(result).not.toMatch(/data-term="[^\"]*(Literal|Code|Label|Opaque)/);
  expect(result).toContain('normal_word_word');
  expect(result).toContain('rel="noopener noreferrer"');
  expect(markdown('uses _Order_\ncontains _other:Item_', 'shop', 'relations')).toMatch(
    /<li>uses .*<\/li><li>contains .*<\/li>/,
  );
});

test('Notes without an implicit Knowledge link qualified Terms and keep local spellings literal', () => {
  const result = markdown('_aterm:UI_Command_ — a command. _Local_ remains local.');
  expect(result).toContain('data-term="_aterm:UI_Command_"');
  expect(result).toContain('_Local_');
  expect(result).not.toContain('data-term="_undefined:');
});

test('Markdown preserves heading levels, nested lists, task lists, quotes, tables and formatting', () => {
  const result = markdown(
    '# Heading\n\n### Detail\n\n3. Parent\n   - Child\n     - Nested\n\n- [x] Done\n- [ ] Next\n\n> Quote\n\n| A | B |\n| :- | -: |\n| x | y |\n\n*emphasis* ~~removed~~\n\n---',
    'one',
  );
  for (const fragment of [
    '<h1>Heading</h1>',
    '<h3>Detail</h3>',
    '<ol start="3">',
    'Nested',
    'type="checkbox"',
    'disabled',
    'checked',
    '<blockquote>',
    '<div class="table-wrap"><table>',
    'text-align:right',
    '<em>emphasis</em>',
    '<s>removed</s>',
    '<hr>',
  ])
    expect(result).toContain(fragment);
});

test('declared languages and aliases highlight while unknown, unclosed and indented code stay literal', () => {
  for (const language of [
    'ts',
    'typescript',
    'js',
    'json',
    'yaml',
    'bash',
    'sql',
    'python',
    'diff',
  ])
    expect(codeBlock('const value = "hello";\n', language)).toContain('class="hljs"');
  expect(codeBlock('const value: number = 1;\n', 'ts')).toContain('hljs-keyword');
  expect(
    codeBlock('@knowledge example\nconcept _Example_ = {\n.contract\n  Text.\n}\n', 'trm'),
  ).toContain('hljs-symbol');
  const source = '<script>_Unlinked_</script>\n';
  expect(codeBlock(source, 'unknown')).toContain('&lt;script&gt;_Unlinked_&lt;/script&gt;\n');
  expect(markdown('~~~unknown\n' + source, 'one')).toContain('&lt;script&gt;');
  expect(markdown('    _Indented_\n', 'one')).not.toContain('data-term');
});

test('authored HTML and unsafe links stay inactive; image and link policy is explicit', () => {
  const result = markdown(
    '<img src=x onerror=alert(1)>\n\n[attack](javascript:alert(1))\n[encoded](jav&#x61;script:alert(1))\n[local](file:///tmp/private)\n![remote](https://example.com/image.png)',
    'one',
  );
  expect(result).toContain('&lt;img');
  expect(result).not.toMatch(/href="(?:javascript|file):/);
  expect(result).not.toContain('<img src="x"');
  expect(result).toContain('referrerpolicy="no-referrer"');
  expect(markdown('[data](data:image/png;base64,aGVsbG8=)', 'one')).not.toContain('href="data:');
  expect(markdown('![svg](data:image/svg+xml;base64,aGVsbG8=)', 'one')).not.toContain('<img');
});

test('Mermaid remains an isolated lazy placeholder with exact source, without Term links', () => {
  const source = 'flowchart LR\n  A["_Order_"] --> B[Done]\n';
  const result = markdown('```mermaid\n' + source + '```', 'one');
  expect(result).toContain('data-mermaid');
  expect(result).toContain('<summary>Mermaid source</summary>');
  expect(codeText(result)).toBe(source);
  expect(result).toContain('<span class="hljs-keyword">flowchart</span>');
  expect(result).toContain('<span class="hljs-operator">--&gt;</span>');
  expect(result).not.toContain('data-term');
  expect(result).not.toContain('<svg');
});

test('TRM and its Aterm alias highlight shared notation while keeping source, code and comments literal', () => {
  const source = [
    '// _Comment_ is not a Term token here.',
    '@knowledge demo',
    '@viewpoints specification skill',
    '@description {',
    '  Sample.',
    '}',
    '@scope {',
    '  Examples only.',
    '}',
    'skill.procedure _Build_ in test.procedures = {',
    '  Uses _other:Policy_.contract†.',
    '.relations',
    '  depends_on _other:Policy_',
    '  is guided by _Guide_',
    '.procedure',
    '  _Guide_.procedure†',
    '  `_Inline_Code_` and \\_Escaped_ and x_Not_A_Term_ stay literal.',
    '  ````text',
    '  _Fenced_Code_',
    '  ```',
    '  _Still_Fenced_',
    '  ````',
    '  _Guide_',
    '}',
    '',
  ].join('\n');
  for (const language of ['trm', 'aterm']) {
    const result = codeBlock(source, language);
    expect(codeText(result)).toBe(source);
    for (const [scope, value] of [
      ['meta', '@knowledge'],
      ['meta', '@description'],
      ['meta', '@scope'],
      ['keyword', 'skill.procedure'],
      ['keyword', 'in'],
      ['title', 'test.procedures'],
      ['symbol', '_other:Policy_'],
      ['attribute', '.contract'],
      ['operator', '†'],
      ['section', '.relations'],
      ['section', '.procedure'],
      ['built_in', 'depends_on'],
      ['built_in', 'is guided by'],
      ['punctuation', '}'],
    ])
      expect(result).toContain(`<span class="hljs-${scope}">${value}</span>`);
    expect(result).not.toMatch(
      /class="hljs-symbol">_(Comment|Inline_Code|Escaped|Fenced_Code|Still_Fenced)_/,
    );
    expect(result).not.toContain('class="hljs-symbol">_Not_A_Term_');
    expect(result).not.toContain('data-term');
    expect(markdown('`````' + language + '\n' + source + '`````', 'demo')).not.toContain(
      'data-term',
    );
  }
});

test.each([
  [
    'sequenceDiagram',
    'participant Reader\nReader->>Server: Query\nServer-->>Reader: Result',
    '-&gt;&gt;',
  ],
  ['erDiagram', 'ORDER ||--|{ LINE : contains', '||--|{'],
  ['flowchart LR', 'A[Start] -->|Yes| B[Done]', '--&gt;'],
])(
  'Mermaid %s highlights keywords, operators and comments without altering its source',
  (header, body, arrow) => {
    const source = `${header}\n%% A comment with _Term_ and <script>\n${body}\n`;
    const result = codeBlock(source, 'mermaid');
    expect(codeText(result)).toBe(source);
    expect(result).toContain('<span class="hljs-keyword">');
    expect(result).toContain('<span class="hljs-comment">');
    expect(result).toContain(`<span class="hljs-operator">${arrow}</span>`);
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('data-term');
  },
);

test('Mermaid configuration and invalid syntax remain highlightable without rendering diagrams', () => {
  const sources = [
    '---\ntitle: Demo\n---\nflowchart LR\nA --> B\n',
    '%%{init: {"theme": "dark"}}%%\nflowchart LR\nA --> B\n',
    'flowchart LR\n  A[Missing closing bracket --> B\n',
  ];
  for (const source of sources) {
    const result = codeBlock(source, 'mermaid');
    expect(codeText(result)).toBe(source);
    expect(result).toContain('hljs-keyword');
    expect(result).not.toContain('data-mermaid');
    expect(result).not.toContain('<svg');
  }
});
