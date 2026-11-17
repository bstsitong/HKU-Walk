import { classroomBuilding, type Place } from './campus';
import { t } from './localization';

type Instruction = { title: string; copy: string; illustration: number };
const step = (title: string, copy: string, illustration: number): Instruction => ({ title, copy, illustration });

const enterFromC1 = step('从 C1 进入百周年校园', '过行人天桥后，乘升降机到百周年校园 G/F。', 0);
const c1ToA2 = step('沿上层大学街前往本部', '沿上层大学街往本部校园走，到黄克竞楼 5/F 的 A2 天桥口。', 1);
const enterChowYeiChing = step('进入周亦卿楼', '从 G/F 入口进入，沿大厅内的 CBA 标牌走。', 4);
const c1ToChowYeiChing = step('沿大学街前往周亦卿楼', '沿上层大学街往本部校园方向走，抵达周亦卿楼 G/F 入口。', 1);
const upperStreet = step('沿上层大学街往本部走', '从 A2 天桥口左转，沿有盖通道经过黄丽松讲堂和邵仁枚楼。', 1);
const amenities = step('进入庄月明文娱中心', '走到有盖通道尽头，进入庄月明文娱中心。', 4);
const fromA2: Record<string, Instruction[]> = {
  'chow-yei-ching': [
    step('从 A2 天桥口右转', '沿通道往百周年校园方向直走，找到周亦卿楼入口。', 1),
    enterChowYeiChing,
  ],
  'haking-wong': [
    step('沿 A2 天桥进入黄克竞楼', '天桥接黄克竞楼 5/F。进楼后寻找通往 3/F 的楼内指示。', 4),
  ],
  'cym-amenities': [upperStreet, amenities],
  'cym-chemistry': [
    upperStreet, amenities,
    step('经月明剧院外的有盖通道', '上到 5/F，从月明剧院旁的玻璃门出去，沿有盖通道进入庄月明化学楼。', 2),
  ],
  'cym-physics': [
    step('沿上层大学街往庄月明楼群走', '从 A2 天桥口往本部校园方向走，沿大学街跟随庄月明物理楼的指示。', 1),
    step('进入庄月明物理楼', '认准物理楼（CYP）的入口标识。', 4),
  ],
  'meng-wah': [
    upperStreet, amenities,
    step('经 4/F 前往明华综合大楼', '上到文娱中心 4/F，右转出门并穿过庭院，到达明华综合大楼 G/F。', 2),
  ],
};

export function classroomDirections(origin: Place | undefined, room: Place): Instruction[] | null {
  const building = classroomBuilding(room);
  if (!building || !origin) return null;
  let approach: Instruction[];
  if (origin.id === building.id) approach = [];
  else if (origin.id === 'gate' || origin.id === 'mtr-c1') {
    const route = fromA2[building.id];
    if (!route) return null;
    if (origin.id === 'gate') approach = route;
    else if (building.id === 'chow-yei-ching') approach = [enterFromC1, c1ToChowYeiChing, enterChowYeiChing];
    else approach = [enterFromC1, c1ToA2, ...route];
  } else return null;
  const floor = room.floor;
  const code = room.abbreviation ?? room.name;
  const arrival = step('找到教室门牌', floor
    ? t('前往 {floor}，按楼内标牌找到 {room}。', { floor, room: code })
    : t('在楼内指示牌上查找 {room}。', { room: code }), 5);
  return [...approach, arrival];
}
