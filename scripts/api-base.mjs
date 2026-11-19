/** Validate the public HTTPS API base without echoing potentially unsafe input. */
export function validateProductionApiBase(value) {
  if (typeof value !== 'string' || !value || /\s/.test(value)) {
    throw new Error('PRODUCTION_API_BASE must be a non-empty HTTPS API URL.');
  }
  let url;
  try { url = new URL(value); } catch {
    throw new Error('PRODUCTION_API_BASE must be a valid HTTPS API URL.');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (url.protocol !== 'https:' || !hostname || url.username || url.password
    || url.pathname !== '/api' || url.search || url.hash
    || hostname === 'example.com' || hostname.endsWith('.example.com')) {
    throw new Error('PRODUCTION_API_BASE requires HTTPS, a non-example.com host and /api without credentials, query or fragment.');
  }
  return `${url.origin}/api`;
}

/** Ordinary CI/local builds may use the same-origin proxy; releases must be explicit. */
export function resolveBuildApiBase(value, release = false) {
  if (!value || value === '/api') {
    if (release) return validateProductionApiBase(value);
    return '/api';
  }
  return validateProductionApiBase(value);
}
