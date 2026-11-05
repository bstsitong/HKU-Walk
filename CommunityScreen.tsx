import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable,
  RefreshControl, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import AppIcon, { IconName } from './AppIcon';
import { ApiError, contributionImageSource, Draft, fetchSubmission, fetchSubmissions, Kind, sendSubmission, Submission } from './communityApi';
import useAccount from './useAccount';
import { Button, Field } from './CommunityUI';
import { AccountSecurityScreen, RecoveryCodeScreen } from './AccountScreens';

const green = '#184d3e';
const kinds: { key: Kind; label: string; icon: IconName }[] = [
  { key: 'food', label: '美食分享', icon: 'food' }, { key: 'group', label: '娱乐群', icon: 'groups' },
  { key: 'place', label: '地点纠错', icon: 'map' }, { key: 'route', label: '路线纠错', icon: 'arrow' },
];
const statuses = { pending: '待审核', approved: '已通过', changes_requested: '需修改' };
const newDraft = (): Draft => ({ kind: 'food', title: '', body: '', location: '', externalUrl: '', image: null,
  existingImage: '', removeImage: false, requestKey: `${Date.now()}_${Math.random().toString(36).slice(2, 12)}` });
const message = (error: unknown) => error instanceof Error ? error.message : '操作暂时未完成，请重试。';
const dateText = (value: string) => new Date(value).toLocaleDateString('zh-CN');

function Status({ value }: { value: Submission['status'] }) {
  return <Text style={[s.status, value === 'approved' && s.approved, value === 'changes_requested' && s.changes]}>{statuses[value]}</Text>;
}
function AuthForm({ account, onRecover, onBusy }: { account: ReturnType<typeof useAccount>; onRecover: () => void; onBusy: (busy: boolean) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    Keyboard.dismiss(); setError('');
    if (!/^[a-z0-9_]{3,32}$/i.test(username.trim())) { setError('账号使用 3–32 位字母、数字或下划线。'); return; }
    if (!password) { setError('请输入密码。'); return; }
    if (mode === 'register' && password !== confirm) { setError('两次输入的密码不一致。'); return; }
    setBusy(true); onBusy(true);
    try { await account.signIn(mode, username.trim().toLowerCase(), password); }
    catch (error) { setError(message(error)); }
    finally { setBusy(false); onBusy(false); }
  };
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.page}>
    <View style={s.bigSymbol}><AppIcon name="groups" size={34} /></View>
    <Text accessibilityRole="header" style={s.title}>{mode === 'register' ? '一起补全校园生活' : '登录后，分享你的发现'}</Text>
    <Text style={s.copy}>账号用于投稿和查看审核结果。地图与学生指南随时可看。</Text>
    <Field label="账号" hint="3–32 位字母、数字或下划线，不区分大小写" value={username} onChangeText={setUsername}
      autoCapitalize="none" autoCorrect={false} maxLength={32} editable={!busy} textContentType="username" autoComplete="username" />
    <Field label="密码" hint={mode === 'register' ? '至少 8 位，避免使用常见密码或纯数字' : undefined} value={password} onChangeText={setPassword}
      secureTextEntry maxLength={128} editable={!busy} autoCapitalize="none" textContentType={mode === 'register' ? 'newPassword' : 'password'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} />
    {mode === 'register' ? <Field label="再次输入密码" value={confirm} onChangeText={setConfirm} secureTextEntry maxLength={128} editable={!busy} autoCapitalize="none" /> : null}
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
    <Button label={mode === 'register' ? '注册并登录' : '登录'} busy={busy} disabled={!account.ready || !!account.storageError} onPress={() => void submit()} />
    <Button label={mode === 'register' ? '已有账号？去登录' : '还没有账号？去注册'} secondary disabled={busy}
      onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setPassword(''); setConfirm(''); setError(''); }} />
    <Pressable accessibilityRole="button" disabled={busy} onPress={onRecover} style={s.textButton}><Text style={s.linkText}>忘记账号或密码？使用恢复码找回</Text></Pressable>
  </ScrollView>;
}

export default function CommunityScreen({ visible, onClose, account }: {
  visible: boolean; onClose: () => void; account: ReturnType<typeof useAccount>;
}) {
  const [screen, setScreen] = useState<'home' | 'form' | 'detail' | 'security' | 'recover'>('home');
  const [items, setItems] = useState<Submission[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [selected, setSelected] = useState<Submission | null>(null);
  const [editing, setEditing] = useState<Submission | undefined>();
  const [draft, setDraft] = useState<Draft>(newDraft);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const token = account.session?.token;
  const handleError = async (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) { await account.expire(); setError('登录已过期，请重新登录。'); }
    else setError(message(error));
  };
  const load = async (page = 1) => {
    if (!token) return;
    const version = ++generation.current;
    setLoading(true); setError('');
    try {
      const result = await fetchSubmissions(token, page);
      if (version !== generation.current) return;
      setItems(old => page === 1 ? result.submissions : [...old, ...result.submissions.filter(item => !old.some(row => row.id === item.id))]);
      setNextPage(result.nextPage);
      if (page === 1 && screen === 'detail' && selected) {
        const fresh = await fetchSubmission(token, selected.id);
        if (version === generation.current) setSelected(fresh.submission);
      }
    } catch (error) { if (version === generation.current) await handleError(error); }
    finally { if (version === generation.current) setLoading(false); }
  };
  useEffect(() => {
    generation.current++; setItems([]); setNextPage(null); setSelected(null); setEditing(undefined);
    setDraft(newDraft()); setScreen('home'); setError(''); setLoading(false);
  }, [token]);
  useEffect(() => { if (visible && token) void load(); return () => { generation.current++; }; }, [visible, token]);
  const leave = () => {
    if (busy) return;
    Keyboard.dismiss();
    if (account.recoveryCode) {
      Alert.alert('已保存恢复码？', '离开后无法再次查看，请先保存到自己的安全位置。', [
        { text: '继续查看', style: 'cancel' }, { text: '已保存，返回', onPress: account.dismissRecoveryCode },
      ]); return;
    }
    if (screen === 'form') {
      const discard = () => { setDraft(newDraft()); setEditing(undefined); setError(''); setScreen('home'); };
      if (draft.title || draft.body || draft.image || editing) Alert.alert('放弃这次编辑？', '未提交的修改不会保存。', [{ text: '继续编辑', style: 'cancel' }, { text: '放弃编辑', style: 'destructive', onPress: discard }]);
      else discard();
    } else if (screen === 'detail' || screen === 'security' || screen === 'recover') { setScreen('home'); setError(''); }
    else onClose();
  };
  const begin = async (item?: Submission) => {
    if (item?.status === 'approved' && token) {
      setBusy(true);
      try { item = (await fetchSubmission(token, item.id)).submission; }
      catch (error) { await handleError(error); return; }
      finally { setBusy(false); }
      if (item.openEditId) {
        setBusy(true);
        try { setSelected((await fetchSubmission(token, item.openEditId)).submission); setScreen('detail'); setError(''); }
        catch (error) { await handleError(error); }
        finally { setBusy(false); }
        return;
      }
      if (!item.publishedContent?.published) { setError('这条内容已经下线，暂时无法申请修改。'); return; }
    }
    setEditing(item); setError('');
    const content = item?.status === 'approved' ? item.publishedContent : item;
    setDraft(item && content ? { ...newDraft(), kind: item.kind, title: content.title, body: content.body,
      location: content.location, externalUrl: content.externalUrl, existingImage: content.imageUrl } : newDraft());
    setScreen('form');
  };
  const update = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));
  const pickImage = async () => {
    setError('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) { setError('图片需小于 5 MB，请选择较小的图片。'); return; }
      update({ image: { uri: asset.uri, name: asset.fileName || 'photo.jpg', type: asset.mimeType || 'image/jpeg' }, removeImage: false });
    } catch { setError('暂时无法选择图片，请重试。'); }
  };
  const submit = async () => {
    if (!token || busy) return;
    Keyboard.dismiss(); setError('');
    if (draft.title.trim().length < 3 || draft.body.trim().length < 10) { setError('标题至少 3 个字，正文至少 10 个字。'); return; }
    if ((draft.kind === 'place' || draft.kind === 'route') && !draft.location.trim()) { setError('请写明需要纠正的地点或路线。'); return; }
    if (draft.kind === 'group' && !draft.externalUrl.trim()) { setError('请填写娱乐群的有效邀请链接。'); return; }
    if (draft.externalUrl && !/^https?:\/\//i.test(draft.externalUrl.trim())) { setError('链接需要以 http:// 或 https:// 开头。'); return; }
    setBusy(true);
    try {
      const result = await sendSubmission(token, draft, editing);
      setSelected(result.submission); setDraft(newDraft()); setEditing(undefined); setScreen('detail');
      setItems(old => [result.submission, ...old.filter(item => item.id !== result.submission.id)]);
    } catch (error) { await handleError(error); }
    finally { setBusy(false); }
  };
  const logout = () => Alert.alert('退出当前账号？', '下次投稿时需要重新登录。', [
    { text: '取消', style: 'cancel' }, { text: '退出登录', onPress: () => { setBusy(true); void account.signOut().catch(handleError).finally(() => setBusy(false)); } },
  ]);
  const image = draft.image?.uri || (!draft.removeImage ? draft.existingImage : '');
  return <Modal visible={visible} animationType="slide" onRequestClose={leave} presentationStyle="fullScreen">
    <SafeAreaView style={s.shell}>
      <View style={s.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel={screen === 'home' ? '返回 App' : '返回我的投稿'} disabled={busy} onPress={leave} style={s.iconButton}><AppIcon name="back" /></Pressable>
        <Text style={s.topTitle}>{account.recoveryCode ? '保存恢复码' : screen === 'security' ? '账号与安全' : screen === 'recover' ? '找回账号' : screen === 'form' ? (editing?.status === 'approved' ? '申请修改已发布内容' : editing ? '修改投稿' : '新投稿') : screen === 'detail' ? '投稿详情' : '校园共建'}</Text>
        {token && (screen === 'home' || screen === 'detail') && !account.recoveryCode ? <Pressable accessibilityRole="button" accessibilityLabel="刷新投稿状态" disabled={loading || busy} onPress={() => void load()} style={s.iconButton}>
          {loading ? <ActivityIndicator color={green} /> : <AppIcon name="refresh" />}</Pressable> : <View style={s.iconButton} />}
      </View>
      {account.storageError ? <Text style={s.error}>{account.storageError}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {!account.ready ? <View style={s.empty}><ActivityIndicator color={green} /><Text style={s.copy}>正在读取登录信息…</Text></View> : account.recoveryCode ? <RecoveryCodeScreen account={account} /> : screen === 'security' || screen === 'recover' ?
          <AccountSecurityScreen key={screen} account={account} mode={screen} onDone={() => setScreen('home')} onBusy={setBusy} /> : !token ?
          <AuthForm account={account} onRecover={() => { setScreen('recover'); setError(''); }} onBusy={setBusy} /> : screen === 'home' ? (
          <ScrollView contentContainerStyle={s.page} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={green} />}>
            <Text accessibilityRole="header" style={s.title}>你的发现，大家受用</Text>
            <Text style={s.copy}>分享好吃的、一起玩的，或帮忙补充地点和路线。审核通过后会发布给大家。</Text>
            <Text style={s.hint}>当前账号 · {account.session?.user.username}</Text>
            <View style={s.accountRow}><Pressable accessibilityRole="button" disabled={busy} onPress={() => setScreen('security')} style={s.textButton}><Text style={s.linkText}>账号与安全</Text></Pressable><Pressable disabled={busy} onPress={logout} accessibilityRole="button" style={s.textButton}><Text style={s.linkText}>退出登录</Text></Pressable></View>
            {!account.session?.user.hasRecoveryCode ? <Text style={s.note}>这个账号还没有恢复码。到「账号与安全」保存一份，方便找回账号。</Text> : null}
            <Button label="写一条新投稿" busy={busy} onPress={() => void begin()} />
            <Text accessibilityRole="header" style={s.sectionTitle}>我的投稿</Text>
            {!items.length && !loading ? <View style={s.empty}><AppIcon name="book" size={30} /><Text style={s.copy}>还没有投稿。第一个校园发现，从这里开始。</Text></View> : null}
            {items.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.title}，${statuses[item.status]}`} onPress={() => { setSelected(item); setScreen('detail'); setError(''); }} style={s.listRow}>
              <View style={s.listContent}><Text style={s.itemTitle}>{item.title}</Text><Text style={s.hint}>{item.isEdit ? '内容修改申请 · ' : ''}{kinds.find(kind => kind.key === item.kind)?.label} · {dateText(item.createdAt)}</Text></View>
              <Status value={item.status} /><AppIcon name="chevron" size={15} />
            </Pressable>)}
            {nextPage ? <Button label="加载更早的投稿" secondary busy={loading} onPress={() => void load(nextPage)} /> : null}
          </ScrollView>
        ) : screen === 'form' ? (
          <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
            {editing?.reviewNote ? <View style={s.feedback}><Text style={s.label}>管理员建议</Text><Text style={s.copy}>{editing.reviewNote}</Text></View> : null}
            {editing?.status === 'approved' ? <Text style={s.copy}>提交的是一个新版本。审核通过前，大家仍会看到当前已发布的内容。</Text> : null}
            <Text style={s.label}>投稿类型</Text>
            <View style={s.kindGrid}>{kinds.map(kind => <Pressable key={kind.key} disabled={busy || !!(editing && (editing.status === 'approved' || editing.isEdit))} accessibilityRole="radio" accessibilityState={{ checked: draft.kind === kind.key }} onPress={() => update({ kind: kind.key })}
              style={[s.kind, draft.kind === kind.key && s.kindActive]}><AppIcon name={kind.icon} size={19} color={draft.kind === kind.key ? '#fff' : green} /><Text style={[s.kindText, draft.kind === kind.key && s.white]}>{kind.label}</Text></Pressable>)}</View>
            <Field label="标题" value={draft.title} maxLength={160} editable={!busy} onChangeText={title => update({ title })} placeholder="例如：午间饭堂的一份好味道" />
            <Field label={draft.kind === 'place' || draft.kind === 'route' ? '相关地点或路线（必填）' : '相关地点（选填）'} value={draft.location} editable={!busy} maxLength={160} onChangeText={location => update({ location })} placeholder="建筑、楼层、入口或起终点" />
            <Field label="正文" hint="至少 10 个字。写明亲身体验、资料来源或需要修改的地方。" value={draft.body} multiline textAlignVertical="top" editable={!busy} maxLength={8000} onChangeText={body => update({ body })} />
            <Field label={draft.kind === 'group' ? '邀请链接（必填）' : '相关链接（选填）'} value={draft.externalUrl} editable={!busy} maxLength={1000} autoCapitalize="none" autoCorrect={false} keyboardType="url" onChangeText={externalUrl => update({ externalUrl })} placeholder="https://" />
            <Text style={[s.label, { marginTop: 18 }]}>配图（选填）</Text><Text style={s.hint}>一张 JPEG、PNG 或 WebP，最多 5 MB。</Text>
            {image ? <Image source={contributionImageSource(image, draft.image ? undefined : token)} style={s.photo} resizeMode="cover" accessibilityLabel="投稿配图预览" /> : null}
            <View style={s.photoActions}><Pressable accessibilityRole="button" disabled={busy} onPress={() => void pickImage()} style={s.textButton}><Text style={s.linkText}>{image ? '更换图片' : '从相册选择图片'}</Text></Pressable>
              {image ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => update({ image: null, removeImage: true })} style={s.textButton}><Text style={s.removeText}>移除图片</Text></Pressable> : null}</View>
            <Text style={s.note}>投稿和配图经审核后公开，请仅提交可以分享的内容。地点与路线纠错通过后会先作为指南提示发布，地图目前仍为演示。</Text>
            <Button label={editing?.status === 'approved' ? '提交修改申请' : editing ? '重新提交审核' : '提交审核'} busy={busy} onPress={() => void submit()} />
          </ScrollView>
        ) : selected ? (
          <ScrollView contentContainerStyle={s.page} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={green} />}>
            <Status value={selected.status} />
            <Text accessibilityRole="header" style={[s.title, s.detailTitle]}>{selected.title}</Text>
            <Text style={s.hint}>{selected.isEdit ? '内容修改申请 · ' : ''}{kinds.find(kind => kind.key === selected.kind)?.label} · {dateText(selected.createdAt)}</Text>
            <View style={s.feedback}><Text style={s.label}>{selected.status === 'pending' ? '已收到，等待管理员审核' : selected.status === 'approved' ? '审核通过' : '修改后可以重新提交'}</Text>
              <Text style={s.copy}>{selected.reviewNote || (selected.status === 'pending' ? '审核结果会显示在这里，下拉即可刷新。' : '内容已发布到对应的学生指南分类。')}</Text></View>
            {selected.location ? <Text style={s.location}>相关地点或路线：{selected.location}</Text> : null}
            <Text selectable style={s.detailBody}>{selected.body}</Text>
            {selected.imageUrl ? <Image source={contributionImageSource(selected.imageUrl, token)} style={s.photo} resizeMode="cover" accessibilityLabel="投稿配图" /> : null}
            {selected.externalUrl ? <Text selectable style={s.copy}>{selected.externalUrl}</Text> : null}
            {selected.status === 'changes_requested' ? <Button label="按建议修改并重交" onPress={() => void begin(selected)} /> : null}
            {selected.status === 'approved' && selected.publishedContent?.published ? <Button label={selected.openEditId ? '查看当前修改申请' : '申请修改已发布内容'} busy={busy} onPress={() => void begin(selected)} /> : null}
            {selected.status === 'approved' && selected.publishedContent && !selected.publishedContent.published ? <Text style={s.note}>此内容已下线，目前不会显示在公共指南中。</Text> : null}
            <Button label="返回我的投稿" secondary onPress={() => { setScreen('home'); setError(''); void load(); }} />
          </ScrollView>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}

const s = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#f7f8f3' }, flex: { flex: 1 },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 5 },
  iconButton: { width: 48, height: 48, justifyContent: 'center', alignItems: 'center' },
  topTitle: { flex: 1, fontSize: 19, fontWeight: '800', color: '#203a31' },
  page: { width: '100%', maxWidth: 650, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36 },
  title: { fontSize: 28, fontWeight: '800', color: '#203a31', lineHeight: 38 },
  copy: { color: '#526258', fontSize: 14, lineHeight: 24, marginTop: 7, marginBottom: 10 },
  hint: { color: '#526258', fontSize: 12, lineHeight: 20 },
  bigSymbol: { width: 62, height: 62, backgroundColor: '#eaf1e8', borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  field: { marginTop: 18 }, label: { color: '#203a31', fontSize: 14, fontWeight: '700', lineHeight: 23 },
  input: { color: '#203a31', backgroundColor: '#fff', borderWidth: 1, borderColor: '#bccbbd', borderRadius: 10, minHeight: 50, padding: 12, fontSize: 15, marginTop: 7 },
  multiline: { minHeight: 145, lineHeight: 24 },
  button: { minHeight: 50, borderRadius: 11, backgroundColor: green, paddingHorizontal: 15, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, marginTop: 16 },
  secondary: { backgroundColor: '#eaf1e8' }, buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' }, secondaryText: { color: green }, dim: { opacity: 0.55 },
  error: { backgroundColor: '#f8e9e1', color: '#813a28', paddingHorizontal: 18, paddingVertical: 12, fontSize: 13, lineHeight: 22 },
  accountRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginTop: 5 },
  textButton: { minHeight: 48, paddingHorizontal: 6, justifyContent: 'center' }, linkText: { color: green, fontWeight: '700', fontSize: 13 }, removeText: { color: '#813a28', fontSize: 13 },
  sectionTitle: { fontSize: 19, fontWeight: '800', color: '#203a31', marginTop: 30, marginBottom: 12 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 17, borderBottomColor: '#dbe3d9', borderBottomWidth: 1 }, listContent: { flex: 1, gap: 4 },
  itemTitle: { fontSize: 15, fontWeight: '700', color: '#203a31', lineHeight: 24 },
  status: { alignSelf: 'flex-start', color: '#775013', backgroundColor: '#f4ecd6', fontSize: 12, lineHeight: 20, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  approved: { color: green, backgroundColor: '#e3eee3' }, changes: { color: '#813a28', backgroundColor: '#f8e9e1' },
  empty: { paddingVertical: 36, alignItems: 'center', gap: 12 },
  kindGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 9, marginBottom: 5 },
  kind: { minWidth: '46%', flexGrow: 1, minHeight: 50, flexDirection: 'row', gap: 9, justifyContent: 'center', alignItems: 'center', backgroundColor: '#eaf1e8', borderRadius: 10 },
  kindActive: { backgroundColor: green }, kindText: { color: green, fontSize: 14, fontWeight: '700' }, white: { color: '#fff' },
  photo: { width: '100%', height: 200, borderRadius: 12, marginTop: 12, backgroundColor: '#eaf1e8' }, photoActions: { flexDirection: 'row', justifyContent: 'space-between' },
  note: { fontSize: 12, lineHeight: 21, color: '#526258', marginTop: 15 },
  feedback: { backgroundColor: '#eaf1e8', borderRadius: 12, padding: 15, marginTop: 24, marginBottom: 20 },
  detailTitle: { marginTop: 14, marginBottom: 8 }, detailBody: { color: '#203a31', fontSize: 15, lineHeight: 27, marginBottom: 14 },
  location: { color: '#526258', fontSize: 13, lineHeight: 23, marginBottom: 12 },
});
