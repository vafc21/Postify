/**
 * GO/NO-GO PROOF: can the (stale) instagram-private-api still log in and post a
 * Story with NATIVE, TAPPABLE stickers against Instagram's current private API?
 *
 * This is throwaway validation — NOT wired into Postify. If it works, we build
 * the real publisher around the same calls. If it fails at login or stickers,
 * the whole "free DIY" plan changes, and we learn that for the cost of one run.
 *
 * Posts a poll + self-mention + hashtag sticker onto a generated 1080×1920 card.
 *
 * USAGE (use a THROWAWAY / test IG account, not a client's, for this probe):
 *   cd server
 *   IG_USERNAME=you IG_PASSWORD=secret node scripts/sticker-story-poc.js
 *   # behind a proxy (strongly recommended — see notes):
 *   IG_PROXY=http://user:pass@host:port IG_USERNAME=... IG_PASSWORD=... node scripts/sticker-story-poc.js
 *   # if 2FA is on, it will ask; re-run with the code:
 *   IG_2FA=123456 IG_USERNAME=... IG_PASSWORD=... node scripts/sticker-story-poc.js
 *
 * The login session is cached in scripts/.ig-session.json (gitignored) and
 * reused on subsequent runs, so we DON'T re-login every time (re-login spam is
 * itself a ban signal).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { Resvg } = require('@resvg/resvg-js');
const { IgApiClient, IgLoginTwoFactorRequiredError, IgCheckpointError } = require('instagram-private-api');
const { StickerBuilder } = require('instagram-private-api/dist/sticker-builder');

const execFileAsync = promisify(execFile);
let FFMPEG; try { FFMPEG = require('ffmpeg-static') || 'ffmpeg'; } catch { FFMPEG = 'ffmpeg'; }

const USERNAME = process.env.IG_USERNAME;
const PASSWORD = process.env.IG_PASSWORD;
const PROXY = process.env.IG_PROXY || null;
const TWO_FACTOR = process.env.IG_2FA || null;
const SESSION_FILE = path.join(__dirname, '.ig-session.json');

if (!USERNAME || !PASSWORD) {
  console.error('Set IG_USERNAME and IG_PASSWORD env vars. See the header of this file.');
  process.exit(1);
}

// ── 1. Build a 1080×1920 JPEG background (resvg → ffmpeg, both already deps) ──
async function makeBackgroundJpeg() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#3b2f6b"/><stop offset="0.52" stop-color="#b5377e"/><stop offset="1" stop-color="#ff8a5b"/>
    </linearGradient></defs>
    <rect width="1080" height="1920" fill="url(#g)"/>
    <text x="540" y="380" font-family="sans-serif" font-size="64" font-weight="bold" fill="#fff" text-anchor="middle">Sticker POC</text>
  </svg>`;
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1080 } }).render().asPng();
  const tmpPng = path.join(os.tmpdir(), `poc-${Date.now()}.png`);
  const tmpJpg = path.join(os.tmpdir(), `poc-${Date.now()}.jpg`);
  fs.writeFileSync(tmpPng, png);
  // IG stories require JPEG; ffmpeg transcodes the PNG.
  await execFileAsync(FFMPEG, ['-y', '-i', tmpPng, '-q:v', '3', tmpJpg]);
  const buf = fs.readFileSync(tmpJpg);
  fs.unlinkSync(tmpPng); fs.unlinkSync(tmpJpg);
  return buf;
}

// ── 2. Login, reusing a cached session when possible ──
async function login(ig) {
  ig.state.generateDevice(USERNAME);
  if (PROXY) ig.state.proxyUrl = PROXY;

  // Persist session after every request so a valid login is reused next run.
  ig.request.end$.subscribe(async () => {
    try {
      const serialized = await ig.state.serialize();
      delete serialized.constants; // device constants are regenerated each run
      fs.writeFileSync(SESSION_FILE, JSON.stringify(serialized));
    } catch { /* best-effort */ }
  });

  if (fs.existsSync(SESSION_FILE)) {
    await ig.state.deserialize(JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')));
    try {
      const me = await ig.account.currentUser(); // cheap probe: is the session live?
      console.log(`✓ Reused cached session for @${me.username} (pk ${me.pk})`);
      return me.pk;
    } catch {
      console.log('Cached session expired — logging in fresh…');
    }
  }

  await ig.simulate.preLoginFlow();
  let loggedIn;
  try {
    loggedIn = await ig.account.login(USERNAME, PASSWORD);
  } catch (err) {
    if (err instanceof IgLoginTwoFactorRequiredError) {
      if (!TWO_FACTOR) {
        const info = err.response.body.two_factor_info;
        console.error(`\n2FA required (${info.totp_two_factor_on ? 'authenticator app' : 'SMS'}).`);
        console.error('Re-run with the code, e.g.  IG_2FA=123456 IG_USERNAME=... IG_PASSWORD=... node scripts/sticker-story-poc.js');
        process.exit(2);
      }
      const info = err.response.body.two_factor_info;
      loggedIn = await ig.account.twoFactorLogin({
        username: USERNAME,
        verificationCode: TWO_FACTOR,
        twoFactorIdentifier: info.two_factor_identifier,
        verificationMethod: info.totp_two_factor_on ? '0' : '1', // 0=TOTP, 1=SMS
        trustThisDevice: '1',
      });
    } else if (err instanceof IgCheckpointError) {
      console.error('\nInstagram threw a CHECKPOINT (suspicious-login challenge).');
      console.error('Open the Instagram app on a phone, approve the login, then re-run.');
      console.error('This is the #1 friction point of private-API automation — expect it on first connect.');
      process.exit(3);
    } else {
      throw err;
    }
  }
  // Fire-and-forget post-login flow the real app performs (helps avoid flags).
  process.nextTick(async () => { try { await ig.simulate.postLoginFlow(); } catch {} });
  console.log(`✓ Logged in as @${loggedIn.username} (pk ${loggedIn.pk})`);
  return loggedIn.pk;
}

(async () => {
  const ig = new IgApiClient();
  const myPk = await login(ig);
  const file = await makeBackgroundJpeg();

  // ── 3. Build native interactive stickers at normalized 0–1 coordinates ──
  // These map 1:1 onto Postify's existing StoryEditor element x/y, which is the
  // whole reason this path can reuse the editor you already have.
  const stickerConfig = new StickerBuilder()
    .add(StickerBuilder.poll({
      x: 0.5, y: 0.55,
      question: 'Coming to the grand opening?',
      tallies: [{ text: 'Yes 🎉', count: 0 }, { text: 'Maybe', count: 0 }],
    }))
    .add(StickerBuilder.hashtag({ x: 0.5, y: 0.72, tagName: 'grandopening' }))
    .add(StickerBuilder.mention({ x: 0.5, y: 0.85, userId: myPk })) // self-mention
    .build();

  console.log('Publishing story with poll + hashtag + mention stickers…');
  const result = await ig.publish.story({ file, stickerConfig });
  const mediaId = result?.media?.id || result?.media?.pk || JSON.stringify(result).slice(0, 200);
  console.log('\n✅ STORY POSTED. media id:', mediaId);
  console.log('Open the account on a phone and TAP the poll/hashtag/mention to confirm they are interactive.');
  console.log('If they are tappable, the free DIY path is viable and I can wire it into Postify.');
})().catch((err) => {
  console.error('\n❌ FAILED:', err?.message || err);
  if (err?.response?.body) console.error('IG response:', JSON.stringify(err.response.body).slice(0, 500));
  console.error('\nIf this is a login/parse error, the stale library may be broken against current IG —');
  console.error('that is exactly what this probe is meant to surface. Tell me the error and we pick a fallback.');
  process.exit(1);
});
