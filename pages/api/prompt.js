import fs from 'fs/promises';
import path from 'path';
import { requireUser } from '../../lib/requestAuth';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireUser(req, res);
  if (!user) return;
  try {
    const fileName = req.query.mode === 'native-inpaint'
      ? 'events-native-inpaint.txt'
      : 'events-outpaint.txt';
    const prompt = await fs.readFile(path.join(process.cwd(), 'config', fileName), 'utf8');
    return res.status(200).json({ prompt: prompt.trim() });
  } catch {
    return res.status(500).json({ error: 'Failed to load the system prompt' });
  }
}
