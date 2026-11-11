import { useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import AppIcon from './AppIcon';
import { Avatar } from './AuthorIdentity';
import { Button, Field } from './CommunityUI';
import { Account, ApiError, PickedImage, ProfileDraft } from './communityApi';
import { colors as c } from './theme';
import { Alert, Pressable, Text } from './ui';

export default function EditProfile({ user, onSave, onBack, onExpired }: {
  user: Account['user']; onSave: (draft: ProfileDraft) => Promise<void>; onBack: () => void; onExpired: () => void;
}) {
  const [nickname, setNickname] = useState(user.nickname ?? '');
  const [bio, setBio] = useState(user.bio ?? '');
  const [avatar, setAvatar] = useState<PickedImage | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const uri = avatar?.uri || (removeAvatar ? '' : user.avatarUrl);
  const changed = nickname.trim() !== (user.nickname ?? '') || bio.trim() !== (user.bio ?? '') || Boolean(avatar) || removeAvatar;
  const close = () => {
    if (working.current) return;
    Keyboard.dismiss();
    if (!changed) { onBack(); return; }
    Alert.alert('放弃这次编辑？', '未提交的修改不会保存。', [
      { text: '继续编辑', style: 'cancel' }, { text: '放弃编辑', style: 'destructive', onPress: onBack },
    ]);
  };

  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => listener.remove();
  }, [onBack, changed]);

  async function chooseAvatar() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) { setError('图片需小于 5 MB，请选择较小的图片。'); return; }
      setAvatar({ uri: asset.uri, name: asset.fileName || 'avatar.jpg', type: asset.mimeType || 'image/jpeg' });
      setRemoveAvatar(false);
    } catch { setError('暂时无法选择图片，请重试。'); }
    finally { working.current = false; setBusy(false); }
  }

  async function save() {
    if (working.current || !changed) return;
    working.current = true;
    setBusy(true);
    setError('');
    Keyboard.dismiss();
    try { await onSave({ nickname, bio, avatar, removeAvatar }); onBack(); }
    catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onExpired();
      else setError(failure instanceof Error ? failure.message : '请稍后重试。');
    } finally { working.current = false; setBusy(false); }
  }

  return <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <View style={s.header}>
      <Pressable testID="profile-edit-back" accessibilityRole="button" accessibilityLabel="返回" disabled={busy} onPress={close} style={s.back}><AppIcon name="back" size={20} /></Pressable>
      <Text accessibilityRole="header" style={s.title}>编辑资料</Text>
    </View>
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <View style={s.photoRow}>
        <Avatar uri={uri} size={72} />
        <View style={s.photoActions}>
          <Pressable testID="profile-pick-avatar" accessibilityRole="button" disabled={busy} onPress={() => void chooseAvatar()} style={s.photoAction}>
            <Text style={s.actionText}>{uri ? '更换头像' : '选择头像'}</Text>
          </Pressable>
          {uri ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setAvatar(null); setRemoveAvatar(Boolean(user.avatarUrl)); }} style={s.photoAction}>
            <Text style={s.actionText}>移除头像</Text>
          </Pressable> : null}
        </View>
      </View>
      <Field label="昵称" testID="profile-nickname" value={nickname} placeholder={user.username} maxLength={32} onChangeText={setNickname} editable={!busy} />
      <Field label="个人简介" testID="profile-bio" value={bio} maxLength={160} multiline textAlignVertical="top" onChangeText={setBio} editable={!busy} style={s.bio} />
      {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
      <Button label="保存资料" onPress={() => void save()} busy={busy} disabled={!changed} />
    </ScrollView>
  </KeyboardAvoidingView>;
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  header: { width: '100%', maxWidth: 650, alignSelf: 'center', minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 4 },
  back: { width: 48, height: 48, justifyContent: 'center', alignItems: 'center' },
  title: { color: c.ink, fontSize: 20, fontWeight: '600', flexShrink: 1 },
  page: { width: '100%', maxWidth: 650, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 20 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  photoActions: { flexDirection: 'row', flexWrap: 'wrap', flexShrink: 1, columnGap: 12 },
  photoAction: { minHeight: 48, justifyContent: 'center' },
  actionText: { color: c.green, fontSize: 14, fontWeight: '600' },
  bio: { minHeight: 104 },
  error: { color: c.rust, marginTop: 12, lineHeight: 20 },
});
