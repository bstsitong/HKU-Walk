import { useEffect, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Account, AccountResult, ApiError, PickedImage, ProfileDraft, authenticate, changeAccountPassword, fetchMe, recoverAccount, revokeSession, rotateRecoveryCode, updateProfile, updateProfileCover } from './communityApi';

const storageKey = 'hku-walk.account.v1';
export default function useAccount() {
  const [session, setSession] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const current = useRef<Account | null>(null);
  const profileUpdates = useRef(Promise.resolve());
  const persist = async (value: Account | null) => {
    if (value) await SecureStore.setItemAsync(storageKey, JSON.stringify({ token: value.token, user: value.user }));
    else await SecureStore.deleteItemAsync(storageKey);
    current.current = value; setSession(value); setStorageError('');
  };
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(storageKey);
        if (!active || !raw) return;
        const value = JSON.parse(raw) as Account;
        if (typeof value.token !== 'string' || value.token.length !== 64 || !value.user?.username) {
          await SecureStore.deleteItemAsync(storageKey); return;
        }
        try { value.user = (await fetchMe(value.token)).user; }
        catch (error) {
          if (error instanceof ApiError && error.status === 401) { await SecureStore.deleteItemAsync(storageKey); return; }
          // An unavailable network should not erase a valid saved session.
        }
        if (active) { current.current = value; setSession(value); }
      } catch { if (active) setStorageError('登录信息暂时无法读取，请重新打开 App。'); }
      finally { if (active) setReady(true); }
    })();
    return () => { active = false; };
  }, []);
  const accept = async (value: AccountResult) => {
    try { await persist({ token: value.token, user: value.user }); }
    catch { await revokeSession(value.token).catch(() => {}); throw new Error('无法安全保存登录信息，请检查设备后重试。'); }
    setRecoveryCode(value.recoveryCode || '');
  };
  const saveProfileUpdate = (save: (token: string) => Promise<Partial<Account['user']>>) => {
    const token = current.current?.token;
    if (!token) return Promise.reject(new ApiError(401, '请先登录。'));
    const update = profileUpdates.current.then(async () => {
      if (current.current?.token !== token) return;
      const patch = await save(token);
      const active = current.current;
      if (active?.token !== token) return;
      const updated = { token, user: { ...active.user, ...patch } };
      try { await persist(updated); }
      catch { current.current = updated; setSession(updated); }
    });
    profileUpdates.current = update.catch(() => {});
    return update;
  };
  return {
    session, ready, storageError, recoveryCode,
    dismissRecoveryCode: () => setRecoveryCode(''),
    async signIn(mode: 'login' | 'register', username: string, password: string) {
      const value = await authenticate(mode, username, password);
      await accept(value);
    },
    saveProfile: (draft: ProfileDraft) => saveProfileUpdate(async token => (await updateProfile(token, draft)).user),
    saveCover: (image: PickedImage | null) => saveProfileUpdate(token => updateProfileCover(token, image)),
    async changePassword(currentPassword: string, newPassword: string) {
      if (!current.current) throw new Error('请先登录。');
      const result = await changeAccountPassword(current.current.token, currentPassword, newPassword);
      try { await accept(result); }
      catch (error) { current.current = null; setSession(null); await SecureStore.deleteItemAsync(storageKey).catch(() => {}); throw error; }
    },
    async recover(code: string, password: string) { await accept(await recoverAccount(code, password)); },
    async regenerateRecoveryCode(password: string) {
      if (!current.current) throw new Error('请先登录。');
      const result = await rotateRecoveryCode(current.current.token, password);
      await persist({ token: current.current.token, user: result.user });
      setRecoveryCode(result.recoveryCode);
    },
    async expire() {
      current.current = null; setSession(null);
      setRecoveryCode('');
      await SecureStore.deleteItemAsync(storageKey).catch(() => setStorageError('请重新打开 App 后再登录。'));
    },
    async signOut() {
      if (current.current) {
        try { await revokeSession(current.current.token); }
        catch (error) { if (!(error instanceof ApiError && error.status === 401)) throw error; }
      }
      await persist(null);
      setRecoveryCode('');
    },
  };
}
