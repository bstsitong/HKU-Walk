import { Converter } from 'opencc-js/t2cn';
import { pinyin } from 'pinyin-pro';
import type { Category, Place } from './campus';
import campusAliases from './place-search-aliases.json';

const han = /\p{Script=Han}/u;
const chinese = /^\p{Script=Han}+$/u;
const english = /^[a-z]+$/;
const aliasesByPlace: Readonly<Record<string, string[]>> = campusAliases;
let simplify: ReturnType<typeof Converter> | undefined;

function normalize(value: string) {
  const text = value.normalize('NFKC').toLowerCase();
  const simplified = han.test(text) ? (simplify ??= Converter({ from: 'hk', to: 'cn' }))(text) : text;
  return simplified.normalize('NFD')
    .replace(/u\u0308/g, 'v')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const compact = (text: string) => text.replace(/ /g, '');
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

type Profile = { names: string[]; aliases: string[]; romanized: string[]; words: string[] };
const profiles = new WeakMap<Place, Profile>();

function profileFor(place: Place): Profile {
  const cached = profiles.get(place);
  if (cached) return cached;
  const names = unique([place.name, place.english, typeof place.abbreviation === 'string' ? place.abbreviation : ''].map(normalize));
  const keywords = typeof place.keywords === 'string' ? place.keywords.split(/[,;|，；、\n]+/) : [];
  const aliases = unique([...keywords, ...keywords.flatMap(value => value.split(/\s+/)), ...(aliasesByPlace[place.id] ?? [])].map(normalize));
  const texts = [...names, ...aliases];
  const romanized = unique(texts.filter(text => han.test(text))
    .map(text => compact(normalize(pinyin(text, { toneType: 'none', nonZh: 'consecutive' })))));
  const profile = {
    names: unique(names.map(compact)), aliases: unique(aliases.map(compact)), romanized,
    words: unique(texts.flatMap(text => text.split(' '))),
  };
  profiles.set(place, profile);
  return profile;
}

function matchScore(profile: Profile, query: string, terms: string[]) {
  const { names, aliases, romanized, words } = profile;
  if (names.includes(query)) return 0;
  if (aliases.includes(query)) return 1;
  if (names.some(name => name.startsWith(query))) return 2;
  if (aliases.some(alias => alias.startsWith(query))) return 3;
  if (query.length >= 3 && english.test(query) && romanized.includes(query)) return 4;
  if ([...names, ...aliases].some(text => text.includes(query))) return 5;
  if (terms.length > 1 && terms.every(term => [...term].length > 1 && words.some(word => word.includes(term)))) return 6;
  if (query.length >= 3 && english.test(query) && romanized.some(text => text.includes(query))) return 7;
  return undefined;
}

// At most one insertion, deletion, substitution, or adjacent swap.
function oneEdit(first: string, second: string) {
  const a = [...first], b = [...second];
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length > b.length) return oneEdit(second, first);
  let index = 0;
  while (index < a.length && a[index] === b[index]) index++;
  if (a.length < b.length) return a.slice(index).every((char, offset) => char === b[index + offset + 1]);
  if (index === a.length) return false;
  if (a.slice(index + 1).every((char, offset) => char === b[index + offset + 1])) return true;
  return a[index] === b[index + 1] && a[index + 1] === b[index]
    && a.slice(index + 2).every((char, offset) => char === b[index + offset + 2]);
}

function correctionScore(profile: Profile, query: string) {
  const script = chinese.test(query) ? chinese : english;
  const close = (text: string) => script.test(text) && oneEdit(query, text);
  if (profile.names.some(close)) return 0;
  if (profile.aliases.some(close) || profile.words.some(close)) return 1;
  return undefined;
}

export function matchCampusPlaces(places: Place[], category: Category, input: string, recentIds: readonly string[] = []): Place[] {
  const candidates = category === 'all' ? places : places.filter(place => place.category === category);
  if (!input.trim()) return candidates;
  const normalized = normalize(input.slice(0, 120));
  if (!normalized) return [];
  const query = compact(normalized);
  const terms = normalized.split(' ');
  const recentRank = new Map(recentIds.map((id, index) => [id, index]));

  function rank(scoreFor: (profile: Profile) => number | undefined) {
    return candidates.flatMap(place => {
      const score = scoreFor(profileFor(place));
      return score === undefined ? [] : [{ place, score }];
    }).sort((a, b) => a.score - b.score
      || (recentRank.get(a.place.id) ?? recentIds.length) - (recentRank.get(b.place.id) ?? recentIds.length))
      .map(result => result.place);
  }

  const matches = rank(profile => matchScore(profile, query, terms));
  const canCorrect = (chinese.test(query) && [...query].length >= 3)
    || (english.test(query) && query.length >= 5);
  if (matches.length || !canCorrect) return matches;
  return rank(profile => correctionScore(profile, query)).slice(0, 3);
}
