export interface RankedVectorMatch {
  repositoryId: number;
  score: number;
  snippet: string;
  kind: string;
}

type NumericVector = ArrayLike<number>;

const UNSAFE_FTS_PUNCTUATION = /[^\p{L}\p{N}\s-]/gu;

function normalizeFtsSegment(value: string): string {
  return value
    .replace(UNSAFE_FTS_PUNCTUATION, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toFtsLiteral(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function cosineSimilarity(left: NumericVector, right: NumericVector): number {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function reciprocalRankScore(rank: number): number {
  return 1 / (rank + 1);
}

export function sanitizeFtsQuery(query: string): string {
  const groups: string[][] = [[]];
  let cursor = 0;

  while (cursor < query.length) {
    while (cursor < query.length && /\s/.test(query[cursor] ?? '')) {
      cursor += 1;
    }

    if (cursor >= query.length) {
      break;
    }

    const current = query[cursor];

    if (current === '"') {
      cursor += 1;
      let phrase = '';
      while (cursor < query.length && query[cursor] !== '"') {
        phrase += query[cursor];
        cursor += 1;
      }
      if (query[cursor] === '"') {
        cursor += 1;
      }

      const normalizedPhrase = normalizeFtsSegment(phrase);
      if (normalizedPhrase.length > 1) {
        groups.at(-1)?.push(normalizedPhrase);
      }
      continue;
    }

    let token = '';
    while (cursor < query.length && !/\s/.test(query[cursor] ?? '') && query[cursor] !== '"') {
      token += query[cursor];
      cursor += 1;
    }

    const normalizedToken = normalizeFtsSegment(token);
    if (/^or$/i.test(normalizedToken)) {
      if (groups.at(-1)?.length) {
        groups.push([]);
      }
      continue;
    }

    for (const segment of normalizedToken.split(/\s+/)) {
      if (segment.length > 1) {
        groups.at(-1)?.push(segment);
      }
    }
  }

  const populatedGroups = groups.filter((group) => group.length > 0);
  if (populatedGroups.length === 0) {
    return '';
  }

  return populatedGroups
    .map((group) => group.map(toFtsLiteral).join(' AND '))
    .map((group) => (populatedGroups.length > 1 && group.includes(' AND ') ? `(${group})` : group))
    .join(' OR ');
}
