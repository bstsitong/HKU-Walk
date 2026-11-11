import { File } from 'expo-file-system';
import { API_BASE, AuthorProfile, DiscussionComment } from './guideApi';
import { MapDraftData, serializeMapDraft } from './mapSubmission';

export type Account = { token: string; user: { id: string; username: string; hasRecoveryCode?: boolean; nickname?: string; bio?: string; avatarUrl?: string } };
export type AccountResult = Account & { recoveryCode?: string };
export type Kind = 'food' | 'group' | 'place' | 'route' | 'new_place' | 'new_route';
export type Submission = {
  id: string; kind: Kind; title: string; body: string; location: string; externalUrl: string;
  imageUrl: string; status: 'pending' | 'approved' | 'changes_requested'; reviewNote: string;
  revision: number; createdAt: string; updatedAt: string; publicEntryId: string | null;
  isEdit: boolean; openEditId: string | null;
  authorProfile?: AuthorProfile;
  mapData?: MapDraftData;
  publishedContent: { title: string; body: string; location: string; externalUrl: string; imageUrl: string;
    version: string; published: boolean; mapData?: MapDraftData } | null;
};
export type PickedImage = { uri: string; name: string; type: string };
export type ProfileDraft = { nickname: string; bio: string; avatar: PickedImage | null; removeAvatar: boolean };

function appendPhoto(form: FormData, field: string, image: PickedImage) {
  form.append(field, new File(image.uri));
}
export type Draft = {
  kind: Kind; title: string; body: string; location: string; externalUrl: string;
  image: PickedImage | null; existingImage: string; removeImage: boolean; requestKey: string;
  mapData: MapDraftData;
};
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function errorMessage(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(errorMessage).join('\n');
  if (value && typeof value === 'object') {
    const labels: Record<string, string> = { username: '账号', password: '密码', current_password: '当前密码', new_password: '新密码', recovery_code: '恢复码', title: '标题', body: '正文', image: '图片', location: '地点', external_url: '链接', nickname: '昵称', bio: '个人简介', avatar: '头像' };
    return Object.entries(value).map(([key, item]) => `${labels[key] ? labels[key] + '：' : ''}${errorMessage(item)}`).join('\n');
  }
  return '操作暂时未完成，请重试。';
}
async function request<T>(path: string, options: RequestInit = {}, token?: string, timeoutMs = 25000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(API_BASE + path, {
      ...options, signal: controller.signal,
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers },
    });
    if (response.status === 204) return undefined as T;
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(response.status, data ? errorMessage(data) : '服务暂时不可用，请稍后重试。');
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, '暂时连不上服务器，请检查网络后重试。');
  } finally { clearTimeout(timer); }
}
export function authenticate(mode: 'login' | 'register', username: string, password: string) {
  return request<AccountResult>(`/api/accounts/${mode}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
}
export const fetchMe = (token: string) => request<{ user: Account['user'] }>('/api/accounts/me/', {}, token);
export function updateProfile(token: string, draft: ProfileDraft) {
  const form = new FormData();
  form.append('nickname', draft.nickname.trim());
  form.append('bio', draft.bio.trim());
  form.append('remove_avatar', String(draft.removeAvatar));
  if (draft.avatar) appendPhoto(form, 'avatar', draft.avatar);
  return request<{ user: Account['user'] }>('/api/accounts/me/', { method: 'PATCH', body: form }, token, 90000);
}
export const revokeSession = (token: string) => request<void>('/api/accounts/logout/', { method: 'POST' }, token);
function accountPost<T>(path: string, values: Record<string, string>, token?: string) {
  return request<T>(`/api/accounts/${path}/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }, token);
}
export const changeAccountPassword = (token: string, currentPassword: string, newPassword: string) =>
  accountPost<AccountResult>('change-password', { current_password: currentPassword, new_password: newPassword }, token);
export const recoverAccount = (code: string, password: string) =>
  accountPost<AccountResult>('recover', { recovery_code: code, new_password: password });
export const rotateRecoveryCode = (token: string, password: string) =>
  accountPost<{ recoveryCode: string; user: Account['user'] }>('recovery-code', { current_password: password }, token);
export const fetchSubmissions = (token: string, page = 1) => request<{ submissions: Submission[]; count: number; nextPage: number | null }>(`/api/submissions/?page=${page}`, {}, token);
export const fetchSubmission = (token: string, id: string) => request<{ submission: Submission }>(`/api/submissions/${id}/`, {}, token);
export type DiscussionKind = 'guide' | 'place';
const commentPath = (kind: DiscussionKind, id: string) => `/api/${kind === 'guide' ? 'guide/articles' : 'campus/places'}/${encodeURIComponent(id)}/comments/`;
export const fetchComments = (kind: DiscussionKind, id: string, page = 1) =>
  request<{ comments: DiscussionComment[]; count: number; nextPage: number | null }>(`${commentPath(kind, id)}?page=${page}`);
export const sendComment = (token: string, kind: DiscussionKind, id: string, body: string, requestId: string) =>
  request<{ comment: DiscussionComment; commentCount: number }>(commentPath(kind, id), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, request_id: requestId }),
  }, token);
export const setGuideLike = (token: string, id: string, liked: boolean) => request<{ liked: boolean; likeCount: number }>(`/api/guide/articles/${id}/like/`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ liked }),
}, token);
export function contributionImageSource(uri: string, token?: string) {
  // Administrator-supplied external image URLs must never receive the mobile credential.
  try {
    const url = new URL(uri);
    if (token && url.origin === new URL(API_BASE).origin && url.pathname.startsWith('/api/images/')) {
      return { uri, headers: { Authorization: `Bearer ${token}` } };
    }
  } catch { /* A local picker URI needs no authorization header. */ }
  return { uri };
}
export function sendSubmission(token: string, draft: Draft, editing?: Submission) {
  const form = new FormData();
  form.append('kind', draft.kind);
  form.append('title', draft.title.trim());
  form.append('body', draft.body.trim());
  form.append('location', draft.kind === 'new_place' || draft.kind === 'new_route' ? '' : draft.location.trim());
  form.append('external_url', draft.externalUrl.trim());
  form.append('request_key', draft.requestKey);
  if (editing) form.append('revision', String(editing.revision));
  if (editing?.publishedContent) form.append('base_version', editing.publishedContent.version);
  form.append('remove_image', String(draft.removeImage));
  if (draft.image) appendPhoto(form, 'image', draft.image);
  const map = serializeMapDraft(draft.kind, draft.mapData);
  form.append('map_data', JSON.stringify(map.data));
  form.append('inherit_step_images', JSON.stringify(map.inherit));
  form.append('remove_step_images', JSON.stringify(map.removed));
  for (const { index, image } of map.uploads) appendPhoto(form, 'step_image_' + index, image);
  const publishedEdit = editing?.status === 'approved';
  return request<{ submission: Submission }>(editing ? `/api/submissions/${editing.id}/${publishedEdit ? 'edits/' : ''}` : '/api/submissions/', {
    method: editing && !publishedEdit ? 'PATCH' : 'POST', body: form,
  }, token, 90000);
}
