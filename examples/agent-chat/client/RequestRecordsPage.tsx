import { RequestRecords, type RequestRecord, type RequestRecordFilters, type RequestRecordPage, type RequestRecordRetention } from '@darl/ui';

async function request<T>(path: string, signal?: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(`/api/request-records${path}`, { signal, ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : '无法读取请求记录');
  return value as T;
}
const loadRecords = (filters: RequestRecordFilters, signal: AbortSignal) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === '') continue;
    search.set(key, key === 'from' || key === 'to' ? new Date(`${value}T${key === 'from' ? '00:00:00.000' : '23:59:59.999'}`).toISOString() : String(value));
  }
  return request<RequestRecordPage>(`?${search}`, signal);
};
const loadRecord = (id: string, signal: AbortSignal) => request<RequestRecord>(`/${encodeURIComponent(id)}`, signal);
const loadRetention = (signal: AbortSignal) => request<RequestRecordRetention>('/retention', signal);
const saveRetention = (value: RequestRecordRetention) => request<RequestRecordRetention>('/retention', undefined, value);

export function RequestRecordsPage({ onOpenSession, onOpenTask }: { onOpenSession: (id: string) => void; onOpenTask: (id: string) => void }) {
  return <RequestRecords loadRecords={loadRecords} loadRecord={loadRecord} loadRetention={loadRetention} saveRetention={saveRetention} onOpenSession={onOpenSession} onOpenTask={onOpenTask} />;
}
