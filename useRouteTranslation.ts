import type { CampusRoute } from './campus';
import type { Language } from './localization';
import useContentTranslation from './useContentTranslation';

export default function useRouteTranslation(route: CampusRoute | undefined, language: Language, active: boolean) {
  const translation = useContentTranslation(route ? { kind: 'route', id: route.entryId, sourceVersion: route.updatedAt,
    texts: [route.title, route.body, ...route.steps.flatMap(step => [step.title, step.body])] } : undefined, language, active);
  const texts = translation.texts;
  return { ...translation, route: route && texts ? { ...route, title: texts[0], body: texts[1],
    steps: route.steps.map((step, index) => ({ ...step, title: texts[2 + index * 2], body: texts[3 + index * 2] })) } : undefined };
}
