/**
 * 章 Markdown → EPUB3 生成 (BOOK☆WALKER 入稿用・リフロー型) [F-094]。
 *
 * `scripts/bookwalker/build-epub.mjs` の実証済ロジックを worker へ移植したもの。
 * 構成: mimetype(無圧縮) / META-INF/container.xml /
 *       OEBPS/{content.opf, nav.xhtml, style.css, cover.jpg, text/ch-*.xhtml}
 * 試し読み版 (`trial: true`) は冒頭 2 章のみ収録する (BW は試し読み EPUB も必須)。
 */
import { randomUUID } from 'node:crypto';

import JSZip from 'jszip';
import { marked } from 'marked';

export interface BwEpubChapter {
  index: number;
  heading: string;
  body_md: string;
}

export interface BwEpubInput {
  title: string;
  subtitle?: string | null;
  author: string;
  description?: string | null;
  chapters: BwEpubChapter[];
  /** 採用表紙 (JPEG バイト列)。null なら表紙なし EPUB。 */
  coverJpg?: Buffer | null;
  /** true = 試し読み版 (冒頭 2 章のみ)。 */
  trial?: boolean;
}

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Markdown → XHTML 本文 (marked の HTML 出力を XHTML 化: 自己終了タグ調整)。 */
function mdToXhtml(md: string): string {
  let html = marked.parse(md, { async: false }) as string;
  html = html
    .replace(/<br>/g, '<br/>')
    .replace(/<hr>/g, '<hr/>')
    .replace(/<img([^>]*?)(?<!\/)>/g, '<img$1/>');
  return html;
}

const xhtmlDoc = (t: string, body: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" lang="ja">
<head><meta charset="UTF-8"/><title>${esc(t)}</title><link rel="stylesheet" type="text/css" href="../style.css"/></head>
<body>${body}</body></html>`;

export async function buildEpub(input: BwEpubInput): Promise<Buffer> {
  const { title, subtitle, author, description, coverJpg } = input;
  if (input.chapters.length === 0) throw new Error('buildEpub: chapters is empty');
  const chapters = input.trial ? input.chapters.slice(0, 2) : input.chapters;

  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
 <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  );

  zip.file(
    'OEBPS/style.css',
    `body{font-family:serif;line-height:1.9;margin:0.5em 1em;}
h1{font-size:1.5em;margin:2em 0 1.5em;}h2{font-size:1.2em;margin:1.6em 0 0.8em;}h3{font-size:1.05em;margin:1.2em 0 0.6em;}
p{margin:0 0 0.9em;text-align:justify;}blockquote{margin:1em 1.5em;color:#444;}li{margin-bottom:0.3em;}`,
  );
  if (coverJpg) zip.file('OEBPS/cover.jpg', coverJpg);

  zip.file(
    'OEBPS/text/titlepage.xhtml',
    xhtmlDoc(
      title,
      `<h1 style="margin-top:35%;text-align:center;">${esc(title)}</h1>` +
        (subtitle ? `<p style="text-align:center;color:#555;">${esc(subtitle)}</p>` : '') +
        `<p style="text-align:center;margin-top:3em;">${esc(author)}</p>`,
    ),
  );

  for (const chp of chapters) {
    zip.file(
      `OEBPS/text/ch-${chp.index}.xhtml`,
      xhtmlDoc(chp.heading, `<h1>${esc(chp.heading)}</h1>\n` + mdToXhtml(chp.body_md)),
    );
  }

  const navLis = chapters
    .map((chp) => `<li><a href="text/ch-${chp.index}.xhtml">${esc(chp.heading)}</a></li>`)
    .join('\n');
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" lang="ja">
<head><meta charset="UTF-8"/><title>目次</title></head>
<body><nav epub:type="toc" id="toc"><h1>目次</h1><ol>
<li><a href="text/titlepage.xhtml">${esc(title)}</a></li>
${navLis}
</ol></nav></body></html>`,
  );

  const manifestItems = [
    coverJpg
      ? '<item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>'
      : '',
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    '<item id="titlepage" href="text/titlepage.xhtml" media-type="application/xhtml+xml"/>',
    ...chapters.map(
      (chp) =>
        `<item id="ch${chp.index}" href="text/ch-${chp.index}.xhtml" media-type="application/xhtml+xml"/>`,
    ),
  ]
    .filter(Boolean)
    .join('\n  ');
  const spineItems = [
    '<itemref idref="titlepage"/>',
    ...chapters.map((chp) => `<itemref idref="ch${chp.index}"/>`),
  ].join('\n  ');
  const descPlain = description
    ? String(description)
        .replace(/<[^>]+>/g, '')
        .slice(0, 500)
    : '';
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="ja">
 <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:identifier id="uid">urn:uuid:${randomUUID()}</dc:identifier>
  <dc:title>${esc(title)}${subtitle ? ' ' + esc(subtitle) : ''}</dc:title>
  <dc:creator>${esc(author)}</dc:creator>
  <dc:language>ja</dc:language>
  ${descPlain ? `<dc:description>${esc(descPlain)}</dc:description>` : ''}
  <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z/, 'Z')}</meta>
 </metadata>
 <manifest>
  ${manifestItems}
 </manifest>
 <spine>
  ${spineItems}
 </spine>
</package>`,
  );

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    mimeType: 'application/epub+zip',
  });
}
