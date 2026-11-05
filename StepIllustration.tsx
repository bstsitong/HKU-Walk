import Svg, { Path } from 'react-native-svg';

const drawings = [
  'M14 34 44 16l30 18M20 34h48v33H20zM35 66V43h18v23M44 78V57m-6 6 6-6 6 6',
  'M13 43h19V20m27 23h15M13 69h61M25 56h21V26m-7 7 7-7 7 7',
  'M20 70V30h48v40zM44 30v40M38 47l-5 5 5 5m12-10 5 5-5 5M38 22l6-6 6 6m30 27h1',
  'M13 24h19v44H13zM33 25l40 11m-40 32 40-11M43 46h30m-7-7 7 7-7 7',
  'M15 69h58M24 69V25h40v44M34 69V36h20v33M48 52h1M31 20h26',
  'M44 70S22 52 22 38a22 22 0 0 1 44 0c0 14-22 32-22 32Zm-10-31 7 7 13-14M29 76h30',
];

export default function StepIllustration({ step }: { step: number }) {
  return (
    <Svg width="100%" height={70} viewBox="0 0 88 86" accessible={false}>
      <Path d={drawings[step]} fill="none" stroke="#184d3e" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
