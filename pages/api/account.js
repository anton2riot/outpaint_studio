import { requireUser } from '../../lib/requestAuth';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireUser(req, res);
  if (!user) return;
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ id: user.id });
}
