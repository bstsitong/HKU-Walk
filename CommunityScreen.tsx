import { formatDate, t } from './localization';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View,
} from 'react-native';
import { Alert, Pressable, Text } from './ui';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import AppIcon, { IconName } from './AppIcon';
import { AppModal } from './Assistant';
import { accountAuthor, AuthorByline } from './AuthorIdentity';
import { ApiError, deleteGuideArticle, Draft, fetchSubmission, fetchSubmissions, Kind, PickedImage, sendSubmission, Submission } from './communityApi';
import useAccount from './useAccount';
import { Button, confirmPostRemoval, Field } from './CommunityUI';
import { AccountSecurityScreen, RecoveryCodeScreen } from './AccountScreens';
import MapSubmissionFields, { SubmittedMapData } from './MapSubmissionFields';
import { editMapDraft, emptyMapDraft, hasMapInput, validateMapDraft } from './mapSubmission';
import BodyEditor, { SubmissionBody } from './SubmissionBody';
import SubmissionPhoto from './SubmissionPhoto';
import { editBodyBlocks, newBodyBlock, serializeBodyBlocks } from './submissionBlocks';

const green = '#184d3e';
const kinds: { key: Kind; label: string; icon: IconName }[] = [
  { key: 'new_place', label: '新地点', icon: 'pin' },
  { key: 'place', label: '地点纠错', icon: 'map' },
  { key: 'new_route', label: '新线路', icon: 'walk' },
  { key: 'route', label: '线路纠错', icon: 'swap' },
  { key: 'guide', label: '学生指南', icon: 'book' },
];
const kindLabel = (kind: Kind) => kinds.find(item => item.key === kind)?.label ?? '学生指南';
const hasRichBody = (kind: Kind) => kind !== 'new_place' && kind !== 'new_route';
const statuses = { pending: '待审核', approved: '已通过', changes_requested: '需修改' };
const newDraft = (kind: Kind = 'guide'): Draft => ({ kind, title: '', body: '', location: '', externalUrl: '', image: null,
  existingImage: '', removeImage: false, mapData: emptyMapDraft(kind), bodyBlocks: hasRichBody(kind) ? [newBodyBlock()] : [],
  requestKey: `${Date.now()}_${Math.random().toString(36).slice(2, 12)}` });
const message = (error: unknown) => error instanceof Error ? error.message : '操作暂时未完成，请重试。';
const dateText = formatDate;

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
    <Text accessibilityRole="header" style={s.title}>{mode === 'register' ? '注册' : '登录'}</Text>
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

export default function CommunityScreen({ visible, initialScreen, initialSubmission, onClose, account }: {
  visible: boolean; initialScreen: 'home' | 'security' | 'login' | 'form'; initialSubmission?: Submission; onClose: () => void; account: ReturnType<typeof useAccount>;
}) {
  const [screen, setScreen] = useState<'home' | 'choose' | 'form' | 'detail' | 'security' | 'recover'>('home');
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
    setDraft(newDraft()); setScreen(initialScreen === 'form' ? 'choose' : 'home'); setError(''); setLoading(false);
  }, [token]);
  useEffect(() => {
    if (visible) {
      setSelected(initialSubmission ?? null);
      setScreen(initialSubmission ? 'detail' : initialScreen === 'form' ? 'choose' : initialScreen === 'login' ? 'home' : initialScreen);
      if (initialScreen === 'form') { setDraft(newDraft()); setEditing(undefined); }
      setError('');
    }
  }, [visible, initialScreen, initialSubmission]);
  useEffect(() => { if (visible && token && initialScreen !== 'login') void load(); return () => { generation.current++; }; }, [visible, token, initialScreen]);
  useEffect(() => {
    if (visible && initialScreen === 'login' && token && !busy && !account.recoveryCode) onClose();
  }, [visible, initialScreen, token, busy, account.recoveryCode, onClose]);
  const leave = () => {
    if (busy) return;
    Keyboard.dismiss();
    if (account.recoveryCode) {
      Alert.alert('已保存恢复码？', '离开后无法再次查看，请先保存到自己的安全位置。', [
        { text: '继续查看', style: 'cancel' }, { text: '已保存，返回', onPress: account.dismissRecoveryCode },
      ]); return;
    }
    if (screen === 'form') {
      const discard = () => {
        setDraft(newDraft()); setEditing(undefined); setError(''); setScreen(editing ? 'detail' : 'choose');
      };
      if (draft.title || draft.body || draft.location || draft.externalUrl || draft.image || editing ||
          draft.bodyBlocks.some(block => block.text || block.image) || hasMapInput(draft.mapData)) Alert.alert('放弃这次编辑？', '未提交的修改不会保存。', [{ text: '继续编辑', style: 'cancel' }, { text: '放弃编辑', style: 'destructive', onPress: discard }]);
      else discard();
    } else if (screen === 'choose' && initialScreen !== 'form') {
      setScreen('home'); setError('');
    } else if ((screen === 'security' && initialScreen === 'security') || (screen === 'detail' && (initialSubmission || initialScreen === 'form'))) onClose();
    else if (screen === 'detail' || screen === 'security' || screen === 'recover') { setScreen('home'); setError(''); }
    else onClose();
  };
  const begin = async (item?: Submission) => {
    if (!item) { setError(''); setScreen('choose'); return; }
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
    if (!content) return;
    setDraft({ ...newDraft(item.kind), title: content.title, body: content.body,
      location: content.location, externalUrl: content.externalUrl, existingImage: content.imageUrl, mapData: editMapDraft(content.mapData),
      bodyBlocks: hasRichBody(item.kind) ? editBodyBlocks(content.bodyBlocks, content.body) : [] });
    setScreen('form');
  };
  const update = (patch: Partial<Draft>) => setDraft(current => ({ ...current, ...patch }));
  const chooseKind = (kind: Kind) => { setDraft(newDraft(kind)); setError(''); setScreen('form'); };
  const selectPhoto = async (): Promise<PickedImage | null> => {
    setError('');
    Keyboard.dismiss(); setBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
      if (result.canceled || !result.assets[0]) return null;
      const asset = result.assets[0];
      if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) { setError('图片需小于 5 MB，请选择较小的图片。'); return null; }
      return { uri: asset.uri, name: asset.fileName || 'photo.jpg', type: asset.mimeType || 'image/jpeg' };
    } catch { setError('暂时无法选择图片，请重试。'); return null; }
    finally { setBusy(false); }
  };
  const pickImage = async (stepIndex?: number) => {
    const picked = await selectPhoto();
    if (!picked) return;
    if (stepIndex === undefined) update({ image: picked, removeImage: false });
    else setDraft(current => ({ ...current, mapData: { ...current.mapData, steps: current.mapData.steps?.map((step,index) => index === stepIndex ? { ...step, image: picked, removeImage: false } : step) } }));
  };
  const submit = async () => {
    if (!token || busy) return;
    Keyboard.dismiss(); setError('');
    if (!draft.title.trim()) { setError('请填写标题或名称。'); return; }
    if (draft.kind === 'new_place' && draft.body.trim().length < 10) { setError('请填写地点名称，地点介绍至少 10 个字。'); return; }
    if (draft.kind === 'new_route' && draft.title.trim().length < 3) { setError('路线名称至少 3 个字。'); return; }
    if (hasRichBody(draft.kind)) {
      const { data } = serializeBodyBlocks(draft.bodyBlocks);
      if (!data.length) { setError('请填写正文。'); return; }
      if (data.reduce((length, block) => length + block.text.length, 0) > 8000) { setError('正文最多 8000 字。'); return; }
    }
    const mapError = validateMapDraft(draft.kind,draft.mapData);
    if (mapError) { setError(mapError); return; }
    if (draft.externalUrl && !/^https?:\/\//i.test(draft.externalUrl.trim())) { setError('链接需要以 http:// 或 https:// 开头。'); return; }
    setBusy(true);
    try {
      const result = await sendSubmission(token, draft, editing);
      setSelected(result.submission); setDraft(newDraft()); setEditing(undefined); setScreen('detail');
      setItems(old => [result.submission, ...old.filter(item => item.id !== result.submission.id)]);
    } catch (error) { await handleError(error); }
    finally { setBusy(false); }
  };
  const removePublished = async (id: string) => {
    if (!token || busy) return;
    setBusy(true);
    setError('');
    try { await deleteGuideArticle(token, id); onClose(); }
    catch (error) { await handleError(error); }
    finally { setBusy(false); }
  };
  const logout = () => Alert.alert('退出当前账号？', undefined, [
    { text: '取消', style: 'cancel' }, { text: '退出登录', onPress: () => { setBusy(true); void account.signOut().then(onClose).catch(handleError).finally(() => setBusy(false)); } },
  ]);
  const image = draft.image?.uri || (!draft.removeImage ? draft.existingImage : '');
  const isMapDraft = !hasRichBody(draft.kind);
  return <AppModal visible={visible} animationType="slide" onRequestClose={leave} presentationStyle="fullScreen">
    <SafeAreaProvider>
    <SafeAreaView style={s.shell}>
      <View style={s.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel={screen === 'home' || initialScreen === 'security' || initialScreen === 'form' ? '返回 App' : '返回我的投稿'} disabled={busy} onPress={leave} style={s.iconButton}><AppIcon name="back" /></Pressable>
        <Text accessibilityRole="header" style={s.topTitle}>{account.recoveryCode ? '保存恢复码' : screen === 'recover' ? '找回账号' : !token ? '登录或注册' : screen === 'security' ? '账号与安全' : screen === 'choose' ? '新投稿' : screen === 'form' ? (editing?.status === 'approved' ? '申请修改已发布内容' : editing ? '修改投稿' : kindLabel(draft.kind)) : screen === 'detail' ? '投稿详情' : '校园共建'}</Text>
        {token && initialScreen !== 'login' && (screen === 'home' || screen === 'detail') && !account.recoveryCode ? <Pressable accessibilityRole="button" accessibilityLabel="刷新投稿状态" disabled={loading || busy} onPress={() => void load()} style={s.iconButton}>
          {loading ? <ActivityIndicator color={green} /> : <AppIcon name="refresh" />}</Pressable> : <View style={s.iconButton} />}
      </View>
      {account.storageError ? <Text style={s.error}>{account.storageError}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {!account.ready ? <View style={s.empty}><ActivityIndicator color={green} /><Text style={s.copy}>正在读取登录信息…</Text></View> : account.recoveryCode ? <RecoveryCodeScreen account={account} /> : screen === 'security' || screen === 'recover' ?
          <AccountSecurityScreen key={screen} account={account} mode={screen} onDone={() => setScreen('home')} onBusy={setBusy} onSignOut={screen === 'security' ? logout : undefined} /> : !token ?
          <AuthForm account={account} onRecover={() => { setScreen('recover'); setError(''); }} onBusy={setBusy} /> : screen === 'home' ? (
          <ScrollView contentContainerStyle={s.page} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={green} />}>
            <Text accessibilityRole="header" style={s.title}>你的发现，大家受用</Text>
            <Text style={s.hint}>当前账号 · {account.session?.user.username}</Text>
            <View style={s.accountRow}><Pressable accessibilityRole="button" disabled={busy} onPress={() => setScreen('security')} style={s.textButton}><Text style={s.linkText}>账号与安全</Text></Pressable><Pressable disabled={busy} onPress={logout} accessibilityRole="button" style={s.textButton}><Text style={s.linkText}>退出登录</Text></Pressable></View>
            {!account.session?.user.hasRecoveryCode ? <Text style={s.note}>这个账号还没有恢复码。到「账号与安全」保存一份，方便找回账号。</Text> : null}
            <Button label="写一条新投稿" busy={busy} onPress={() => void begin()} />
            <Text accessibilityRole="header" style={s.sectionTitle}>我的投稿</Text>
            {!items.length && !loading ? <View style={s.empty}><AppIcon name="book" size={30} /><Text style={s.copy}>还没有投稿。第一个校园发现，从这里开始。</Text></View> : null}
            {items.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={t('{title}，{status}', { title: item.title, status: t(statuses[item.status]) })} onPress={() => { setSelected(item); setScreen('detail'); setError(''); }} style={s.listRow}>
              <View style={s.listContent}><Text raw style={s.itemTitle}>{item.title}</Text><Text style={s.hint}>{item.isEdit ? '内容修改申请 · ' : ''}{kindLabel(item.kind)} · {dateText(item.createdAt)}</Text></View>
              <Status value={item.status} /><AppIcon name="chevron" size={15} />
            </Pressable>)}
            {nextPage ? <Button label="加载更早的投稿" secondary busy={loading} onPress={() => void load(nextPage)} /> : null}
          </ScrollView>
        ) : screen === 'choose' ? (
          <ScrollView key="submission-types" contentContainerStyle={s.page}>
            <Text accessibilityRole="header" style={s.chooserTitle}>选择投稿类型</Text>
            {kinds.map(kind => <Pressable key={kind.key} testID={`submission-kind-${kind.key}`} accessibilityRole="button"
              onPress={() => chooseKind(kind.key)} style={({ pressed }) => [s.kindRow, pressed && s.kindPressed]}>
              <View style={s.kindIcon}><AppIcon name={kind.icon} size={22} /></View>
              <Text style={[s.flex, s.itemTitle]}>{kind.label}</Text>
              <AppIcon name="chevron" size={17} />
            </Pressable>)}
          </ScrollView>
        ) : screen === 'form' ? (
          <ScrollView key="submission-form" contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
            {account.session ? <AuthorByline author={accountAuthor(account.session.user)} /> : null}
            {editing?.reviewNote ? <View style={s.feedback}><Text style={s.label}>管理员建议</Text><Text raw style={s.copy}>{editing.reviewNote}</Text></View> : null}
            {editing?.status === 'approved' ? <Text style={s.copy}>提交的是一个新版本。审核通过前，大家仍会看到当前已发布的内容。</Text> : null}
            <Field testID="submission-title" label={draft.kind === 'new_place' ? '地点中文名称' : draft.kind === 'new_route' ? '路线名称' : '标题'}
              value={draft.title} maxLength={160} editable={!busy} onChangeText={title => update({ title })} />
            <MapSubmissionFields kind={draft.kind} data={draft.mapData} onChange={mapData => update({ mapData })} disabled={busy}
              onPickStep={index => void pickImage(index)} token={token} />
            {isMapDraft ? <Field label={draft.kind === 'new_place' ? '地点介绍' : '路线简介（选填）'}
              hint={draft.kind === 'new_place' ? '至少 10 个字。' : undefined} value={draft.body} multiline textAlignVertical="top"
              editable={!busy} maxLength={8000} onChangeText={body => update({ body })} /> :
              <BodyEditor title={draft.title} blocks={draft.bodyBlocks} token={token} disabled={busy}
                onChange={bodyBlocks => update({ bodyBlocks })} onPickImage={selectPhoto} />}
            {editing?.externalUrl || editing?.publishedContent?.externalUrl ?
              <Field label="相关链接（选填）" value={draft.externalUrl} editable={!busy} maxLength={1000} autoCapitalize="none" autoCorrect={false} keyboardType="url" onChangeText={externalUrl => update({ externalUrl })} placeholder="https://" /> : null}
            {draft.kind === 'new_place' || draft.existingImage ? <>
            <Text style={[s.label, { marginTop: 18 }]}>{draft.kind === 'new_place' ? '地点照片（选填）' : '封面配图（选填）'}</Text>
            {draft.kind !== 'new_place' ? <Text style={s.hint}>一张 JPEG、PNG 或 WebP，最多 5 MB。</Text> : null}
            {image ? <SubmissionPhoto uri={image} token={draft.image ? undefined : token} style={s.photo} resizeMode="cover" accessibilityLabel="投稿配图预览" /> : null}
            <View style={s.photoActions}><Pressable testID="submission-photo-picker" accessibilityRole="button" disabled={busy}
              onPress={() => void pickImage()} style={({ pressed }) => [
                s.textButton, draft.kind === 'new_place' && s.photoPicker, pressed && s.dim,
              ]}>
              {draft.kind === 'new_place' ? <AppIcon name="photo" size={18} /> : null}
              <Text style={s.linkText}>{image ? '更换图片' : '从相册选择图片'}</Text>
            </Pressable>
              {image ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => update({ image: null, removeImage: true })} style={s.textButton}><Text style={s.removeText}>移除图片</Text></Pressable> : null}</View>
            {draft.kind === 'new_place' ? <Text style={s.hint}>一张 JPEG、PNG 或 WebP，最多 5 MB。</Text> : null}
            </> : null}
            <Button label={editing?.status === 'approved' ? '提交修改申请' : editing ? '重新提交审核' : '提交审核'} busy={busy} onPress={() => void submit()} />
          </ScrollView>
        ) : selected ? (
          <ScrollView contentContainerStyle={s.page} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={green} />}>
            <Status value={selected.status} />
            <Text raw accessibilityRole="header" style={[s.title, s.detailTitle]}>{selected.title}</Text>
            {selected.authorProfile ? <AuthorByline author={selected.authorProfile} /> : null}
            <Text style={s.hint}>{selected.isEdit ? '内容修改申请 · ' : ''}{kindLabel(selected.kind)} · {dateText(selected.createdAt)}</Text>
            <View style={s.feedback}><Text style={s.label}>{selected.status === 'pending' ? '已收到，等待管理员审核' : selected.status === 'approved' ? '审核通过' : '修改后可以重新提交'}</Text>
              <Text style={s.copy}>{selected.reviewNote ? <Text raw>{selected.reviewNote}</Text> : (selected.status === 'pending' ? '审核结果会显示在这里，下拉即可刷新。' : selected.kind === 'new_place' || selected.kind === 'new_route' ? '内容已发布到地图或路线列表，也可在学生指南查看。' : '内容已发布到对应的学生指南分类。')}</Text></View>
            {selected.location ? <Text style={s.location}>相关地点或路线：<Text raw>{selected.location}</Text></Text> : null}
            {selected.bodyBlocks?.length ? <SubmissionBody blocks={selected.bodyBlocks} token={token} /> :
              selected.body ? <Text raw selectable style={s.detailBody}>{selected.body}</Text> : null}
            <SubmittedMapData data={selected.mapData} token={token} />
            {selected.imageUrl ? <SubmissionPhoto uri={selected.imageUrl} token={token} style={s.photo} resizeMode="cover" accessibilityLabel="投稿配图" /> : null}
            {selected.externalUrl ? <Text raw selectable style={s.copy}>{selected.externalUrl}</Text> : null}
            {selected.status === 'changes_requested' ? <Button label="按建议修改并重交" onPress={() => void begin(selected)} /> : null}
            {selected.status === 'approved' && selected.publishedContent?.published ? <Button label={selected.openEditId ? '查看当前修改申请' : '申请修改已发布内容'} busy={busy} onPress={() => void begin(selected)} /> : null}
            {selected.status === 'approved' && selected.publishedContent && !selected.publishedContent.published ? <Text style={s.note}>此内容已下线，目前不会显示在公共指南中。</Text> : null}
            {selected.status === 'approved' && selected.publicEntryId && selected.publishedContent?.canDeletePost ?
              <Pressable testID="submission-delete-post" accessibilityRole="button" disabled={busy} style={s.textButton}
                onPress={() => confirmPostRemoval(() => void removePublished(selected.publicEntryId!))}>
                <Text style={s.removeText}>删除帖子</Text>
              </Pressable> : null}
            <Button label="返回我的投稿" secondary onPress={() => { if (initialSubmission) onClose(); else { setScreen('home'); setError(''); void load(); } }} />
          </ScrollView>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
    </SafeAreaProvider>
  </AppModal>;
}

const s = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#fbfcf8' }, flex: { flex: 1 },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 5 },
  iconButton: { width: 48, height: 48, justifyContent: 'center', alignItems: 'center' },
  topTitle: { flex: 1, fontSize: 19, fontWeight: '800', color: '#203a31' },
  page: { width: '100%', maxWidth: 650, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36 },
  title: { fontSize: 24, fontWeight: '800', color: '#203a31', lineHeight: 33 },
  copy: { color: '#637169', fontSize: 14, lineHeight: 24, marginTop: 7, marginBottom: 10 },
  hint: { color: '#637169', fontSize: 12, lineHeight: 20 },
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
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 17, borderBottomColor: '#e6eae2', borderBottomWidth: 1 }, listContent: { flex: 1, gap: 4 },
  itemTitle: { fontSize: 15, fontWeight: '700', color: '#203a31', lineHeight: 24 },
  status: { alignSelf: 'flex-start', color: '#775013', backgroundColor: '#f4ecd6', fontSize: 12, lineHeight: 20, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  approved: { color: green, backgroundColor: '#e3eee3' }, changes: { color: '#813a28', backgroundColor: '#f8e9e1' },
  empty: { paddingVertical: 36, alignItems: 'center', gap: 12 },
  chooserTitle: { fontSize: 20, fontWeight: '700', lineHeight: 28, color: '#203a31', marginBottom: 10 },
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e6eae2' },
  kindPressed: { backgroundColor: '#eaf1e8' },
  kindIcon: { width: 42, height: 42, borderRadius: 9, backgroundColor: '#eaf1e8', alignItems: 'center', justifyContent: 'center' },
  photo: { width: '100%', height: 200, borderRadius: 12, marginTop: 12, backgroundColor: '#eaf1e8' },
  photoActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: 8 },
  photoPicker: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, marginVertical: 8, borderWidth: 1, borderColor: green, borderRadius: 9, backgroundColor: '#eaf1e8' },
  note: { fontSize: 12, lineHeight: 21, color: '#637169', marginTop: 15 },
  feedback: { backgroundColor: '#eaf1e8', borderRadius: 12, padding: 15, marginTop: 24, marginBottom: 20 },
  detailTitle: { marginTop: 14, marginBottom: 8 }, detailBody: { color: '#203a31', fontSize: 15, lineHeight: 27, marginBottom: 14 },
  location: { color: '#637169', fontSize: 13, lineHeight: 23, marginBottom: 12 },
});
