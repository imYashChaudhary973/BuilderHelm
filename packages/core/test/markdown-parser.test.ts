import { describe, expect, it } from 'vitest';

import { parseMarkdownDocument } from '../src/index.js';

describe('Obsidian Markdown parser', () => {
  it('extracts frontmatter, headings, chunks, tags, and links with line provenance', () => {
    const document = parseMarkdownDocument({
      relativePath: 'Projects/BuilderHelm.md',
      content: [
        '---',
        'title: BuilderHelm Architecture',
        'status: active',
        'tags: [project, architecture]',
        '---',
        '# BuilderHelm',
        '',
        'We selected architecture B for offline operation. #decision',
        '',
        '## Evidence',
        'See [[Research Notes|benchmarks]] and [design](Design.md#Storage).',
      ].join('\n'),
      modifiedAtMs: 1_000,
      sizeBytes: 200,
    });

    expect(document.title).toBe('BuilderHelm Architecture');
    expect(JSON.parse(document.frontmatterJson)).toMatchObject({
      status: 'active',
      tags: ['project', 'architecture'],
    });
    expect(JSON.parse(document.tagsJson)).toEqual([
      'architecture',
      'decision',
      'project',
    ]);
    expect(document.chunks).toMatchObject([
      { heading: 'BuilderHelm', lineStart: 6, lineEnd: 8 },
      { heading: 'Evidence', lineStart: 10, lineEnd: 11 },
    ]);
    expect(document.links).toMatchObject([
      { target: 'Research Notes', label: 'benchmarks', linkType: 'wikilink' },
      { target: 'Design.md', label: 'design', linkType: 'markdown' },
    ]);
    expect(document.entities).toMatchObject([
      { canonicalName: 'Research Notes', entityType: 'note' },
    ]);
  });
});
