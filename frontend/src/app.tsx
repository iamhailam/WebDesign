import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { HomePage } from '@/pages/home';

const SystemPage = lazy(() => import('@/pages/system').then((module) => ({ default: module.SystemPage })));

export function App() {
  return (
    <>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:block focus:p-4">Đến nội dung chính</a>
      <header className="border-b">
        <nav className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6" aria-label="Điều hướng chính">
          <Link to="/" className="text-xl font-bold tracking-tight">FASHION RETAIL</Link>
          <NavLink to="/system" className="text-sm underline-offset-4 hover:underline">Trạng thái kết nối</NavLink>
        </nav>
      </header>
      <main id="main-content" className="mx-auto max-w-7xl px-4 sm:px-6">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/system" element={<Suspense fallback={<p className="py-12" role="status">Đang tải…</p>}><SystemPage /></Suspense>} />
          <Route path="*" element={<section className="space-y-4 py-12"><h1 className="text-3xl font-semibold">Không tìm thấy trang</h1><Link to="/" className="underline">Về trang chủ</Link></section>} />
        </Routes>
      </main>
    </>
  );
}
