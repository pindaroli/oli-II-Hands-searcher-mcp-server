import axios from 'axios';
import * as cheerio from 'cheerio';
async function run() {
    const url = "https://www.subito.it/annunci-italia/vendita/informatica/?q=macbook+m3";
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    };

    const response = await axios.get(url, { headers });
    const $ = cheerio.load(response.data);
    const jsonData = JSON.parse($('#__NEXT_DATA__').html() || '{}');
    
    const items = jsonData.props?.pageProps?.initialState?.items || {};
    
    console.log("originalList length:", Array.isArray(items.originalList) ? items.originalList.length : 'not array');
    if (items.originalList && items.originalList.length > 0) {
        console.log("first item keys:", Object.keys(items.originalList[0]));
        console.log("first item subject:", items.originalList[0].subject);
    }
}
run().catch(console.error);
