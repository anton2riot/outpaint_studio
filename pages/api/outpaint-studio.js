import { requireUser } from '../../lib/requestAuth';
import { storageForUser } from '../../lib/storage';

const BOARD_KEY = 'outpaint-studio/board.json';

async function readBoard(storage) {
  try {
    const raw = await storage.readFile(BOARD_KEY, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export default async function handler(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  const storage = storageForUser(user);
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const board = await readBoard(storage);
      if (!board) {
        return res.status(200).json({
          version: 1,
          savedAt: 0,
          layers: [],
          snapshotFrames: [],
          exportFrames: [],
          drawings: [],
          tilePaints: [],
          viewport: null,
          selectedLayerId: null,
          gridType: 'dots',
          gridAngle: 30,
          drawGridInReference: false,
          nativeInpaint: false,
          gridSize: 20,
          snapToGrid: true,
          snapToElements: true,
          globalContext: { prompt: '', imageId: null, imageName: '' },
        });
      }
      return res.status(200).json(board);
    } catch (err) {
      console.error('outpaint-studio GET:', err);
      return res.status(500).json({ error: 'Read failed' });
    }
  }

  if (req.method === 'POST') {
    try {
      const {
        layers = [],
        snapshotFrames = [],
        exportFrames = [],
        drawings = [],
        tilePaints = [],
        viewport = null,
        selectedLayerId = null,
        gridType = 'dots',
        gridAngle = 30,
        drawGridInReference = false,
        nativeInpaint = false,
        gridSize = 20,
        snapToGrid = true,
        snapToElements = true,
        globalContext = { prompt: '', imageId: null, imageName: '' },
      } = req.body || {};

      if (!Array.isArray(layers)) {
        return res.status(400).json({ error: 'layers must be an array' });
      }

      const board = {
        version: 1,
        savedAt: Date.now(),
        layers: layers.map((l) => ({
          id: l.id,
          x: l.x,
          y: l.y,
          width: l.width,
          height: l.height,
          naturalWidth: l.naturalWidth,
          naturalHeight: l.naturalHeight,
          ...(l.locked === true ? { locked: true } : {}),
          ...(l.variants ? { variants: l.variants } : {}),
          ...(l.activeVariantIndex !== undefined ? { activeVariantIndex: l.activeVariantIndex } : {}),
          ...(l.generationMeta ? { generationMeta: l.generationMeta } : {}),
        })),
        snapshotFrames,
        exportFrames: Array.isArray(exportFrames)
          ? exportFrames
            .filter((frame) => (
              typeof frame?.id === 'string'
              && Number.isFinite(Number(frame?.x))
              && Number.isFinite(Number(frame?.y))
              && Number.isFinite(Number(frame?.width))
              && Number.isFinite(Number(frame?.height))
            ))
            .map((frame) => ({
              id: frame.id,
              x: Number(frame.x),
              y: Number(frame.y),
              width: Math.max(16, Number(frame.width)),
              height: Math.max(16, Number(frame.height)),
            }))
          : [],
        drawings: Array.isArray(drawings) ? drawings : [],
        tilePaints: Array.isArray(tilePaints)
          ? tilePaints
            .filter((tile) => (
              Number.isInteger(tile?.u)
              && Number.isInteger(tile?.v)
              && typeof tile?.color === 'string'
            ))
            .map((tile) => ({ u: tile.u, v: tile.v, color: tile.color }))
          : [],
        viewport,
        selectedLayerId,
        gridType: gridType === 'isometric' ? 'isometric' : 'dots',
        gridAngle: Number.isFinite(Number(gridAngle))
          ? Math.min(35, Math.max(22, Number(gridAngle)))
          : 30,
        drawGridInReference: drawGridInReference === true,
        nativeInpaint: nativeInpaint === true,
        gridSize,
        snapToGrid,
        snapToElements,
        globalContext: {
          prompt: typeof globalContext?.prompt === 'string' ? globalContext.prompt : '',
          imageId: typeof globalContext?.imageId === 'string' ? globalContext.imageId : null,
          imageName: typeof globalContext?.imageName === 'string' ? globalContext.imageName : '',
        },
      };

      await storage.writeFile(BOARD_KEY, JSON.stringify(board, null, 2), 'utf8');

      return res.status(200).json({ success: true, savedAt: board.savedAt });
    } catch (err) {
      console.error('outpaint-studio save:', err);
      return res.status(500).json({ error: 'Save failed' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
