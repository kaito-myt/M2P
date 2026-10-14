import {
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  LineRuleType,
  type IParagraphOptions,
  type ParagraphChild,
  ExternalHyperlink,
} from 'docx';
import { marked, type Token, type Tokens } from 'marked';

const FONT = 'Noto Sans JP';
const BODY_SIZE = 22; // 11pt in half-points

function textRun(text: string, opts?: { bold?: boolean; italic?: boolean; font?: string; size?: number }): TextRun {
  return new TextRun({
    text,
    bold: opts?.bold,
    italics: opts?.italic,
    font: opts?.font ?? FONT,
    size: opts?.size ?? BODY_SIZE,
  });
}

function flattenInlineTokens(
  tokens: Token[],
  inherited?: { bold?: boolean; italic?: boolean },
): (TextRun | ExternalHyperlink)[] {
  const runs: (TextRun | ExternalHyperlink)[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'text': {
        const t = token as Tokens.Text;
        if ('tokens' in t && t.tokens) {
          runs.push(...flattenInlineTokens(t.tokens, inherited));
        } else {
          runs.push(textRun(t.text, inherited));
        }
        break;
      }
      case 'strong': {
        const t = token as Tokens.Strong;
        runs.push(...flattenInlineTokens(t.tokens, { ...inherited, bold: true }));
        break;
      }
      case 'em': {
        const t = token as Tokens.Em;
        runs.push(...flattenInlineTokens(t.tokens, { ...inherited, italic: true }));
        break;
      }
      case 'codespan': {
        const t = token as Tokens.Codespan;
        runs.push(
          new TextRun({
            text: t.text,
            font: 'Courier New',
            size: BODY_SIZE,
            bold: inherited?.bold,
            italics: inherited?.italic,
          }),
        );
        break;
      }
      case 'link': {
        const t = token as Tokens.Link;
        runs.push(
          new ExternalHyperlink({
            children: [
              new TextRun({
                text: t.text,
                font: FONT,
                size: BODY_SIZE,
                style: 'Hyperlink',
              }),
            ],
            link: t.href,
          }),
        );
        break;
      }
      case 'br': {
        runs.push(new TextRun({ text: '', break: 1 }));
        break;
      }
      default: {
        if ('text' in token && typeof token.text === 'string') {
          runs.push(textRun(token.text, inherited));
        }
        break;
      }
    }
  }
  return runs;
}

function inlineTokensToParagraph(
  tokens: Token[],
  opts?: Partial<IParagraphOptions>,
): Paragraph {
  const children = flattenInlineTokens(tokens);
  return new Paragraph({ ...opts, children });
}

/**
 * Markdown → docx 段落列。
 *
 * `suppressHeadings` (小説・ラノベ等のフィクション) を立てると、本文中の `#`/`##` 見出しを
 * **見出しスタイルではなく通常段落** として描画する。
 * 2026-10-14: ジャンル誤判定 (全候補が 'practical' 固定) でラノベ・小説が実用書として
 * 執筆され、本文に小見出しが残った本が出た。ジャンル判定自体は修正済みだが、
 * 出力側でも「小説に見出しは入れない」を担保する (文字は落とさず見出し化だけ止める)。
 */
export function markdownToDocxElements(
  md: string,
  opts: { suppressHeadings?: boolean } = {},
): Paragraph[] {
  const tokens = marked.lexer(md);
  return tokensToElements(tokens, opts);
}

function tokensToElements(
  tokens: Token[],
  opts: { suppressHeadings?: boolean } = {},
): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const t = token as Tokens.Heading;
        if (opts.suppressHeadings) {
          // 小説: 見出し行そのものを出さない。
          // 実物は `## 1. 式神の忘れ物が招いた千年ジャンプ` のような純粋な構造ラベルで、
          // 小説に見出しは設計上そもそも存在しない (アウトラインの「場面の流れ」は内部メモ)。
          // 本文の一段落として流すと地の文の途中に題名が落ちた壊れた組版になるため落とす。
          // `chapters.body_md` は無改変なので、この判断は出力側だけで可逆。
          break;
        }
        const level =
          t.depth === 1
            ? HeadingLevel.HEADING_2
            : t.depth === 2
              ? HeadingLevel.HEADING_3
              : HeadingLevel.HEADING_4;
        paragraphs.push(
          new Paragraph({
            heading: level,
            children: flattenInlineTokens(t.tokens) as ParagraphChild[],
          }),
        );
        break;
      }
      case 'paragraph': {
        const t = token as Tokens.Paragraph;
        // 段落間に余白＋行間をゆったり取り、Kindle/紙面での可読性を上げる。
        paragraphs.push(
          inlineTokensToParagraph(t.tokens, {
            spacing: { after: 180, line: 336, lineRule: LineRuleType.AUTO },
          }),
        );
        break;
      }
      case 'list': {
        const t = token as Tokens.List;
        for (const item of t.items) {
          const children = item.tokens
            ? flattenInlineTokens(
                item.tokens.flatMap((sub) =>
                  'tokens' in sub && Array.isArray(sub.tokens) ? sub.tokens : [sub],
                ),
              )
            : [textRun(item.text)];
          paragraphs.push(
            new Paragraph({
              children: children as ParagraphChild[],
              bullet: { level: 0 },
            }),
          );
        }
        break;
      }
      case 'code': {
        const t = token as Tokens.Code;
        for (const line of t.text.split('\n')) {
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: line,
                  font: 'Courier New',
                  size: BODY_SIZE,
                }),
              ],
              indent: { left: 720 },
            }),
          );
        }
        break;
      }
      case 'blockquote': {
        const t = token as Tokens.Blockquote;
        for (const innerToken of t.tokens) {
          if (innerToken.type === 'paragraph') {
            const pt = innerToken as Tokens.Paragraph;
            paragraphs.push(inlineTokensToParagraph(pt.tokens, {
              indent: { left: 720 },
              alignment: AlignmentType.LEFT,
            }));
          } else {
            const nested = tokensToElements([innerToken]);
            paragraphs.push(...nested);
          }
        }
        break;
      }
      case 'hr': {
        paragraphs.push(
          new Paragraph({
            children: [textRun('---')],
            alignment: AlignmentType.CENTER,
          }),
        );
        break;
      }
      case 'space': {
        break;
      }
      default: {
        if ('text' in token && typeof token.text === 'string') {
          paragraphs.push(new Paragraph({ children: [textRun(token.text)] }));
        }
        break;
      }
    }
  }

  return paragraphs;
}
