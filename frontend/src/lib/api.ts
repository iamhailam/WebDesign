import { z } from 'zod';

const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';
const healthSchema = z.object({
  success: z.literal(true),
  data: z.object({ status: z.literal('ok'), service: z.string() }),
  meta: z.object({ request_id: z.uuid() }),
});

export async function fetchHealth() {
  const response = await fetch(`${baseUrl}/health`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Không thể kết nối API. Vui lòng thử lại.');
  return healthSchema.parse(await response.json());
}
