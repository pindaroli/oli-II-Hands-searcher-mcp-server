import axios from 'axios';
import * as cheerio from 'cheerio';
async function run() {
    const url = "https://www.subito.it/annunci-italia/vendita/informatica/?q=macbook+m3";
    const headers = {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    };

    const response = await axios.get(url, { headers });
    const $ = cheerio.load(response.data);
    const jsonData = JSON.parse($('#__NEXT_DATA__').html() || '{}');
    
    console.log("keys in items:", Object.keys(jsonData.props?.pageProps?.initialState?.items || {}));
    console.log("list is array?", Array.isArray(jsonData.props?.pageProps?.initialState?.items?.list));
}
run().catch(console.error);
