import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';

import type {
  KnowledgeChunkWrite,
  KnowledgeDocumentWrite,
  KnowledgeEntityWrite,
  KnowledgeLinkWrite,
} from '@zero/db';
import { createId, utcNow } from '@zero/shared';

const maxChunkCharacters = 3_000;
const maxLabelCharacters = 500;

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function scalar(value: string): string | number | boolean | null | string[] {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null' || trimmed === '~') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter((item) => item.length > 0);
  }
  return trimmed.replace(/^['"]|['"]$/g, '');
}

function frontmatter(lines: readonly string[]): {
  readonly values: Record<string, string | number | boolean | null | string[]>;
  readonly bodyStart: number;
} {
  if (lines[0]?.trim() !== '---') return { values: {}, bodyStart: 0 };
  const end = lines.slice(1).findIndex((line) => line.trim() === '---');
  if (end < 0) return { values: {}, bodyStart: 0 };
  const values: Record<string, string | number | boolean | null | string[]> = {};
  for (const line of lines.slice(1, end + 1)) {
    const match = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line);
    if (match === null) continue;
    values[match[1]!] = scalar(match[2]!);
  }
  return { values, bodyStart: end + 2 };
}

interface Section {
  readonly heading: string | null;
  readonly startLine: number;
  readonly lines: readonly { readonly value: string; readonly line: number }[];
}

function sections(lines: readonly string[], bodyStart: number): Section[] {
  const result: Section[] = [];
  let heading: string | null = null;
  let startLine = bodyStart + 1;
  let current: Array<{ value: string; line: number }> = [];

  const flush = () => {
    if (current.some((line) => line.value.trim().length > 0)) {
      result.push({ heading, startLine, lines: current });
    }
    current = [];
  };

  for (let index = bodyStart; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match !== null) {
      flush();
      heading = match[2]!
        .replace(/\s+#+\s*$/, '')
        .trim()
        .slice(0, maxLabelCharacters);
      startLine = index + 1;
      current.push({ value: line, line: index + 1 });
    } else {
      if (current.length === 0) startLine = index + 1;
      current.push({ value: line, line: index + 1 });
    }
  }
  flush();
  return result;
}

function chunksFromSections(values: readonly Section[]): KnowledgeChunkWrite[] {
  const result: KnowledgeChunkWrite[] = [];
  for (const section of values) {
    let batch: Array<{ value: string; line: number }> = [];
    let characters = 0;
    const flush = () => {
      const nonempty = batch.filter((line) => line.value.trim().length > 0);
      if (nonempty.length === 0) {
        batch = [];
        characters = 0;
        return;
      }
      const text = batch
        .map((line) => line.value)
        .join('\n')
        .trim();
      result.push({
        id: createId(),
        ordinal: result.length,
        heading: section.heading,
        lineStart: nonempty[0]!.line,
        lineEnd: nonempty.at(-1)!.line,
        text,
        contentHash: sha256(text),
      });
      batch = [];
      characters = 0;
    };

    for (const line of section.lines) {
      if (characters > 0 && characters + line.value.length + 1 > maxChunkCharacters) {
        flush();
      }
      batch.push(line);
      characters += line.value.length + 1;
    }
    flush();
  }
  return result;
}

function linksAndTags(lines: readonly string[]): {
  readonly links: KnowledgeLinkWrite[];
  readonly tags: string[];
  readonly entities: KnowledgeEntityWrite[];
} {
  const links: KnowledgeLinkWrite[] = [];
  const tags = new Set<string>();
  const entities = new Map<string, KnowledgeEntityWrite>();

  for (const [index, line] of lines.entries()) {
    const wikiPattern = /!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
    for (const match of line.matchAll(wikiPattern)) {
      const target = match[1]!.trim();
      if (target.length === 0) continue;
      links.push({
        id: createId(),
        target,
        label: match[2]?.trim() ?? null,
        linkType: 'wikilink',
        lineNumber: index + 1,
      });
      const key = target.toLocaleLowerCase();
      if (!entities.has(key)) {
        entities.set(key, {
          id: createId(),
          canonicalName: target,
          entityType: 'note',
        });
      }
    }

    const markdownPattern = /\[([^\]]+)\]\(([^)]+\.md(?:#[^)]*)?)\)/gi;
    for (const match of line.matchAll(markdownPattern)) {
      const target = match[2]!.trim().split('#')[0]!;
      links.push({
        id: createId(),
        target,
        label: match[1]!.trim(),
        linkType: 'markdown',
        lineNumber: index + 1,
      });
    }

    for (const match of line.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) {
      tags.add(match[1]!);
    }
  }
  return { links, tags: [...tags].sort(), entities: [...entities.values()] };
}

export function parseMarkdownDocument(input: {
  readonly id?: string;
  readonly relativePath: string;
  readonly content: string;
  readonly modifiedAtMs: number;
  readonly sizeBytes: number;
  readonly createdAt?: string;
}): KnowledgeDocumentWrite {
  const normalized = input.content.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const lines = normalized.split('\n');
  const parsedFrontmatter = frontmatter(lines);
  const headingTitle = lines
    .slice(parsedFrontmatter.bodyStart)
    .map((line) => /^#\s+(.+?)\s*$/.exec(line)?.[1]?.trim())
    .find((title) => title !== undefined);
  const fallbackTitle = basename(input.relativePath, extname(input.relativePath));
  const frontmatterTitle = parsedFrontmatter.values.title;
  const title =
    typeof frontmatterTitle === 'string' && frontmatterTitle.trim().length > 0
      ? frontmatterTitle.trim()
      : (headingTitle ?? fallbackTitle);
  const extracted = linksAndTags(lines);
  const tags = new Set(extracted.tags);
  const frontmatterTags =
    parsedFrontmatter.values.tags ?? parsedFrontmatter.values.tag ?? [];
  for (const tag of Array.isArray(frontmatterTags)
    ? frontmatterTags
    : [frontmatterTags]) {
    if (typeof tag !== 'string') continue;
    const normalizedTag = tag.trim().replace(/^#/, '');
    if (normalizedTag.length > 0) tags.add(normalizedTag);
  }
  const now = utcNow();
  return {
    id: input.id ?? createId(),
    relativePath: input.relativePath,
    title: title.slice(0, maxLabelCharacters),
    contentHash: sha256(normalized),
    modifiedAtMs: input.modifiedAtMs,
    sizeBytes: input.sizeBytes,
    frontmatterJson: JSON.stringify(parsedFrontmatter.values),
    tagsJson: JSON.stringify([...tags].sort()),
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    chunks: chunksFromSections(sections(lines, parsedFrontmatter.bodyStart)),
    links: extracted.links,
    entities: extracted.entities,
  };
}
