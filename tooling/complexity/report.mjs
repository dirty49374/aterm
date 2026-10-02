import { glob, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Linter } from 'eslint';
import parser from '@typescript-eslint/parser';
import sonarjs from 'eslint-plugin-sonarjs';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const patterns = [
  'packages/*/src/**/*.{ts,tsx,js,jsx,mjs,cjs}',
  'packages/webapp/public/**/*.{js,mjs}',
  'tooling/**/*.{ts,js,mjs}',
];
const excluded =
  /(?:^|\/)(?:node_modules|dist|test|__tests__)(?:\/|$)|\.(?:test|spec|d)\.[cm]?[jt]sx?$/;
const reviewThresholds = {
  cognitive: { target: 15, priority: 30 },
  cyclomatic: { target: 10, priority: 20 },
};
const config = [
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { sonarjs },
    rules: {
      complexity: ['warn', { max: 0, variant: 'classic' }],
      'sonarjs/cognitive-complexity': ['warn', 0],
    },
  },
];

// Use the upstream rules, including their treatment of nested functions,
// optional chaining and implicit class functions. Do not reimplement the metrics.
export function measure(source, file) {
  const messages = new Linter().verify(source, config, {
    filename: file,
    allowInlineConfig: false,
  });
  const lines = source.split('\n');
  return messages.map((message) => {
    const match =
      message.ruleId === 'complexity'
        ? /^(.*) has a complexity of (\d+)\./.exec(message.message)
        : message.ruleId === 'sonarjs/cognitive-complexity'
          ? /^(?:Refactor this function to reduce its Cognitive Complexity from) (\d+) to /.exec(
              message.message,
            )
          : null;
    if (!match) throw new Error(`${file}:${message.line}:${message.column}: ${message.message}`);
    const cyclomatic = message.ruleId === 'complexity';
    return {
      metric: cyclomatic ? 'cyclomatic' : 'cognitive',
      score: Number(match[cyclomatic ? 2 : 1]),
      file,
      line: message.line,
      column: message.column,
      subject: cyclomatic ? match[1] : lines[message.line - 1].trim(),
    };
  });
}

export async function collect(directory = root) {
  const files = [];
  for await (const file of glob(patterns, {
    cwd: directory,
    exclude: ['**/node_modules/**', '**/dist/**'],
  })) {
    if (!excluded.test(file)) files.push(file);
  }
  files.sort();
  if (!files.length) throw new Error('No implementation files found.');
  const measurements = [];
  for (const file of files)
    measurements.push(...measure(await readFile(path.join(directory, file), 'utf8'), file));
  measurements.sort(
    (a, b) =>
      b.score - a.score ||
      a.file.localeCompare(b.file, 'en') ||
      a.line - b.line ||
      a.column - b.column,
  );
  return {
    files,
    metrics: {
      cyclomatic:
        'ESLint complexity (classic); every explicit function and implicit class function, minimum 1.',
      cognitive:
        'SonarJS cognitive-complexity; functions with score > 0 only. Missing rows are not failures.',
    },
    measurements,
  };
}

export function format(report, top) {
  const output = [
    `${report.files.length} implementation files. Informational report; no complexity gate.`,
  ];
  for (const metric of ['cognitive', 'cyclomatic']) {
    const rows = report.measurements.filter((row) => row.metric === metric);
    const { target, priority } = reviewThresholds[metric];
    output.push(
      '',
      `${metric === 'cognitive' ? 'Cognitive' : 'Cyclomatic'} Complexity: ${rows.length} measured units; ${rows.filter((row) => row.score > target).length} above target ${target}; ${rows.filter((row) => row.score > priority).length} above priority ${priority} (review signals only).`,
      'SCORE  LOCATION  SUBJECT',
    );
    for (const row of rows.slice(0, top)) {
      output.push(
        `${String(row.score).padStart(5)}  ${row.file}:${row.line}:${row.column}  ${row.subject}`,
      );
    }
  }
  output.push(
    '',
    'Scores from different metrics are not comparable. Cognitive subjects show the source line at the reported function token.',
  );
  return output.join('\n') + '\n';
}

async function main() {
  const { values } = parseArgs({
    options: {
      json: { type: 'boolean' },
      top: { type: 'string', default: '30' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'pnpm complexity [--top N] [--json]\nMeasures implementation sources, excluding tests, declarations, dependencies and generated assets.\n--json emits all measurements; --top only limits the text rankings (default 30).',
    );
    return;
  }
  const top = Number(values.top);
  if (!Number.isSafeInteger(top) || top < 1) throw new Error('--top must be a positive integer.');
  const report = await collect();
  process.stdout.write(values.json ? JSON.stringify(report, null, 2) + '\n' : format(report, top));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
