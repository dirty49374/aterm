/** Bounded k-shortest simple Term paths: Yen deviations with unweighted BFS spurs. */
export class ConceptPaths {
  constructor(private readonly adjacency: ReadonlyMap<string, readonly string[]>) {}

  find(source: string, target: string, limit: number): string[][] {
    const first = this.shortest(source, target, new Set(), new Set());
    if (!first) return [];
    const paths = [first];
    const seen = new Set([JSON.stringify(first)]);
    const candidates: string[][] = [];
    while (paths.length < limit) {
      const previous = paths.at(-1)!;
      for (let i = 0; i < previous.length - 1; i++) {
        const root = previous.slice(0, i + 1);
        const blockedEdges = new Set<string>();
        for (const path of paths)
          if (root.every((name, j) => path[j] === name) && path[i + 1])
            blockedEdges.add(JSON.stringify([path[i], path[i + 1]]));
        const spur = this.shortest(root.at(-1)!, target, new Set(root.slice(0, -1)), blockedEdges);
        if (!spur) continue;
        const candidate = [...root.slice(0, -1), ...spur];
        const key = JSON.stringify(candidate);
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(candidate);
      }
      // Stable sort retains discovery order for equal-length alternatives.
      candidates.sort((a, b) => a.length - b.length);
      const next = candidates.shift();
      if (!next) break;
      paths.push(next);
    }
    return paths;
  }

  private shortest(
    source: string,
    target: string,
    blockedTerms: ReadonlySet<string>,
    blockedEdges: ReadonlySet<string>,
  ): string[] | undefined {
    const queue = [source];
    const visited = new Set(queue);
    const predecessor = new Map<string, string>();
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const name = queue[cursor]!;
      if (name === target) {
        const path = [target];
        while (path.at(-1) !== source) path.push(predecessor.get(path.at(-1)!)!);
        return path.reverse();
      }
      for (const neighbor of this.adjacency.get(name) ?? []) {
        if (
          visited.has(neighbor) ||
          blockedTerms.has(neighbor) ||
          blockedEdges.has(JSON.stringify([name, neighbor]))
        )
          continue;
        visited.add(neighbor);
        predecessor.set(neighbor, name);
        queue.push(neighbor);
      }
    }
    return undefined;
  }
}
