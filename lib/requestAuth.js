import crypto from 'crypto';

const COOKIE_NAME = '__Host-outpaint_session';
const SESSION_AGE_SECONDS = 60 * 60 * 24 * 365;

function localDevelopmentRequest(req) {
  if (process.env.NODE_ENV === 'production') return false;
  const address = req.socket?.remoteAddress;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function readSession(req) {
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader !== 'string') return null;
  const entry = cookieHeader.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!entry) return null;
  const token = entry.slice(COOKIE_NAME.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

export async function requireUser(req, res) {
  if (localDevelopmentRequest(req)) return { id: 'local', local: true };

  const token = readSession(req) || crypto.randomBytes(32).toString('base64url');
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`);
  return { id: crypto.createHash('sha256').update(token).digest('hex') };
}
