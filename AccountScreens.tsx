import { useState } from 'react';
import { t } from './localization';
import { Keyboard, ScrollView, StyleSheet, View } from 'react-native';
import { Alert, Text } from './ui';
import { ApiError } from './communityApi';
import { Button, Field } from './CommunityUI';
import useAccount from './useAccount';

type Account = ReturnType<typeof useAccount>;
export function RecoveryCodeScreen({ account }: { account: Account }) {
  const dismiss = () => Alert.alert('已保存这份恢复码？', '离开后无法再次查看。你仍可在账号与安全中验证密码并生成新的恢复码。', [
    { text: '继续查看', style: 'cancel' }, { text: '已保存，继续', onPress: account.dismissRecoveryCode },
  ]);
  return <ScrollView contentContainerStyle={s.page}>
    <Text accessibilityRole="header" style={s.title}>保存你的恢复码</Text>
    <Text style={s.copy}>忘记账号或密码时，用它找回账号并设置新密码。它只在这里显示这一次，请复制到你自己的安全位置。</Text>
    <View style={s.codeBox}><Text raw selectable accessibilityLabel="账号恢复码" style={s.code}>{account.recoveryCode}</Text></View>
    <Text style={s.copy}>当前账号：{account.session?.user.username}</Text>
    <Text style={s.copy}>恢复码可以用来重设密码，请妥善保管。生成新码后，旧码立即失效。</Text>
    <Button label="我已保存，继续" onPress={dismiss} />
  </ScrollView>;
}

export function AccountSecurityScreen({ account, mode, onDone, onBusy }: {
  account: Account; mode: 'security' | 'recover'; onDone: () => void; onBusy: (value: boolean) => void;
}) {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (operation: () => Promise<void>, success?: string) => {
    Keyboard.dismiss(); setError(''); setBusy(true); onBusy(true);
    try { await operation(); setCurrent(''); setPassword(''); setConfirm(''); setCode(''); if (success) Alert.alert(success); onDone(); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) await account.expire();
      setError(error instanceof Error ? error.message : '操作未完成，请重试。');
    } finally { setBusy(false); onBusy(false); }
  };
  const savePassword = () => {
    if (password.length < 8) { setError('新密码至少 8 位。'); return; }
    if (password !== confirm) { setError('两次输入的新密码不一致。'); return; }
    if (mode === 'recover') {
      if (!code.trim()) { setError('请输入之前保存的恢复码。'); return; }
      void run(() => account.recover(code, password));
    } else {
      if (!current) { setError('请输入当前密码。'); return; }
      void run(() => account.changePassword(current, password), '密码修改成功，其他设备已退出登录。');
    }
  };
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.page}>
    <Text accessibilityRole="header" style={s.title}>{mode === 'recover' ? '找回账号与密码' : '账号与安全'}</Text>
    <Text style={s.copy}>{mode === 'recover' ? '输入保存的恢复码并设置新密码。成功后会显示账号名称，并生成一份新的恢复码。' : t('当前账号：{username}', { username: account.session?.user.username ?? '' })}</Text>
    {mode === 'recover' ? <Field label="恢复码" value={code} onChangeText={setCode} editable={!busy} autoCapitalize="characters" autoCorrect={false} maxLength={100} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" /> :
      <Field label="当前密码" value={current} onChangeText={setCurrent} editable={!busy} secureTextEntry autoCapitalize="none" maxLength={128} textContentType="password" />}
    <Field label="新密码" hint="至少 8 位，避免常见密码或纯数字" value={password} onChangeText={setPassword} editable={!busy} secureTextEntry autoCapitalize="none" maxLength={128} textContentType="newPassword" />
    <Field label="再次输入新密码" value={confirm} onChangeText={setConfirm} editable={!busy} secureTextEntry autoCapitalize="none" maxLength={128} />
    {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
    <Button label={mode === 'recover' ? '找回账号并重设密码' : '修改密码'} busy={busy} onPress={savePassword} />
    {mode === 'security' ? <View style={s.recoverySection}>
      <Text style={s.subtitle}>恢复码</Text>
      <Text style={s.copy}>{account.session?.user.hasRecoveryCode ? '需要更换恢复码时，输入上方的当前密码，再生成新码。旧码随后失效。' : '这个账号还没有恢复码。输入上方的当前密码后生成一份，便于之后找回账号。'}</Text>
      <Button label={account.session?.user.hasRecoveryCode ? '生成新的恢复码' : '生成恢复码'} secondary busy={busy}
        onPress={() => { if (!current) { setError('请先在上方输入当前密码。'); return; } void run(() => account.regenerateRecoveryCode(current)); }} />
    </View> : <Text style={s.note}>没有保存恢复码且无法登录时，请联系项目管理员核实账号。管理员不能查看原密码。</Text>}
  </ScrollView>;
}
const s = StyleSheet.create({
  page: { width: '100%', maxWidth: 650, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 36 },
  title: { fontSize: 24, fontWeight: '800', color: '#203a31', lineHeight: 33 },
  subtitle: { fontSize: 19, fontWeight: '800', color: '#203a31', marginBottom: 6 },
  copy: { color: '#637169', fontSize: 14, lineHeight: 24, marginTop: 9, marginBottom: 10 },
  codeBox: { backgroundColor: '#eaf1e8', padding: 20, borderRadius: 12, marginVertical: 18 },
  code: { color: '#184d3e', fontSize: 22, fontWeight: '700', lineHeight: 36 },
  recoverySection: { borderTopWidth: 1, borderTopColor: '#e6eae2', marginTop: 30, paddingTop: 24 },
  error: { color: '#813a28', fontSize: 13, lineHeight: 22, backgroundColor: '#f8e9e1', padding: 12, marginTop: 16 },
  note: { color: '#637169', fontSize: 12, lineHeight: 21, marginTop: 22 },
});
