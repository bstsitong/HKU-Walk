import { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SvgXml } from 'react-native-svg';
import { MAP_ART } from './MapArtwork';
import { Pressable, Image, Text } from './ui';
import { Field } from './CommunityUI';
import AppIcon from './AppIcon';
import PlaceSearch from './PlaceSearch';
import { categories, getPlace, placeName } from './campus';
import { Kind, contributionImageSource } from './communityApi';
import { MapDraftData, RouteStepDraft } from './mapSubmission';
import { t } from './localization';
import { colors as c } from './theme';
import MapCanvas from './MapCanvas';

function PointPicker({ data, disabled, onChange }: { data: MapDraftData; disabled: boolean; onChange: (patch: Partial<MapDraftData>) => void }) {
  const [size, setSize] = useState({ width: 300, height: 483 });
  const selected = typeof data.x === 'number' && typeof data.y === 'number';
  const move = (dx: number, dy: number) => onChange({ x: Math.max(0,Math.min(360,(data.x ?? 180) + dx)), y: Math.max(0,Math.min(580,(data.y ?? 290) + dy)) });
  return <View><Text style={s.label}>在地图上点选位置</Text><Text style={s.copy}>点击校园示意图放置标记，可用方向按钮微调。</Text>
    <Pressable testID="new-place-map" accessibilityRole="button" accessibilityLabel="点选新地点位置" disabled={disabled} onLayout={event => setSize(event.nativeEvent.layout)} onPress={event => { const { locationX, locationY } = event.nativeEvent; onChange({ x: Math.round(locationX / size.width * 360), y: Math.round(locationY / size.height * 580) }); }} style={s.picker}>
      <SvgXml pointerEvents="none" xml={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 580">${MAP_ART}</svg>`} width="100%" height="100%" accessible={false} />
      {selected ? <View pointerEvents="none" style={[s.marker,{ left: data.x! / 360 * size.width - 16, top: data.y! / 580 * size.height - 16 }]}><AppIcon name="pin" color="#fff" size={20} /></View> : null}
    </Pressable>
    <Text style={s.copy}>{selected ? '已选好地点位置' : '尚未选点'}</Text>
    <View style={s.row}>{[[-3,0,'left'],[0,-3,'up'],[0,3,'down'],[3,0,'right']].map(([dx,dy,direction]) => <Pressable key={String(direction)} accessibilityRole="button" accessibilityLabel={t('向{direction}微调', { direction: t(direction === 'left' ? '左' : direction === 'right' ? '右' : direction === 'up' ? '上' : '下') })} disabled={disabled} onPress={() => move(Number(dx),Number(dy))} style={s.nudge}><Text raw style={s.nudgeText}>{direction === 'left' ? '←' : direction === 'right' ? '→' : direction === 'up' ? '↑' : '↓'}</Text></Pressable>)}</View>
  </View>;
}
export default function MapSubmissionFields({ kind, data, onChange, disabled, onPickStep, token }: { kind: Kind; data: MapDraftData; onChange: (value: MapDraftData) => void; disabled: boolean; onPickStep: (index: number) => void; token?: string }) {
  const [selector, setSelector] = useState<'originId' | 'destinationId' | null>(null);
  const patch = (value: Partial<MapDraftData>) => onChange({ ...data, ...value });
  const updateStep = (index: number, value: Partial<RouteStepDraft>) => patch({ steps: data.steps?.map((step,i) => i === index ? { ...step,...value } : step) });
  const moveStep = (index: number, offset: number) => { const steps = [...(data.steps || [])]; [steps[index],steps[index + offset]] = [steps[index + offset],steps[index]]; patch({ steps }); };
  if (kind === 'new_place') return <View style={s.section}>
    <Field label="英文名称（选填）" value={data.english || ''} onChangeText={english => patch({ english })} maxLength={160} editable={!disabled} />
    <Text style={s.label}>地点类别</Text><View style={s.categories}>{[...categories.filter(item => item.id !== 'all'),{ id: 'space' as const, label: '校园空间' }].map(item => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ checked: data.category === item.id }} disabled={disabled} onPress={() => patch({ category: item.id as NonNullable<MapDraftData['category']> })} style={[s.category,data.category === item.id && s.active]}><Text style={[s.categoryText,data.category === item.id && s.white]}>{item.label}</Text></Pressable>)}</View>
    <PointPicker data={data} disabled={disabled} onChange={patch} />
    <Field label="入口说明（选填）" value={data.entrance || ''} onChangeText={entrance => patch({ entrance })} maxLength={1000} editable={!disabled} multiline />
    <Field label="楼层说明（选填）" value={data.floor || ''} onChangeText={floor => patch({ floor })} maxLength={500} editable={!disabled} />
  </View>;
  if (kind !== 'new_route') return null;
  return <View style={s.section}><Text style={s.label}>路线起终点</Text><View style={s.endpoints}>{(['originId','destinationId'] as const).map(key => { const place = getPlace(data[key] || ''); return <Pressable key={key} accessibilityRole="button" disabled={disabled} onPress={() => setSelector(key)} style={s.endpoint}><View style={s.flex}><Text style={s.copy}>{key === 'originId' ? '起点' : '终点'}</Text><Text raw style={s.label}>{place ? placeName(place) : t('请选择地点')}</Text></View><AppIcon name="chevron" size={17} /></Pressable>; })}</View>
    <Text style={s.label}>图文步骤</Text><Text style={s.copy}>按行走顺序填写，每一步可以单独上传照片。最多 20 步。</Text>
    {(data.steps || []).map((step,index) => { const uri = step.image?.uri || (!step.removeImage ? step.existingImage : ''); return <View key={index} style={s.stepCard}>
      <View style={s.row}><Text style={[s.label,s.flex]}>{t('第 {step} 步', { step: index + 1 })}</Text><Pressable accessibilityRole="button" accessibilityLabel="步骤上移" disabled={disabled || index === 0} onPress={() => moveStep(index,-1)} style={[s.iconButton,index === 0 && s.dim]}><Text raw>↑</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="步骤下移" disabled={disabled || index === (data.steps?.length || 0) - 1} onPress={() => moveStep(index,1)} style={[s.iconButton,index === (data.steps?.length || 0) - 1 && s.dim]}><Text raw>↓</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="移除此步骤" disabled={disabled || data.steps?.length === 1} onPress={() => patch({ steps: data.steps?.filter((_,i) => i !== index) })} style={s.iconButton}><AppIcon name="trash" size={18} /></Pressable></View>
      <Field label="步骤标题" value={step.title} onChangeText={title => updateStep(index,{ title })} editable={!disabled} maxLength={160} placeholder="例如：乘电梯到连接楼层" />
      <Field label="步骤说明" value={step.body} onChangeText={body => updateStep(index,{ body })} editable={!disabled} multiline maxLength={1500} placeholder="写清方向、地标和楼层，方便同学辨认。" />
      {uri ? <Image source={contributionImageSource(uri,step.image ? undefined : token)} style={s.photo} resizeMode="cover" accessibilityLabel="步骤配图预览" /> : null}
      <View style={s.row}><Pressable accessibilityRole="button" disabled={disabled} onPress={() => onPickStep(index)} style={s.photoButton}><AppIcon name="photo" size={18} /><Text style={s.link}>{uri ? '更换这一步配图' : '添加这一步配图'}</Text></Pressable>{uri ? <Pressable accessibilityRole="button" disabled={disabled} onPress={() => updateStep(index,{ image: null, removeImage: true })} style={s.photoButton}><Text style={s.link}>移除图片</Text></Pressable> : null}</View>
    </View>; })}
    <Pressable accessibilityRole="button" disabled={disabled || (data.steps?.length || 0) >= 20} onPress={() => patch({ steps: [...(data.steps || []),{ title: '', body: '' }] })} style={s.addStep}><AppIcon name="plus" size={19} /><Text style={s.link}>添加下一步</Text></Pressable>
    <Modal visible={selector !== null} animationType="slide" onRequestClose={() => setSelector(null)}><SafeAreaView style={[s.flex,{ backgroundColor: c.app }]}><PlaceSearch title={selector === 'originId' ? '选择起点' : '选择终点'} onBack={() => setSelector(null)} onChoose={place => { if (selector) patch({ [selector]: place.id }); setSelector(null); }} /></SafeAreaView></Modal>
  </View>;
}
export function SubmittedMapData({ data, token }: { data?: MapDraftData; token?: string }) {
  if (!data?.type) return null;
  return <View style={s.section}>{data.type === 'place' ? <><Text style={s.label}>地点资料</Text><Text raw style={s.copy}>{data.english}</Text><View style={{ height: 180, borderRadius: 10, overflow: 'hidden' }}><MapCanvas selected={{ id: 'submission-location', name: '', english: '', keywords: '', category: data.category || 'space', x: data.x ?? 180, y: data.y ?? 290, isCommunity: true }} variant="mini" /></View><Text raw style={s.copy}>{data.entrance}</Text><Text raw style={s.copy}>{data.floor}</Text></> : <><Text style={s.label}>路线步骤</Text><Text raw style={s.copy}>{getPlace(data.originId || '') ? placeName(getPlace(data.originId || '')!) : data.originId} → {getPlace(data.destinationId || '') ? placeName(getPlace(data.destinationId || '')!) : data.destinationId}</Text>{data.steps?.map((step,index) => <View key={index} style={s.stepCard}><Text raw style={s.label}>{index + 1}. {step.title}</Text><Text raw style={s.copy}>{step.body}</Text>{step.imageUrl ? <Image source={contributionImageSource(step.imageUrl,token)} style={s.photo} accessibilityLabel="投稿步骤配图" resizeMode="cover" /> : null}</View>)}</>}</View>;
}
const s = StyleSheet.create({ flex: { flex: 1 }, section: { marginTop: 16 }, label: { fontSize: 14, lineHeight: 23, fontWeight: '700', color: c.ink }, copy: { fontSize: 12, lineHeight: 21, color: c.muted, marginVertical: 6 }, categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 9, marginBottom: 18 }, category: { backgroundColor: c.tint, minHeight: 44, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 9 }, categoryText: { fontSize: 12, lineHeight: 20, color: c.green }, active: { backgroundColor: c.green }, white: { color: '#fff' }, picker: { width: '100%', aspectRatio: 360 / 580, backgroundColor: c.tint, marginTop: 10, borderRadius: 12, overflow: 'hidden' }, marker: { position: 'absolute', width: 32, height: 32, borderRadius: 16, backgroundColor: c.rust, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }, row: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }, nudge: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: c.tint, borderRadius: 8 }, nudgeText: { color: c.green, fontSize: 21 }, endpoints: { borderWidth: 1, borderColor: c.line, backgroundColor: '#fff', borderRadius: 12, marginTop: 10, marginBottom: 22, overflow: 'hidden' }, endpoint: { minHeight: 64, flexDirection: 'row', alignItems: 'center', padding: 13, borderBottomWidth: 1, borderBottomColor: c.line }, stepCard: { marginTop: 14, padding: 14, borderRadius: 13, backgroundColor: c.tint }, iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }, dim: { opacity: 0.35 }, photo: { width: '100%', height: 170, borderRadius: 10, marginTop: 12, backgroundColor: c.paper }, photoButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 8 }, link: { fontSize: 13, fontWeight: '700', color: c.green, lineHeight: 21 }, addStep: { minHeight: 50, backgroundColor: c.tint, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 } });
