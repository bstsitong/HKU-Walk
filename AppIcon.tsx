import { SvgXml } from 'react-native-svg';
import paths from './prototypeIcons.json';
const aliases = { saved: 'bookmark', tips: 'leaf', food: 'utensils', groups: 'users' } as const;
export type IconName = keyof typeof paths | keyof typeof aliases;
export default function AppIcon({ name, size = 22, color = '#184d3e' }: { name: IconName; size?: number; color?: string }) {
  const key = name in aliases ? aliases[name as keyof typeof aliases] : name as keyof typeof paths;
  const body = paths[key].replace(/currentColor/g, color);
  return <SvgXml width={size} height={size} accessible={false} xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`} />;
}
