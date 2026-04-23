// Sanity-check the nginx UA-routing regexes against real-world User-Agents.
// Run: node apps/landing/_ua-check.js
const isWebView = /\swv\)/;
const isSocialIab = /FB_IAB|FBAN|Instagram|Pinterest|TikTok|musical_ly|Twitter|LinkedIn|Line\/|Snapchat|OKApp|VKAndroidApp/;

const cases = [
  // Expected → 'game'
  ['Android WV (Pixel 7, Android 13)', 'Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/112.0.5615.136 Mobile Safari/537.36', 'game'],
  ['Android WV (Samsung)',             'Mozilla/5.0 (Linux; Android 12; SM-G981B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.127 Mobile Safari/537.36', 'game'],
  ['Android WV (Xiaomi / HyperOS)',    'Mozilla/5.0 (Linux; Android 14; 2312DRA50G; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.230 Mobile Safari/537.36', 'game'],

  // Expected → 'landing'
  ['Chrome Android',                   'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.5615.100 Mobile Safari/537.36', 'landing'],
  ['Firefox Android',                  'Mozilla/5.0 (Android 13; Mobile; rv:109.0) Gecko/112.0 Firefox/112.0', 'landing'],
  ['Safari iPhone',                    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1', 'landing'],
  ['Desktop Chrome (Windows)',         'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'landing'],
  ['Facebook in-app (Android)',        'Mozilla/5.0 (Linux; Android 12; SM-G981B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/102.0.5005.125 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/376.0.0.25.109;]', 'landing'],
  ['Instagram in-app (Android)',       'Mozilla/5.0 (Linux; Android 13; SM-S901U; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.145 Mobile Safari/537.36 Instagram 320.0.0.42.101 Android', 'landing'],
  ['TikTok in-app (Android)',          'Mozilla/5.0 (Linux; U; Android 13; en_US; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.144 Mobile Safari/537.36 musical_ly_30.8.0 JsSdk/2.0 NetType/WIFI', 'landing'],
  ['Googlebot (SEO crawler)',          'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'landing'],
];

let fail = 0;
for (const [name, ua, expected] of cases) {
  const wv = isWebView.test(ua);
  const iab = isSocialIab.test(ua);
  const actual = wv && !iab ? 'game' : 'landing';
  const mark = actual === expected ? 'OK ' : 'FAIL';
  if (actual !== expected) fail++;
  console.log(`${mark}  ${name.padEnd(34)} -> ${actual} (wv=${wv} iab=${iab})`);
}
console.log(fail === 0 ? '\nAll UA cases pass.' : `\n${fail} case(s) failed.`);
process.exit(fail);
