import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Gera o `llms.txt` (índice) e o `llms-full.txt` (guia inteiro) no build do site, no formato de https://llmstxt.org,
 * e uma cópia em Markdown de cada página (`/guia/rotas.md`). O FlowingTS é novo e os modelos não o conhecem por
 * treinamento: com esses arquivos, um assistente lê a documentação antes de escrever código.
 */

interface Item {
  text: string;
  link: string;
}
interface Group {
  text: string;
  items: Item[];
}
interface Options {
  /** Endereço público do site, com o `base` (`https://…/flowing`). */
  site: string;
  title: string;
  summary: string;
  /** Pasta dos fontes Markdown (`docs/`). */
  srcDir: string;
  /** Pasta do build (`docs/.vitepress/dist`). */
  outDir: string;
  groups: Group[];
  /** Links que entram na seção "Optional" do índice e ficam fora do arquivo completo. */
  optional: Item[];
}

/** Troca os componentes e os blocos do VitePress por Markdown comum. */
export function toPlainMarkdown(md: string, page: string, site: string): { body: string; summary: string } {
  let summary = '';
  const body = md
    .replace(/<Aprenda>([\s\S]*?)<\/Aprenda>\n*/, (_, text: string) => {
      summary = text.trim();
      return `> ${summary}\n\n`;
    })
    // ::: tip Título … ::: vira uma citação com o título em negrito.
    .replace(/^:::\s*(\w+)\s*(.*)\n([\s\S]*?)^:::\s*$/gm, (_, kind: string, title: string, inner: string) => {
      const head = `**${title.trim() || kind}**`;
      const lines = inner.trimEnd().split('\n');
      return `${[`> ${head}`, '>', ...lines.map((l) => (l ? `> ${l}` : '>'))].join('\n')}\n`;
    })
    // Links internos viram absolutos: fora do site, `./seguranca` não leva a lugar nenhum.
    .replace(/\]\((\.{0,2}\/[^)\s#]*)(#[^)\s]*)?\)/g, (_, path: string, hash = '') => {
      const url = new URL(path, `https://x${page}`).pathname;
      return `](${site}${url}${hash})`;
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { body, summary };
}

export async function writeLlmsFiles(o: Options): Promise<void> {
  const index: string[] = [`# ${o.title}`, '', `> ${o.summary}`, ''];
  index.push(
    'Escrito em português. Use as rotas, os schemas e os decorators como estão nestes guias: o pacote npm é `flowingts`, os decorators são os nativos do TC39 (sem `experimentalDecorators`).',
    '',
  );
  const full: string[] = [`# ${o.title}`, '', `> ${o.summary}`, ''];

  for (const group of o.groups) {
    index.push(`## ${group.text}`, '');
    for (const item of group.items) {
      const md = await readFile(join(o.srcDir, `${item.link}.md`), 'utf8');
      const { body, summary } = toPlainMarkdown(md, item.link, o.site);
      await mkdir(dirname(join(o.outDir, `${item.link}.md`)), { recursive: true });
      await writeFile(join(o.outDir, `${item.link}.md`), `${body}\n`);
      index.push(`- [${item.text}](${o.site}${item.link}.md)${summary ? `: ${summary}` : ''}`);
      full.push(`---`, '', `Fonte: ${o.site}${item.link}`, '', body, '');
    }
    index.push('');
  }

  if (o.optional.length) {
    index.push('## Optional', '');
    for (const item of o.optional) index.push(`- [${item.text}](${o.site}${item.link})`);
    index.push('');
  }

  await writeFile(join(o.outDir, 'llms.txt'), index.join('\n'));
  await writeFile(join(o.outDir, 'llms-full.txt'), full.join('\n'));
}
