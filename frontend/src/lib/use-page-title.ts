import { useEffect } from 'react';

const SITE_NAME = 'Fashion Retail';

export function usePageTitle(title?: string | undefined) {
  useEffect(() => {
    document.title = title ? `${title} | ${SITE_NAME}` : `${SITE_NAME} — Thời trang đa thương hiệu`;
  }, [title]);
}
