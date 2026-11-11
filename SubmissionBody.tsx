import { useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import AppIcon, { IconName } from './AppIcon';
import { contributionImageSource, PickedImage } from './communityApi';
import { BodyBlockType, DraftBodyBlock, BodyBlock, maxBodyBlocks, maxBodyImages, newBodyBlock } from './submissionBlocks';
import { colors as c } from './theme';
import { Image, Pressable, Text, TextInput } from './ui';

const types: Record<BodyBlockType, { label: string; placeholder: string; icon: IconName }> = {
  paragraph: { label: '段落', placeholder: '写下正文', icon: 'edit' },
  heading: { label: '小标题', placeholder: '输入小标题', icon: 'book' },
  list: { label: '列表', placeholder: '每行一项', icon: 'more' },
  quote: { label: '引用', placeholder: '输入引用文字', icon: 'comment' },
  image: { label: '插图', placeholder: '图片说明（选填）', icon: 'photo' },
};

function BlockPhoto({ uri, token, label }: { uri: string; token?: string; label?: string }) {
  const [aspect, setAspect] = useState(4 / 3);
  return <Image source={contributionImageSource(uri, token)} style={[s.photo, { aspectRatio: aspect }]}
    resizeMode="contain" accessibilityLabel={label} onLoad={event => {
      const { width, height } = event.nativeEvent.source;
      if (width > 0 && height > 0) setAspect(Math.max(0.45, Math.min(4, width / height)));
    }} />;
}

export function SubmissionBody({ blocks, token }: { blocks: (BodyBlock & { image?: PickedImage })[]; token?: string }) {
  return <View style={s.reader}>
    {blocks.map((block, index) => {
      if (block.type === 'image') {
        const uri = block.image?.uri || block.imageUrl;
        return uri ? <View key={index}>
          <BlockPhoto key={uri} uri={uri} token={block.image ? undefined : token} />
          {block.text ? <Text raw selectable style={s.caption}>{block.text}</Text> : null}
        </View> : null;
      }
      if (!block.text.trim()) return null;
      if (block.type === 'list') return <View key={index} style={s.list}>
        {block.text.split(/\r?\n/).filter(line => line.trim()).map((line, row) =>
          <View key={row} style={s.bulletRow}><View style={s.bullet} /><Text raw selectable style={[s.copy, s.flex]}>{line.trim()}</Text></View>)}
      </View>;
      return <Text raw selectable key={index} accessibilityRole={block.type === 'heading' ? 'header' : undefined}
        style={[s.copy, block.type === 'heading' && s.heading, block.type === 'quote' && s.quote]}>{block.text}</Text>;
    })}
  </View>;
}

export default function BodyEditor({ blocks, title, token, disabled, onChange, onPickImage }: {
  blocks: DraftBodyBlock[]; title: string; token?: string; disabled: boolean;
  onChange: (blocks: DraftBodyBlock[]) => void; onPickImage: () => Promise<PickedImage | null>;
}) {
  const [preview, setPreview] = useState(false);
  const [picking, setPicking] = useState(false);
  const locked = disabled || picking;
  const patch = (id: string, change: Partial<DraftBodyBlock>) => onChange(blocks.map(block => block.id === id ? { ...block, ...change } : block));
  const move = (index: number, by: number) => {
    const next = [...blocks];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    onChange(next);
  };
  const pick = async (id?: string) => {
    Keyboard.dismiss(); setPicking(true);
    try {
      const image = await onPickImage();
      if (!image) return;
      if (id) patch(id, { image });
      else onChange([...blocks, newBodyBlock('image', '', image)]);
    } finally { setPicking(false); }
  };
  return <View style={s.editor}>
    <View style={s.toolbar}>
      <Text accessibilityRole="header" style={[s.label, s.flex]}>正文</Text>
      <Pressable accessibilityRole="button" testID="body-preview" disabled={locked} style={s.control} onPress={() => { Keyboard.dismiss(); setPreview(value => !value); }}>
        <Text style={s.link}>{preview ? '继续编辑' : '预览正文'}</Text>
      </Pressable>
    </View>
    {preview ? <View style={s.preview}>
      {title.trim() ? <Text raw accessibilityRole="header" style={s.previewTitle}>{title}</Text> : null}
      <SubmissionBody blocks={blocks} token={token} />
    </View> : <>
      {blocks.map((block, index) => {
        const uri = block.image?.uri || block.imageUrl;
        return <View key={block.id} style={s.block}>
          <View style={s.toolbar}>
            <Text style={[s.blockLabel, s.flex]}>{types[block.type].label}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="区块上移" disabled={locked || index === 0} onPress={() => move(index, -1)}
              style={[s.iconButton, index === 0 && s.dim]}><View style={s.up}><AppIcon name="chevron" size={17} /></View></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="区块下移" disabled={locked || index === blocks.length - 1} onPress={() => move(index, 1)}
              style={[s.iconButton, index === blocks.length - 1 && s.dim]}><View style={s.down}><AppIcon name="chevron" size={17} /></View></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="删除区块" disabled={locked} onPress={() => onChange(blocks.filter(item => item.id !== block.id))}
              style={s.iconButton}><AppIcon name="trash" size={17} /></Pressable>
          </View>
          {block.type === 'image' && uri ? <>
            <BlockPhoto key={uri} uri={uri} token={block.image ? undefined : token} label="正文配图预览" />
            <Pressable accessibilityRole="button" disabled={locked} onPress={() => void pick(block.id)} style={s.control}><Text style={s.link}>更换图片</Text></Pressable>
          </> : null}
          <TextInput testID={`body-block-${index}`} accessibilityLabel={types[block.type].placeholder} placeholder={types[block.type].placeholder}
            value={block.text} onChangeText={text => patch(block.id, { text })} editable={!locked}
            maxLength={block.type === 'image' ? 300 : 8000} multiline textAlignVertical="top"
            style={[s.input, block.type === 'paragraph' && s.paragraph, block.type === 'heading' && s.heading]} />
        </View>;
      })}
      <View style={s.insert}>
        {(Object.keys(types) as BodyBlockType[]).map(type => {
          const unavailable = locked || blocks.length >= maxBodyBlocks ||
            (type === 'image' && blocks.filter(block => block.type === 'image').length >= maxBodyImages);
          return <Pressable key={type} testID={`body-insert-${type}`} accessibilityRole="button" disabled={unavailable}
            onPress={() => type === 'image' ? void pick() : onChange([...blocks, newBodyBlock(type)])}
            style={[s.insertButton, unavailable && s.dim]}><AppIcon name={types[type].icon} size={16} /><Text style={s.link}>{types[type].label}</Text></Pressable>;
        })}
      </View>
      {blocks.length >= maxBodyBlocks ? <Text style={s.caption}>正文最多可添加 40 个区块。</Text> : null}
      {blocks.filter(block => block.type === 'image').length >= maxBodyImages ? <Text style={s.caption}>正文最多可插入 12 张图片。</Text> : null}
    </>}
  </View>;
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  editor: { marginTop: 18 },
  toolbar: { minHeight: 48, flexDirection: 'row', alignItems: 'center' },
  label: { color: c.ink, fontSize: 15, fontWeight: '700' },
  blockLabel: { color: c.muted, fontSize: 13, fontWeight: '600' },
  control: { minHeight: 48, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: 8 },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  up: { transform: [{ rotate: '-90deg' }] },
  down: { transform: [{ rotate: '90deg' }] },
  dim: { opacity: 0.36 },
  link: { color: c.green, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  block: { paddingHorizontal: 10, paddingBottom: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 10, marginBottom: 10 },
  input: { color: c.ink, minHeight: 48, paddingHorizontal: 6, paddingVertical: 8, fontSize: 15, lineHeight: 23 },
  paragraph: { minHeight: 100 },
  insert: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 2 },
  insertButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, borderRadius: 8, backgroundColor: c.tint },
  reader: { gap: 14, paddingVertical: 12 },
  copy: { color: c.ink, fontSize: 15, lineHeight: 24 },
  heading: { color: c.ink, fontSize: 18, lineHeight: 26, fontWeight: '700' },
  quote: { backgroundColor: c.tint, borderRadius: 8, padding: 12 },
  list: { gap: 6 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  bullet: { width: 5, height: 5, borderRadius: 3, backgroundColor: c.green, marginTop: 9 },
  photo: { width: '100%', borderRadius: 8, backgroundColor: c.tint },
  caption: { fontSize: 13, lineHeight: 19, color: c.muted, marginTop: 6 },
  preview: { padding: 12, backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 10 },
  previewTitle: { fontSize: 23, lineHeight: 31, fontWeight: '700', color: c.ink },
});
