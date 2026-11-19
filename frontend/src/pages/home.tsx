import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function HomePage() {
  return (
    <section className="max-w-2xl space-y-6 py-12 sm:py-20">
      <p className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Fashion Retail</p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Nền tảng cửa hàng thời trang đa thương hiệu</h1>
      <p className="text-lg leading-relaxed text-muted-foreground">Khung ứng dụng đã sẵn sàng cho các bước phát triển tiếp theo. Các chức năng mua sắm sẽ được triển khai theo đặc tả.</p>
      <Button asChild><Link to="/system">Kiểm tra kết nối API <ArrowRight aria-hidden="true" /></Link></Button>
    </section>
  );
}
