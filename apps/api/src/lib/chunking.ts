export interface SourceDocument {
  kind: string;
  path: string | null;
  title: string;
  content: string;
}

export interface IndexedChunk {
  kind: string;
  path: string | null;
  chunkIndex: number;
  content: string;
}

const MAX_CHUNK_LENGTH = 1000;
const CHUNK_OVERLAP = 140;

function splitIntoSections(content: string): string[] {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const sections = normalized
    .split(/\n(?=#{1,6}\s)/g)
    .flatMap((section) => section.split(/\n{2,}/g))
    .map((section) => section.trim())
    .filter(Boolean);

  return sections.length > 0 ? sections : [normalized];
}

function createSlidingChunks(section: string): string[] {
  if (section.length <= MAX_CHUNK_LENGTH) {
    return [section];
  }

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < section.length) {
    const nextCursor = Math.min(section.length, cursor + MAX_CHUNK_LENGTH);
    chunks.push(section.slice(cursor, nextCursor).trim());
    if (nextCursor === section.length) {
      break;
    }
    cursor = Math.max(0, nextCursor - CHUNK_OVERLAP);
  }
  return chunks.filter(Boolean);
}

export function chunkDocument(document: SourceDocument): IndexedChunk[] {
  const sections = splitIntoSections(document.content);
  const chunks = sections.flatMap(createSlidingChunks);

  return chunks.map((content, index) => ({
    kind: document.kind,
    path: document.path,
    chunkIndex: index,
    content,
  }));
}
