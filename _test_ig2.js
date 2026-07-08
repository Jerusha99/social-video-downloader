const axios = require('./api-server/node_modules/axios');
const cheerio = require('./api-server/node_modules/cheerio');

async function test() {
  const url = 'https://www.instagram.com/p/Dac75ghk_id/';
  const match = url.match(/instagram\.com\/p\/([^\/?#]+)/i);
  console.log('Shortcode:', match ? match[1] : 'none');

  try {
    const resp = await axios.get('https://imginn.com/p/' + match[1] + '/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36' },
      timeout: 10000,
    });
    const $ = cheerio.load(resp.data);
    const videoSrc = $('video source').attr('src') || $('video').attr('src') || '';
    const downloadLink = $('a.download').attr('href') || '';
    console.log('video src:', videoSrc || 'none');
    console.log('download link:', downloadLink || 'none');
    console.log('page length:', resp.data.length);

    $('a').each((i, el) => {
      const href = $(el).attr('href');
      const cls = $(el).attr('class') || '';
      if (href && (href.includes('cdninstagram') || href.includes('scontent') || cls.includes('download'))) {
        console.log('Found link:', href.slice(0, 120), 'class:', cls);
      }
    });
  } catch(e) { console.log('Error:', e.message); }
}
test();
