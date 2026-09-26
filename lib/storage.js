import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.resolve(process.env.OUTPAINT_DATA_DIR || path.join(process.cwd(), 'data'));

function localPath(root, key) {
  if (typeof key !== 'string' || !key) throw new Error('Invalid storage key');
  const filePath = path.resolve(root, key);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!filePath.startsWith(prefix)) throw new Error('Invalid storage key');
  return filePath;
}

export function storageForUser(user) {
  if (!user || (user.local ? user.id !== 'local' : !/^[a-f0-9]{64}$/.test(user.id))) {
    throw new Error('Invalid user');
  }
  const root = user.local
    ? DATA_DIR
    : path.join(DATA_DIR, 'users', user.id);

  return {
    readFile(key, encoding) {
      return fs.readFile(localPath(root, key), encoding);
    },
    async writeFile(key, data, encoding) {
      const filePath = localPath(root, key);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, data, encoding);
    },
    deleteFile(key) {
      return fs.unlink(localPath(root, key));
    },
    readDir(key, options) {
      return fs.readdir(localPath(root, key), options);
    },
    async findFileWithExtensions(keyWithoutExt, extensions) {
      for (const extension of extensions) {
        const key = `${keyWithoutExt}${extension}`;
        try {
          await fs.access(localPath(root, key));
          return key;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      return null;
    },
  };
}
