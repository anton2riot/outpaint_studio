import {
  listGenerationJournalEntries,
  readGenerationJournalImage,
} from '../../lib/generationJournal';
import { requireUser } from '../../lib/requestAuth';
import { storageForUser } from '../../lib/storage';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const user = await requireUser(req, res);
  if (!user) return;
  const storage = storageForUser(user);

  try {
    if (typeof req.query.id === 'string' && typeof req.query.file === 'string') {
      const image = await readGenerationJournalImage(storage, req.query.id, req.query.file);
      if (!image) return res.status(404).json({ error: 'Изображение не найдено' });
      res.setHeader('Content-Type', image.mimeType);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(image.buffer);
    }

    const entries = await listGenerationJournalEntries(storage);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ entries });
  } catch (error) {
    if (error.code === 'ENOENT') return res.status(404).json({ error: 'Запись не найдена' });
    console.error('generation history:', error);
    return res.status(500).json({ error: 'Не удалось загрузить историю генераций' });
  }
}
