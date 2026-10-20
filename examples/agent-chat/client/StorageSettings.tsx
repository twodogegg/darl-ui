import { useEffect, useState } from 'react';
import { Cloud, HardDrive, ShieldCheck } from 'lucide-react';
import { Button } from '../../../src/components/ui/Button';
import { Field, FieldDescription, FieldLabel, Input, NativeSelect } from '../../../src/components/ui/FormControls';

type StorageConfig = {
  mode: 'local' | 'cos'; root: string; prefix: string; region: string; bucket: string;
  scheme: 'http' | 'https'; publicBaseUrl: string; hasCredentials: boolean;
};
type Form = Omit<StorageConfig, 'hasCredentials'> & { secretId: string; secretKey: string };
const empty: Form = {
  mode: 'local', root: '', prefix: 'darl-ui', region: 'ap-guangzhou', bucket: '',
  scheme: 'https', publicBaseUrl: '', secretId: '', secretKey: '',
};

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/storage${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error?.message || value.error || `请求失败（${response.status}）`);
  return value as T;
}

export function StorageSettings() {
  const [form, setForm] = useState<Form>(empty);
  const [saved, setSaved] = useState<StorageConfig>();
  const [busy, setBusy] = useState<'load' | 'test' | 'save'>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const apply = (value: StorageConfig) => {
    setSaved(value);
    setForm({ ...value, secretId: '', secretKey: '' });
  };
  useEffect(() => {
    let alive = true;
    setBusy('load');
    request<StorageConfig>('').then((value) => { if (alive) apply(value); })
      .catch((reason) => { if (alive) setError(reason.message); })
      .finally(() => { if (alive) setBusy(undefined); });
    return () => { alive = false; };
  }, []);
  const update = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setMessage(''); setError('');
  };
  const run = async (kind: 'test' | 'save') => {
    setBusy(kind); setMessage(''); setError('');
    try {
      await request(kind === 'save' ? '' : '/test', { configuration: form });
      if (kind === 'save') apply(await request<StorageConfig>(''));
      setMessage(kind === 'save'
        ? '存储配置已保存。新上传文件会使用当前后端，历史文件仍按原后端读取。'
        : form.mode === 'local' ? '本地目录可写。' : 'COS 写入与删除探针均成功。');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败'); }
    finally { setBusy(undefined); }
  };
  const hasCosCredentials = form.secretKey ? true : Boolean(saved?.hasCredentials);
  const canTest = form.mode === 'local' || hasCosCredentials && Boolean(form.bucket);

  return <section className="example-storage-settings" aria-labelledby="example-storage-settings-title">
    <header>
      <div>
        <span className="example-eyebrow">FILE STORAGE</span>
        <h2 id="example-storage-settings-title">文件存储</h2>
        <p>本地或腾讯云 COS。配置保存到服务端 SQLite，SecretKey 不会返回浏览器；切换只影响新文件，不迁移历史文件。</p>
      </div>
      <span className="example-storage-security"><ShieldCheck size={15} />密钥仅服务端保存</span>
    </header>
    <div className="example-storage-current">
      <div>{saved?.mode === 'cos' ? <Cloud size={17} /> : <HardDrive size={17} />}<span>当前模式</span><strong>{saved?.mode === 'cos' ? '腾讯云 COS' : '本地磁盘'}</strong></div>
      <div><span>凭证</span><strong>{saved?.hasCredentials ? '已配置' : '未配置'}</strong></div>
      <div><span>目标</span><strong>{saved?.mode === 'cos' ? saved.bucket || '未设置 Bucket' : saved?.root || '未设置目录'}</strong></div>
    </div>
    <form className="example-storage-form" onSubmit={(event) => { event.preventDefault(); void run('save'); }}>
      <Field><FieldLabel htmlFor="storage-mode">存储模式</FieldLabel><NativeSelect id="storage-mode" value={form.mode} onChange={(event) => update('mode', event.target.value as Form['mode'])}><option value="local">本地磁盘</option><option value="cos">腾讯云 COS</option></NativeSelect><FieldDescription>使用 COS 时本地目录仍作为历史本地文件的读取位置。</FieldDescription></Field>
      <Field><FieldLabel htmlFor="storage-root">本地存储目录</FieldLabel><Input id="storage-root" value={form.root} onChange={(event) => update('root', event.target.value)} placeholder="/absolute/path/to/files" /><FieldDescription>必须是绝对路径。</FieldDescription></Field>
      {form.mode === 'cos' && <>
        <div className="example-storage-grid">
          <Field><FieldLabel htmlFor="storage-bucket">Bucket</FieldLabel><Input id="storage-bucket" value={form.bucket} onChange={(event) => update('bucket', event.target.value)} placeholder="example-1250000000" /></Field>
          <Field><FieldLabel htmlFor="storage-region">Region</FieldLabel><Input id="storage-region" value={form.region} onChange={(event) => update('region', event.target.value)} placeholder="ap-guangzhou" /></Field>
        </div>
        <div className="example-storage-grid">
          <Field><FieldLabel htmlFor="storage-secret-id">SecretId</FieldLabel><Input id="storage-secret-id" autoComplete="off" value={form.secretId} onChange={(event) => update('secretId', event.target.value)} placeholder={saved?.hasCredentials ? '已保存，留空保持不变' : 'AKID...'} /></Field>
          <Field><FieldLabel htmlFor="storage-secret-key">SecretKey</FieldLabel><Input id="storage-secret-key" type="password" autoComplete="new-password" value={form.secretKey} onChange={(event) => update('secretKey', event.target.value)} placeholder={hasCosCredentials ? '已配置，留空保持不变' : '输入 SecretKey'} /></Field>
        </div>
        <div className="example-storage-grid">
          <Field><FieldLabel htmlFor="storage-prefix">对象前缀</FieldLabel><Input id="storage-prefix" value={form.prefix} onChange={(event) => update('prefix', event.target.value)} placeholder="darl-ui" /></Field>
          <Field><FieldLabel htmlFor="storage-scheme">访问协议</FieldLabel><NativeSelect id="storage-scheme" value={form.scheme} onChange={(event) => update('scheme', event.target.value as Form['scheme'])}><option value="https">HTTPS</option><option value="http">HTTP</option></NativeSelect></Field>
        </div>
        <Field><FieldLabel htmlFor="storage-public-url">公开访问地址（可选）</FieldLabel><Input id="storage-public-url" value={form.publicBaseUrl} onChange={(event) => update('publicBaseUrl', event.target.value)} placeholder="https://cdn.example.com" /><FieldDescription>填写 CDN 或自定义域名；留空使用 COS 默认域名。Bucket 需允许浏览器 GET/HEAD 跨域，否则缩略图与预览会被 CORS 拦截。</FieldDescription></Field>
        <p className="example-storage-note">保存和测试连接都会真实写入并删除一个临时探针对象。不会上传或迁移现有业务文件。</p>
      </>}
      {message && <p className="example-storage-message" role="status">{message}</p>}
      {error && <p className="example-storage-error" role="alert">{error}</p>}
      <div className="example-storage-actions">
        <Button type="button" variant="outline" disabled={Boolean(busy) || !canTest} onClick={() => void run('test')}>{busy === 'test' ? '正在测试…' : '测试连接'}</Button>
        <Button type="submit" disabled={Boolean(busy) || !canTest}>{busy === 'save' ? '正在保存…' : '保存并切换'}</Button>
      </div>
    </form>
  </section>;
}
