import type { ReactNode } from 'react';
import { Footer } from '@/components/layout/footer';
import { Header } from '@/components/layout/header';
import type { NavCategoryItem } from '@/components/layout/category-nav';

export interface AppLayoutProps {
  children: ReactNode;
  categories?: readonly NavCategoryItem[] | undefined;
  searchQuery?: string | undefined;
}

export function AppLayout({ children, categories = [], searchQuery = '' }: AppLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:ring-2 focus:ring-ring"
      >
        Đến nội dung chính
      </a>
      <Header categories={categories} searchQuery={searchQuery} />
      <main id="main-content" className="mx-auto w-full max-w-7xl flex-1 px-4 sm:px-6 lg:px-8">
        {children}
      </main>
      <Footer categories={categories} />
    </div>
  );
}
