import type { GuideArticle } from './guideApi';
import { normalizeSearchText } from './placeMatching';

export type ReaderKind = 'links' | 'handbook' | 'food' | 'groups';
export function readerKind(article: GuideArticle): ReaderKind | undefined {
  if (article.isCommunity === true || !article.markdown) return;
  return ({ '快捷链接': 'links', 'HKU 指南': 'handbook', 'HKU美食分享': 'food', '娱乐群': 'groups' } as Record<string, ReaderKind>)[article.title];
}
export const cleanGuideText = (value: string) => value.replace(/!\[[^\]]*\]\([^\n]*?\)/g, '').replace(/\[([^\]]+)\]\([^\n]*?\)/g, '$1')
  .replace(/<[^>]+>/g, '').replace(/[~*_`\\]/g, '').replace(/^#+\s*/, '').trim();
export function matchesGuideQuery(query: string, ...values: string[]) {
  const terms = normalizeSearchText(query).split(' ').filter(Boolean);
  const haystack = normalizeSearchText(values.join(' '));
  return terms.every(term => haystack.includes(term));
}
export function guideImages(body: string) {
  return [...body.matchAll(/!\[([^\]]*)\]\(([^\s)]+)\)/g)].map(match => ({ alt: match[1], url: match[2] }));
}
export function guideSections(body: string, level = 1) {
  const lines = body.replace(/\\n/g, '\n').replace(/\r\n/g, '\n').split('\n');
  const result: { id: string; title: string; body: string }[] = [];
  let current: (typeof result)[number] | undefined;
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading?.[1].length === level) {
      current = { id: String(result.length), title: cleanGuideText(heading[2]).replace(/[（(]?已完成[）)]?|\(?completed\)?/gi, '').trim(), body: '' };
      result.push(current);
    } else if (current) current.body += line + '\n';
  }
  return result.map(item => ({ ...item, body: item.body.trim() }));
}

const linkAliases: Record<string, string> = {
  'HKU PORTAL 系统（入学注册、查成绩、资源搜索）': 'HKU Portal',
  'CDS TPG 学生管理系统（选课系统）': 'CDS TPG 选课系统',
  'Moodle（交作业、下载课件，最常用）': 'Moodle', '图书馆预约': '图书馆',
  '打印机资料上传(需要连接校园网)': '打印资料上传',
};
export function quickLinkGroups(source: GuideArticle, localized: GuideArticle) {
  const translated = guideSections(localized.body, 3);
  return guideSections(source.body, 3).map((group, index) => {
    const localLines = (translated[index]?.body ?? group.body).split('\n');
    const lines = group.body.split('\n');
    let name = '', localName = '';
    const namesByUrl = new Map<string, string>();
    for (const line of localLines) {
      const match = /^\[([^\]]*)\]\((.+)\)\s*$/.exec(line.trim());
      if (match) namesByUrl.set(match[2], localName);
      else if (/^\*\*.*\*\*$/.test(line.trim())) localName = cleanGuideText(line);
    }
    const links: { id: string; title: string; sourceTitle: string; alias?: string; url: string }[] = [];
    lines.forEach((line, i) => {
      const link = /^\[([^\]]*)\]\((.+)\)\s*$/.exec(line.trim());
      if (link && /^https?:\/\//.test(link[2])) {
        links.push({ id: `${group.id}-${links.length}`, title: namesByUrl.get(link[2]) || name, sourceTitle: name, alias: linkAliases[name], url: link[2] });
      } else if (/^\*\*.*\*\*$/.test(line.trim())) {
        name = cleanGuideText(line);
      }
    });
    if (group.id === '2') links.sort((a, b) => Number(b.alias === 'Moodle') - Number(a.alias === 'Moodle'));
    if (group.id === '3') {
      const priority = (item: typeof links[number]) => { const rank = ['图书馆', '打印资料上传', '医务室预约'].indexOf(item.alias ?? item.sourceTitle); return rank < 0 ? 99 : rank; };
      links.sort((a,b) => priority(a) - priority(b));
    }
    return { ...group, title: cleanGuideText(translated[index]?.title ?? group.title).replace(/^[一二三四五六七八九十]+[、.]\s*/, ''), links };
  }).sort((a, b) => {
    const order = ['2', '3', '0', '1', '4', '5', '6'];
    return order.indexOf(a.id) - order.indexOf(b.id);
  });
}

export type HandbookEntry = { id: string; title: string; sourceTitle: string; body: string; sourceBody: string; pageKey?: string; group: string };
export function handbookEntries(source: GuideArticle, localized: GuideArticle): HandbookEntry[] {
  const local = guideSections(localized.body);
  return guideSections(source.body).flatMap((section, index) => {
    if (!section.body.trim()) return [];
    const originalTitle = cleanGuideText(section.title);
    const anchor = /\]\(#([^\n)]+)\)/.exec(section.body)?.[1];
    const pageKey = anchor && decodeURIComponent(anchor);
    const group = /portal|学生证|选课/i.test(originalTitle) ? '入学注册' : /HKID|八达通|八校通|港深通勤/.test(originalTitle) ? '证件与通行'
      : /firm offer|Evisa|d签注/i.test(originalTitle) ? '入学准备' : '校园生活';
    return [{ id: section.id, title: local[index]?.title ?? section.title, sourceTitle: originalTitle,
      body: local[index]?.body ?? section.body, sourceBody: section.body,
      pageKey: pageKey && source.sourcePages?.[pageKey] ? pageKey : undefined, group }];
  });
}
export function orderedGuideSteps(body: string) {
  const steps: { body: string; images: ReturnType<typeof guideImages> }[] = [];
  let current: (typeof steps)[number] | undefined;
  let introduction = '';
  for (const line of body.split('\n')) {
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (numbered) { current = { body: numbered[1], images: [] }; steps.push(current); }
    else if (current) current.body += '\n' + line;
    else introduction += line + '\n';
  }
  for (const step of steps) {
    step.images = guideImages(step.body);
    step.body = step.body.replace(/!\[[^\]]*\]\([^\n]+\)/g, '').trim();
  }
  return { introduction: introduction.trim(), steps };
}
export function tableGuideSteps(body: string) {
  const lines = body.split('\n');
  const first = lines.findIndex(line => /^\|/.test(line));
  if (first < 0) return undefined;
  const rows = lines.slice(first).filter(line => /^\|/.test(line));
  const steps = rows.slice(2).map(line => line.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()))
    .filter(cells => cells.length >= 2).map(cells => ({ title: cleanGuideText(cells[0]), body: cells.slice(1).join(' | ').replace(/<\/?u>/g, '') }));
  return steps.length ? { introduction: lines.slice(0, first).join('\n').trim(), steps } : undefined;
}

export type FoodRegion = 'all' | 'b1' | 'b2' | 'water' | 'c2' | 'high' | 'ktown' | 'belcher' | 'other';
export const foodRegionLabels: Record<FoodRegion, string> = { all: '全部', b1: 'B1 附近', b2: 'B2 附近', water: '水街', c2: 'C2 附近', high: '高街', ktown: '坚尼地城', belcher: '西宝城', other: '其他' };
export type FoodEntry = { id: string; title: string; sourceTitle: string; body: string; region: FoodRegion; cuisine?: string; pageKey?: string; image?: ReturnType<typeof guideImages>[number] };
function foodRegion(text: string): FoodRegion {
  return /b1/i.test(text) ? 'b1' : /b2/i.test(text) ? 'b2' : /水街/.test(text) ? 'water' : /c2/i.test(text) ? 'c2' : /高街/.test(text) ? 'high'
    : /k\s*town|ktown/i.test(text) ? 'ktown' : /西寶城|西宝城/.test(text) ? 'belcher' : 'other';
}
function numberedFoods(body: string) {
  const separated = body.replace(/([^\n\d])(\d{1,2}\.\s*[A-Za-z\u3400-\u9fff])/g, '$1\n\n$2');
  const chunks = [...separated.matchAll(/(?:^|\n)(\d+)\.\s*([^\n]*(?:\n(?!\n|\d+\.).*)?)/g)];
  return chunks.map(match => ({ id: match[1], body: match[2].trim() }));
}
export function foodEntries(source: GuideArticle, localized: GuideArticle): FoodEntry[] {
  const local = new Map(numberedFoods(localized.body).map(item => [item.id, item.body]));
  const result: FoodEntry[] = numberedFoods(source.body).map(item => {
    const cuisine = /japanese/i.test(item.body) ? '日式餐饮' : /taiwanese/i.test(item.body) ? '台湾餐饮' : /korean/i.test(item.body) ? '韩式餐饮'
      : /vietnamese/i.test(item.body) ? '越南餐饮' : /western/i.test(item.body) ? '西式餐饮' : undefined;
    const title = (local.get(item.id) ?? item.body).replace(/\s*(?:japanese|taiwanese|korean|chinese|vietnamese|western|hk(?: noodles)?|noodles)\b.*$/i, '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s*(?:水街|高街).*$/, '').replace(/\s*[—–-]\s*$/, '').trim();
    return { id: `food-${item.id}`, title, sourceTitle: item.body, body: local.get(item.id) ?? item.body, region: foodRegion(item.body), cuisine };
  });
  for (const [pageKey, page] of Object.entries(source.sourcePages ?? {})) {
    const title = cleanGuideText(page.title).replace(/^b\d口/i, '');
    const existing = result.find(item => normalizeSearchText(item.sourceTitle) === normalizeSearchText(title));
    const detail = { pageKey, image: guideImages(page.body)[0], region: foodRegion(page.title) };
    if (existing) Object.assign(existing, detail);
    else result.unshift({ id: `page-${pageKey}`, title: cleanGuideText(localized.sourcePages?.[pageKey]?.title ?? title).replace(/^b\d口/i, ''), sourceTitle: title, body: page.body, ...detail });
  }
  return result.sort((a,b) => Number(Boolean(b.pageKey)) - Number(Boolean(a.pageKey)));
}
export function groupEntries(source: GuideArticle, localized: GuideArticle) {
  const titles = (body: string) => body.split(/\n\s*\n/).map(part => part.trim()).filter(part => part && !part.startsWith('!['));
  const sourceTitles = titles(source.body), localTitles = titles(localized.body);
  return guideImages(source.body).map((image, index) => {
    const sourceTitle = sourceTitles[index] ?? image.alt;
    const group = /攀岩|徒步|篮球|羽毛球|健身|足球/.test(sourceTitle) ? '运动' : /深圳|罗湖/.test(sourceTitle) ? '同城' : '兴趣';
    return { id: String(index), title: localTitles[index] ?? sourceTitle, sourceTitle, group, image };
  }).sort((a,b) => ['0','3','4','5','6','1','2','7','8','9','10'].indexOf(a.id) - ['0','3','4','5','6','1','2','7','8','9','10'].indexOf(b.id));
}
