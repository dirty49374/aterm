import { join } from 'node:path';
import { AtermError } from '../error.js';
import { FileAccess } from './file-access.js';

export const embeddingModel = {
  name: 'Xenova/multilingual-e5-small',
  revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  dimensions: 384,
  recipe: 'e5-mean-normalized-q8-windows-v2',
} as const;
export interface ITextEmbedding {
  ready(): Promise<boolean>;
  embed(
    texts: readonly string[],
    role: 'query' | 'passage',
    download?: boolean,
  ): Promise<number[][]>;
}
type Extractor = import('@huggingface/transformers').FeatureExtractionPipeline;
const instances = new Map<string, Promise<Extractor>>();

/** Preserve every code point when Model token limits require several inference windows. */
export function embeddingWindows(text: string, fits: (value: string) => boolean): string[] {
  if (fits(text)) return [text];
  const characters = Array.from(text);
  if (characters.length < 2)
    throw new AtermError('search.input', 'A source character exceeds the Model input limit.');
  const middle = Math.floor(characters.length / 2);
  return [
    ...embeddingWindows(characters.slice(0, middle).join(''), fits),
    ...embeddingWindows(characters.slice(middle).join(''), fits),
  ];
}

/** Native inference and vendor Model file access remain behind _aterm_development:File_Adapter_. */
export class NativeEmbedding implements ITextEmbedding {
  constructor(private readonly directory: string) {}
  async ready(): Promise<boolean> {
    const files = new FileAccess();
    if (!(await files.exists(this.directory))) return false;
    const root = join(this.directory, embeddingModel.name, embeddingModel.revision);
    return (
      await Promise.all(
        ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'].map(
          (name) =>
            files.guard(this.directory, join(root, name)).then((path) => files.exists(path)),
        ),
      )
    ).every(Boolean);
  }
  async embed(
    texts: readonly string[],
    role: 'query' | 'passage',
    download = false,
  ): Promise<number[][]> {
    if (!texts.length) return [];
    if (!download && !(await this.ready()))
      throw new AtermError(
        'search.model',
        `Model ${embeddingModel.name} is not prepared. Run aterm corpus index build.`,
      );
    let pending = instances.get(this.directory);
    if (!pending) {
      pending = this.load(download);
      instances.set(this.directory, pending);
      pending.catch(() => {
        if (instances.get(this.directory) === pending) instances.delete(this.directory);
      });
    }
    try {
      const extractor = await pending;
      const tokenCount = (text: string) => extractor.tokenizer.encode(`${role}: ${text}`).length;
      const windows = texts.flatMap((text, owner) =>
        embeddingWindows(text, (value) => tokenCount(value) <= 512).map((value) => ({
          owner,
          text: `${role}: ${value}`,
          weight: tokenCount(value),
        })),
      );
      const sums = texts.map(() => Array<number>(embeddingModel.dimensions).fill(0));
      for (let start = 0; start < windows.length; start += 16) {
        const batch = windows.slice(start, start + 16);
        const output = await extractor(
          batch.map((window) => window.text),
          { pooling: 'mean', normalize: true },
        );
        const vectors = output.tolist() as number[][];
        batch.forEach((window, index) =>
          vectors[index]!.forEach((value, dimension) => {
            sums[window.owner]![dimension]! += value * window.weight;
          }),
        );
      }
      return sums.map((vector) => {
        const length = Math.hypot(...vector);
        return vector.map((value) => value / length);
      });
    } catch (error) {
      throw new AtermError(
        'search.model',
        `Cannot use Model ${embeddingModel.name}: ${String(error)}. Run aterm corpus index build to prepare it; if existing Model files are damaged, move ${this.directory} aside before rebuilding.`,
      );
    }
  }
  private async load(download: boolean): Promise<Extractor> {
    const { pipeline } = await import('@huggingface/transformers');
    // A local path prevents the library's Hub metadata preflight, which still
    // issues HEAD requests with local_files_only when supplied a remote model ID.
    const source = (await this.ready())
      ? join(this.directory, embeddingModel.name, embeddingModel.revision)
      : embeddingModel.name;
    return pipeline('feature-extraction', source, {
      dtype: 'q8',
      device: 'cpu',
      revision: embeddingModel.revision,
      cache_dir: this.directory,
      local_files_only: !download,
      session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
    });
  }
}
