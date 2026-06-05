const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Fetch a text page
function fetchText(urlStr, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...headers
      }
    };
    
    client.get(urlStr, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve(data);
      });
    }).on('error', reject);
  });
}

// Download a binary file
function downloadFile(urlStr, destPath) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000 // 10s timeout
    };
    
    const request = client.get(urlStr, options, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          redirectUrl = new URL(redirectUrl, urlStr).href;
        }
        resolve(downloadFile(redirectUrl, destPath));
        return;
      }
      
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download file: Status ${res.statusCode}`));
        return;
      }
      
      const fileStream = fs.createWriteStream(destPath);
      res.pipe(fileStream);
      
      fileStream.on('finish', () => {
        fileStream.close();
        resolve(destPath);
      });
      
      fileStream.on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });
    
    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// Search DuckDuckGo Images
async function searchDDGImages(query) {
  try {
    const searchQuery = encodeURIComponent(query);
    console.log(`Getting VQD token for image search query: "${query}"...`);
    
    // Step 1: Get the VQD token from the main search page
    const searchHtml = await fetchText(`https://duckduckgo.com/?q=${searchQuery}&t=h_&iax=images&ia=images`);
    
    // Extract VQD using multiple patterns
    let vqd = null;
    let match = searchHtml.match(/vqd=([^&'"]+)/);
    if (match) vqd = match[1];
    
    if (!vqd) {
      match = searchHtml.match(/vqd\s*:\s*['"]([^'"]+)['"]/);
      if (match) vqd = match[1];
    }
    
    if (!vqd) {
      match = searchHtml.match(/vqd\s*=\s*['"]([^'"]+)['"]/);
      if (match) vqd = match[1];
    }
    
    if (!vqd) {
      throw new Error("Could not find VQD token in DDG response");
    }
    
    console.log(`Found VQD token: ${vqd}. Querying images API...`);
    
    // Step 2: Query the DDG image data endpoint
    // Request returns JSON
    const imagesUrl = `https://duckduckgo.com/i.js?q=${searchQuery}&vqd=${vqd}&s=0&nextParams=&o=json&api=d.js`;
    const jsonStr = await fetchText(imagesUrl, {
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://duckduckgo.com/',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'x-requested-with': 'XMLHttpRequest'
    });
    
    const results = JSON.parse(jsonStr);
    if (!results.results || results.results.length === 0) {
      console.log("No images found on DuckDuckGo.");
      return [];
    }
    
    return results.results.map(r => ({
      image: r.image,
      title: r.title,
      source: r.source,
      width: r.width,
      height: r.height
    }));
  } catch (err) {
    console.error("DuckDuckGo image search failed:", err.message);
    return [];
  }
}

// Search and download a single relevant diagram image
async function downloadRelevantDiagram(topic, outputDir) {
  // Enhance query to find diagrams/infographics specifically
  const searchQueries = [
    `${topic} diagram flowchart`,
    `${topic} infographic chart`,
    `${topic} process diagram`,
    `${topic} model chart`
  ];
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  for (const query of searchQueries) {
    console.log(`Searching for: "${query}"...`);
    const results = await searchDDGImages(query);
    
    if (results.length > 0) {
      // Loop through top results and try to download one
      // We want larger, high-quality images but not too massive
      const filtered = results.filter(r => {
        // Exclude base64 inline images and try to get standard PNG/JPEG
        return r.image.startsWith('http') && 
               (r.image.endsWith('.png') || r.image.endsWith('.jpg') || r.image.endsWith('.jpeg'));
      });
      
      const candidates = filtered.length > 0 ? filtered : results;
      
      for (let i = 0; i < Math.min(5, candidates.length); i++) {
        const candidate = candidates[i];
        const ext = path.extname(new URL(candidate.image).pathname) || '.png';
        const safeExt = ['.png', '.jpg', '.jpeg', '.gif'].includes(ext.toLowerCase()) ? ext : '.png';
        const filename = `web_diagram_${Date.now()}${safeExt}`;
        const destPath = path.join(outputDir, filename);
        
        console.log(`Attempting to download candidate: ${candidate.image}`);
        try {
          await downloadFile(candidate.image, destPath);
          console.log(`Successfully downloaded diagram: ${filename}`);
          return {
            filename: filename,
            localPath: destPath,
            title: candidate.title,
            url: candidate.image
          };
        } catch (err) {
          console.warn(`Failed to download ${candidate.image}: ${err.message}. Trying next candidate...`);
        }
      }
    }
  }
  
  throw new Error(`Could not find or download any relevant diagram for "${topic}"`);
}

module.exports = {
  searchDDGImages,
  downloadRelevantDiagram
};
