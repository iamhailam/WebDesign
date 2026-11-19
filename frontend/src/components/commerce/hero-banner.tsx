import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface BannerItem {
  id: number;
  title: string;
  desktop_path: string;
  mobile_path?: string | null | undefined;
  alt_text: string;
  placement: 'HERO' | 'PROMO';
  target_type: 'NONE' | 'PRODUCT' | 'CATEGORY' | 'BRAND';
  target_path?: string | null | undefined;
}

export interface HeroBannerProps {
  banner?: BannerItem | undefined;
  banners?: readonly BannerItem[] | undefined;
  className?: string | undefined;
}

export function HeroBanner({ banner, banners, className }: HeroBannerProps) {
  const list = banners && banners.length > 0 ? banners : banner ? [banner] : [];
  const [activeIndex, setActiveIndex] = useState(0);
  const [failedIds, setFailedIds] = useState<Record<number, boolean>>({});

  if (list.length === 0) return null;

  const safeIndex = activeIndex % list.length;
  const current = list[safeIndex]!;
  const hasFailedImage = Boolean(failedIds[current.id]);

  return (
    <section
      data-slot="hero-banner"
      aria-label={current.title}
      className={cn(
        'relative overflow-hidden rounded-lg border border-border bg-neutral-900 text-white',
        className,
      )}
    >
      <div className="relative aspect-[16/9] max-h-[420px] w-full overflow-hidden sm:aspect-[21/9]">
        {!hasFailedImage ? (
          <picture>
            {current.mobile_path ? <source media="(max-width: 767px)" srcSet={current.mobile_path} /> : null}
            <img
              src={current.desktop_path}
              alt={current.alt_text}
              onError={() => setFailedIds((prev) => ({ ...prev, [current.id]: true }))}
              className="h-full w-full object-cover"
            />
          </picture>
        ) : (
          <div className="flex h-full w-full items-center bg-gradient-to-br from-neutral-900 via-neutral-800 to-brand-red/85 px-6 sm:px-12">
            <span className="sr-only">{current.alt_text}</span>
          </div>
        )}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/15"
        />
      </div>

      <div className="relative z-10 flex flex-col justify-between gap-3 p-5 sm:absolute sm:inset-0 sm:flex-row sm:items-end sm:p-8">
        <div className="max-w-xl space-y-1.5">
          <span className="inline-block rounded-sm bg-brand-red px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-white">
            Bộ sưu tập nổi bật
          </span>
          <h2 className="text-xl font-bold tracking-tight sm:text-3xl">{current.title}</h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {list.length > 1 ? (
            <div className="flex items-center gap-1.5" role="group" aria-label="Điều hướng banner">
              <Button
                variant="outline"
                size="icon"
                aria-label="Banner trước"
                onClick={() => setActiveIndex((safeIndex - 1 + list.length) % list.length)}
                className="border-white/30 bg-black/40 text-white hover:bg-black/60 hover:text-white"
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Banner tiếp theo"
                onClick={() => setActiveIndex((safeIndex + 1) % list.length)}
                className="border-white/30 bg-black/40 text-white hover:bg-black/60 hover:text-white"
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          ) : null}

          {current.target_path ? (
            <Button asChild variant="brand" className="shrink-0">
              <Link to={current.target_path}>
                <span>Khám phá ngay</span>
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function PromoBannerCard({ banner }: { banner: BannerItem }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface sm:flex-row sm:items-center">
      <div className="h-44 w-full shrink-0 overflow-hidden bg-neutral-900 sm:h-40 sm:w-64">
        {!failed ? (
          <img
            src={banner.desktop_path}
            alt={banner.alt_text}
            loading="lazy"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-neutral-900 to-brand-red/80 text-xs font-semibold uppercase tracking-widest text-white">
            Ưu đãi chọn lọc
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col justify-between gap-3 p-5 sm:flex-row sm:items-center">
        <div className="space-y-1">
          <span className="inline-block rounded-sm bg-brand-red-soft px-2 py-0.5 text-xs font-semibold text-brand-red">
            Chương trình nổi bật
          </span>
          <h3 className="text-lg font-semibold text-foreground">{banner.title}</h3>
          <p className="text-sm text-muted-foreground">{banner.alt_text}</p>
        </div>

        {banner.target_path ? (
          <Button asChild variant="brand" className="w-fit shrink-0">
            <Link to={banner.target_path}>
              <span>Xem ngay</span>
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
