import type { Place } from './campus';
import phrases from './place-search-intents.json';
import topicData from './place-search-concepts.json';

const categoryByPhrase = new Map<string, Place['category']>();
for (const [category, values] of Object.entries(phrases)) {
  for (const phrase of values) categoryByPhrase.set(phrase, category as Place['category']);
}

// Strip conversational wording at the edges. The remaining phrase must match
// exactly, so "Main Building" or "library cafe" keeps its normal name search.
const chineseLead = new RegExp(`^(?:${[
  /你知道|请问|我想要|我想|我要|我|想要|想|帮我|给我/,
  /港大校园里|校园内|校园里|学校里|港大校内|在港大|校内|这附近|附近|周围|这里|现在/,
  /去哪里|在哪里|哪里|哪儿|可以|能不能|能|有哪些|有没有|有什么|有/,
  /找个地方|找一个地方|找几个地方|找地方|找个|找一个|找一家|找几家|找|推荐/,
  /提供|供应|买|卖|位于|在|去/,
].map(group => group.source).join('|')})+`, 'u');
const chineseTail = /(?:的地方|的地点|的场所|在哪里|在哪儿|在哪|去哪儿|去哪|附近|吗|呢|呀|啊|吧)+$/u;
const englishLead = new RegExp(`^(?:(?:${[
  /please|where can i|where could i|where to|where is|where are/,
  /i want to|i need to|i want|i need|i m looking for|looking for/,
  /can you|could you|help me|find me|find|show me|get/,
  /somewhere to|places? to|some|any|a|an|nearby/,
].map(group => group.source).join('|')}) )+`);
const englishTail = /(?: (?:on campus|in campus|at hku|near me|nearby|around here))+$/;

export function placeQueryCore(normalized: string) {
  return /^\p{Script=Han}/u.test(normalized)
    ? normalized.replace(/ /g, '').replace(chineseLead, '').replace(chineseTail, '')
    : normalized.replace(englishLead, '').replace(englishTail, '');
}

export function placeCategoryForQuery(normalized: string, core: string): Place['category'] | undefined {
  return categoryByPhrase.get(normalized) ?? categoryByPhrase.get(core);
}

type Concept = { words: string[]; category?: Place['category'] };
const concepts: Concept[] = topicData as Concept[];
const han = /\p{Script=Han}/u;
const chineseNegative = /(?:没有|不提供|未提供|无|不卖|不供应|不支持|不适合|不设|未设)\s*$/u;
const englishNegative = /(?:\bno|\bwithout|\bdoes not have|\bnot offering) (?:any )?$/;

function mentions(text: string, term: string) {
  if (!term) return false;
  if (!han.test(term)) {
    const sentence = ` ${text} `;
    const word = ` ${term} `;
    for (let index = sentence.indexOf(word); index >= 0; index = sentence.indexOf(word, index + 1)) {
      if (!englishNegative.test(sentence.slice(Math.max(0, index - 30), index + 1))) return true;
    }
    return false;
  }
  for (let index = text.indexOf(term); index >= 0; index = text.indexOf(term, index + 1)) {
    if (!chineseNegative.test(text.slice(Math.max(0, index - 8), index))) return true;
  }
  return false;
}

export function descriptivePlaceQuery(core: string) {
  const hits = concepts.flatMap(concept => concept.words.filter(word => mentions(core, word)).map(word => ({ concept, word })));
  const topics = [...new Set(hits.filter(({ word }) => !hits.some(hit => hit.word.length > word.length && mentions(hit.word, word)))
    .map(hit => hit.concept))];
  const bareTopic = topics.some(topic => topic.words.includes(core));
  const categories = new Set(topics.flatMap(topic => topic.category ? [topic.category] : []));
  if (/自习|自修|温书|温习|学习|\bstudy\b/u.test(core)) categories.add('study');
  if (/吃饭|吃东西|吃午饭|吃晚饭|用餐|\b(?:eat|dine|dining)\b/u.test(core)) categories.add('food');
  const category = categories.size === 1 ? [...categories][0] : undefined;
  const informative = [...core.replace(/ /g, '')].length >= (han.test(core) ? 2 : 4);
  return {
    bareTopic,
    category,
    matches(place: Place, descriptors: string[]) {
      if (!informative || (category && place.category !== category)) return false;
      if (topics.length) return topics.every(topic => topic.words.some(word => descriptors.some(text => mentions(text, word))));
      return descriptors.some(text => mentions(text, core));
    },
  };
}
