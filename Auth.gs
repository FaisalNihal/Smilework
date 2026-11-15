/**
 * Login with name + 4-digit PIN from the Users tab.
 * The app gets a signed token (valid 30 days); every request is checked against it.
 */

const TOKEN_DAYS = 30;
const MAX_PIN_TRIES = 5;

/** Users tab as objects, cached for 5 minutes. */
function users_(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) {
    const hit = cache.get('users');
    if (hit) return JSON.parse(hit);
  }
  const list = rows_(TAB.USERS, USERS_HEADERS.length).filter(r => norm_(r[0])).map(r => ({
    name: norm_(r[0]),
    pin: norm_(r[1]).padStart(4, '0'),
    role: normRole_(r[2]),
    joinDate: cellDayKey_(r[3]),
    active: norm_(r[4]) === '' ? true : isTrue_(r[4])
  }));
  cache.put('users', JSON.stringify(list), 300);
  return list;
}

function normRole_(v) {
  const s = norm_(v).toLowerCase();
  if (s.startsWith('admin')) return 'Admin';
  if (s === 'sr' || s === 'tm' || s.startsWith('sales')) return 'SR';
  return 'Merchandiser';
}

function findUser_(name) {
  return users_().find(u => sameName_(u.name, name)) || null;
}

/** Names for the login screen (active users only). */
function loginNames_() {
  return users_().filter(u => u.active).map(u => u.name).sort((a, b) => a.localeCompare(b));
}

function login_(req) {
  const name = norm_(req.name), pin = norm_(req.pin);
  if (!name || !/^\d{4}$/.test(pin)) return { ok: false, error: 'LOGIN', message: 'নাম ও ৪ সংখ্যার পিন দিন' };

  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + name.toLowerCase();
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= MAX_PIN_TRIES) {
    return { ok: false, error: 'LOCKED', message: 'অনেকবার ভুল পিন। ১৫ মিনিট পর চেষ্টা করুন বা অ্যাডমিনকে জানান।' };
  }

  const user = findUser_(name);
  if (!user || !user.active || user.pin !== pin) {
    cache.put(failKey, String(fails + 1), 900);
    return { ok: false, error: 'LOGIN', message: 'নাম বা পিন ভুল' };
  }
  cache.remove(failKey);
  return { ok: true, token: makeToken_(user), user: { name: user.name, role: user.role } };
}

function tokenSecret_() {
  let s = prop_('TOKEN_SECRET');
  if (!s) { s = uuid_() + uuid_(); setProp_('TOKEN_SECRET', s); }
  return s;
}

function b64url_(bytesOrString) {
  return Utilities.base64EncodeWebSafe(bytesOrString).replace(/=+$/, '');
}

function sign_(payload) {
  return b64url_(Utilities.computeHmacSha256Signature(payload, tokenSecret_()));
}

function makeToken_(user, extra) {
  const data = Object.assign({ n: user.name, r: user.role, e: Date.now() + TOKEN_DAYS * 864e5 }, extra || {});
  const payload = b64url_(Utilities.newBlob(JSON.stringify(data)).getBytes());
  return payload + '.' + sign_(payload);
}

/** A short stamp of the common TM/SR password: changing the password logs every TM/SR out. */
function teamStamp_(password) { return sign_('team:' + password).slice(0, 12); }

const MAX_TEAM_TRIES = 30;

/**
 * TM/SR login: one common password for everyone (Settings tab, tm_password).
 * The typed name is optional and only labels their photos.
 */
function teamLogin_(req) {
  const pw = norm_(getSettings_().tm_password);
  if (!pw) return { ok: false, error: 'LOGIN', message: 'TM/SR লগইন এখনো চালু হয়নি। অ্যাডমিনকে জানান।' };
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('fail_team') || 0);
  if (fails >= MAX_TEAM_TRIES) {
    return { ok: false, error: 'LOCKED', message: 'অনেকবার ভুল পাসওয়ার্ড। ১৫ মিনিট পর চেষ্টা করুন।' };
  }
  if (norm_(req.password) !== pw) {
    cache.put('fail_team', String(fails + 1), 900);
    return { ok: false, error: 'LOGIN', message: 'পাসওয়ার্ড ভুল' };
  }
  const typed = norm_(req.name).replace(/[^\p{L}\p{N} .\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const user = { name: typed ? 'TM/SR: ' + typed : 'TM/SR', role: 'SR' };
  return { ok: true, token: makeToken_(user, { t: 'team', pv: teamStamp_(pw) }), user: { name: user.name, role: 'SR', team: true } };
}

/** Returns {name, role} or null. Also rejects users who were deactivated since login. */
function verifyToken_(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || sign_(parts[0]) !== parts[1]) return null;
  let data;
  try {
    const padded = parts[0] + '==='.slice((parts[0].length + 3) % 4);
    data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString());
  } catch (e) { return null; }
  if (!data || !data.n || Date.now() > data.e) return null;
  if (data.t === 'team') {
    const pw = norm_(getSettings_().tm_password);
    if (!pw || teamStamp_(pw) !== data.pv) return null;
    return { name: data.n, role: 'SR', team: true };
  }
  const user = findUser_(data.n);
  if (!user || !user.active) return null;
  return { name: user.name, role: user.role };
}
