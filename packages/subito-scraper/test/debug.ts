import axios from 'axios';
import * as cheerio from 'cheerio';
async function run() {
    const url = "https://www.subito.it/annunci-italia/vendita/informatica/?q=macbook+m3";
    const headers = {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Encoding": "gzip, deflate",
      "Accept-Language": "en-US,en;q=0.5",
      "Connection": "keep-alive",
      "Sec-Ch-Ua": '"Chromium";v="128", "Not;A=Brand";v="24", "Brave";v="128"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Sec-Gpc": "1",
      "Upgrade-Insecure-Requests": "1",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    };

    const response = await axios.get(url, { headers });
    const $ = cheerio.load(response.data);
    const scriptTag = $('#__NEXT_DATA__');
    console.log("scriptTag found:", scriptTag.length > 0);
    const jsonData = JSON.parse(scriptTag.html() || '{}');
    
    // Check possible paths
    console.log("has props:", !!jsonData.props);
    console.log("has pageProps:", !!jsonData.props?.pageProps);
    console.log("has initialState:", !!jsonData.props?.pageProps?.initialState);
    console.log("keys in initialState:", Object.keys(jsonData.props?.pageProps?.initialState || {}));
    
    const itemsList = jsonData?.props?.pageProps?.initialState?.items?.list || [];
    console.log("items list length:", itemsList.length);
    
    // If not found in initialState, try other places
    console.log("keys in pageProps:", Object.keys(jsonData.props?.pageProps || {}));
    
}
run().catch(console.error);
