import Svg, { Path } from 'react-native-svg';

const paths = {
  map: 'm3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Zm6-3v15m6-12v15',
  book: 'M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1Zm0 0v15',
  link: 'm9 15 6-6M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 10a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1',
  tips: 'M20 3C8 2 3 8 5 14c2 6 12 7 15-11ZM4 21 16 9',
  food: 'M3 9h14v6a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6Zm14 1h2a3 3 0 0 1 0 6h-2M6 2v3m4-3v3m4-3v3',
  groups: 'M15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm-9 14v-4a6 6 0 0 1 12 0v4M4 7a3 3 0 0 0 0 6m16-6a3 3 0 0 1 0 6M1 22v-3a4 4 0 0 1 3-4m19 7v-3a4 4 0 0 0-3-4',
  saved: 'M6 3h12v19l-6-4-6 4Z',
  more: 'M4 11v2m8-2v2m8-2v2',
  back: 'm14 6-6 6 6 6',
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  external: 'M14 3h7v7m0-7L10 14M10 5H3v16h16v-7',
  refresh: 'M20 9a8 8 0 1 0-1 9M20 3v6h-6',
  chevron: 'm9 6 6 6-6 6',
};

export type IconName = keyof typeof paths;
export default function AppIcon({ name, color = '#184d3e', size = 22 }: { name: IconName; color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path d={paths[name]} fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
