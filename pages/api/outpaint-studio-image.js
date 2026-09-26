import { requireUser } from '../../lib/requestAuth';
import { storageForUser } from '../../lib/storage';

const IMAGE_KEY_BASE = 'outpaint-studio/images';
const MAX_SIZE = 40 * 1024 * 1024;

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

function safeId(raw) {
  if (!raw || typeof raw !== 'string') return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(raw)) return null;
  return raw;
}

function mimeFromKey(key) {
  const ext = key.split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/png';
}

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const storage = storageForUser(user);
  const id = safeId(req.query.id);
  if (!id) return res.status(400).json({ error: 'Invalid id' });

  if (req.method === 'GET') {
    try {
      const key = await storage.findFileWithExtensions(`${IMAGE_KEY_BASE}/${id}`, EXTENSIONS);
      if (!key) return res.status(404).json({ error: 'Not found' });

      const buffer = await storage.readFile(key);
      res.setHeader('Content-Type', mimeFromKey(key));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Length', buffer.length);
      return res.send(buffer);
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'Not found' });
      console.error('outpaint-studio-image GET:', err);
      return res.status(500).json({ error: 'Read failed' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const contentType = req.headers['content-type'] || 'image/png';
      const ext = MIME_EXT[contentType.split(';')[0].trim()] || 'png';

      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_SIZE) {
          return res.status(413).json({ error: 'File too large' });
        }
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);
      if (buffer.length === 0) {
        return res.status(400).json({ error: 'Empty body' });
      }

      for (const oldExt of EXTENSIONS) {
        try {
          await storage.deleteFile(`${IMAGE_KEY_BASE}/${id}${oldExt}`);
        } catch (e) {
          if (e.code !== 'ENOENT') throw e;
        }
      }

      await storage.writeFile(`${IMAGE_KEY_BASE}/${id}.${ext}`, buffer);
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('outpaint-studio-image PUT:', err);
      return res.status(500).json({ error: 'Upload failed' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
