import facilityData from './server/guide/campus_facilities.json';
import type { MapDisplayLevel } from './mapDisplay';
import { translate, type Language } from './localization';

// Coordinates use the north-up artwork's 360 × 219.4 frame.
// See README for OSM geometry and the HKU lift, ramp and parking references.
export const facilityStyles = {
  lift: { icon: 'lift', label: '升降机', color: '#244d6a' },
  stairs: { icon: 'stairs', label: '楼梯', color: '#80462e' },
  bridge: { icon: 'bridge', label: '行人天桥', color: '#625076' },
  ramp: { icon: 'ramp', label: '坡道', color: '#365f4b' },
  gate: { icon: 'gate', label: '出入口', color: '#184d3e' },
  parking: { icon: 'parking', label: '停车场', color: '#414a6c' },
  accessibleParking: { icon: 'accessibleParking', label: '无障碍车位', color: '#414a6c' },
} as const;

export type CampusFacility = {
  id: string;
  kind: keyof typeof facilityStyles;
  at: readonly [number, number];
  title: string;
  english: string;
  detail: string;
  displayLevel: MapDisplayLevel;
  overview?: boolean;
  approximate?: boolean;
};

export const campusFacilities = facilityData as unknown as readonly CampusFacility[];

export const facilityName = (facility: CampusFacility, language: Language) =>
  language === 'en' && facility.english ? facility.english : translate(facility.title, language);
