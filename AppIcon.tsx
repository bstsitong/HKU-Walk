import { SvgXml } from 'react-native-svg';
import paths from './prototypeIcons.json';
const aliases = { saved: 'bookmark', tips: 'leaf', food: 'utensils', groups: 'users' } as const;
const mail = '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>';
export type IconName = keyof typeof paths | keyof typeof aliases | 'mail';
export default function AppIcon({ name, size = 22, color = '#184d3e' }: { name: IconName; size?: number; color?: string }) {
  const key = name in aliases ? aliases[name as keyof typeof aliases] : name as keyof typeof paths;
  const body = (name === 'mail' ? mail : paths[key]).replace(/currentColor/g, color);
  return <SvgXml width={size} height={size} accessible={false} xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`} />;
}
