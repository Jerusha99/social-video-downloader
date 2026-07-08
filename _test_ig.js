const axios = require('./api-server/node_modules/axios');
const cheerio = require('./api-server/node_modules/cheerio');

async function test() {
  // Try imginn.com
  try {
    const resp = await axios.get('https://imginn.com/p/DaD9wNaDWEW/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 10000,
    });
    const $ = cheerio.load(resp.data);
    console.log('imginn: status', resp.status, 'len', resp.data.length);
    const videoSrc = $('video source').attr('src') || $('video').attr('src') || '';
    const downloadLink = $('a.download').attr('href') || '';
    console.log('  video source:', videoSrc.slice(0, 100) || 'none');
    console.log('  download link:', downloadLink.slice(0, 100) || 'none');
    if (!videoSrc) {
      const imgs = [];
      $('img').each((i, el) => { if ($(el).attr('src')) imgs.push($(el).attr('src')); });
      console.log('  images found:', imgs.length);
      if (imgs.length > 0) console.log('  first img:', imgs[0].slice(0, 100));
    }
  } catch (e) { console.log('imginn error:', e.message); }
}
test();
