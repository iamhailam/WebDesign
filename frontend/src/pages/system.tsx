import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchHealth } from '@/lib/api';

export function SystemPage() {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth });
  return (
    <section className="max-w-xl space-y-6 py-12" aria-busy={health.isFetching}>
      <h1 className="text-3xl font-semibold tracking-tight">Trạng thái kết nối</h1>
      <div className="rounded-xl border bg-card p-6 text-card-foreground" aria-live="polite">
        {health.isPending && <p>Đang kiểm tra API…</p>}
        {health.isError && <p role="alert">Không thể kết nối API. Vui lòng thử lại.</p>}
        {health.isSuccess && <p>API đang hoạt động.</p>}
      </div>
      <Button variant="outline" disabled={health.isFetching} onClick={() => { void health.refetch(); }}>
        <RefreshCw aria-hidden="true" /> Kiểm tra lại
      </Button>
    </section>
  );
}
