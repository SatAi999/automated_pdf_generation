const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const puppeteer = require('puppeteer-core');

// Standard configurations for direct execution
const DEFAULT_INPUT_HTML = path.join(__dirname, 'Anuj Jindal Task', 'Notes Economic Growth and Development 118b820004a246028d53c0d80e25b5f3.html');
const DEFAULT_OUTPUT_HTML = path.join(__dirname, 'Anuj Jindal Task', 'styled_document.html');
const DEFAULT_OUTPUT_PDF = path.join(__dirname, 'Economic Growth and Development.pdf');

const DEFAULT_HEADER_LOGO_URL = 'https://anujjindal.in/wp-content/uploads/2022/05/LOGO-FULL-01.png';
const DEFAULT_WATERMARK_LOGO_URL = 'https://anujjindal.in/wp-content/uploads/2023/02/LOGO-CROP.png';

// Theme Presets
const THEMES = {
  brand: {
    primary: '#1B71AC', // Blue
    secondary: '#2AB573', // Green
    lightBg: 'rgba(42, 181, 115, 0.05)',
  },
  corporate: {
    primary: '#1E3A8A', // Dark Blue
    secondary: '#3B82F6', // Blue
    lightBg: 'rgba(59, 130, 246, 0.05)',
  },
  crimson: {
    primary: '#7F1D1D', // Crimson
    secondary: '#D97706', // Amber
    lightBg: 'rgba(217, 119, 6, 0.05)',
  },
  dark: {
    primary: '#1F2937', // Dark Charcoal
    secondary: '#8B5CF6', // Purple
    lightBg: 'rgba(139, 92, 246, 0.05)',
  }
};

// Helper to fetch an image as base64
function getBase64Image(url) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };
    
    client.get(url, options, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch image: Status ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const mimeType = res.headers['content-type'] || 'image/png';
        const base64 = buffer.toString('base64');
        resolve(`data:${mimeType};base64,${base64}`);
      });
    }).on('error', reject);
  });
}

// Get logo as base64, locally cached
async function getLogoBase64(localPath, remoteUrl, log = console.log) {
  if (fs.existsSync(localPath)) {
    const buffer = fs.readFileSync(localPath);
    const ext = path.extname(localPath).substring(1);
    const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }
  
  if (!remoteUrl) {
    throw new Error(`Local file not found and remote URL is not provided: ${localPath}`);
  }
  
  log(`Downloading ${remoteUrl}...`);
  try {
    const base64 = await getBase64Image(remoteUrl);
    const base64Data = base64.split(';base64,').pop();
    fs.writeFileSync(localPath, Buffer.from(base64Data, 'base64'));
    return base64;
  } catch (err) {
    console.error(`Error downloading logo: ${err.message}`);
    // Return empty fallback image or throw
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  }
}

// Compile PDF with options
async function compilePDF(options = {}) {
  const log = (msg) => {
    console.log(msg);
    if (options.logger && typeof options.logger === 'function') {
      options.logger(msg);
    }
  };

  const inputHtmlPath = options.inputHtmlPath || DEFAULT_INPUT_HTML;
  const outputHtmlPath = options.outputHtmlPath || DEFAULT_OUTPUT_HTML;
  const outputPdfPath = options.outputPdfPath || DEFAULT_OUTPUT_PDF;
  
  const subjectName = options.subjectName || 'Economic and Social Issues';
  const chapterName = options.chapterName || 'Economic Growth and Development';
  
  const headerLogoUrl = options.headerLogoUrl || DEFAULT_HEADER_LOGO_URL;
  const watermarkLogoUrl = options.watermarkLogoUrl || DEFAULT_WATERMARK_LOGO_URL;
  
  const themeName = options.theme || 'brand';
  const theme = THEMES[themeName] || THEMES.brand;
  
  const localHeaderLogo = path.join(path.dirname(inputHtmlPath), 'header_logo.png');
  const localWatermarkLogo = path.join(path.dirname(inputHtmlPath), 'watermark_logo.png');
  
  // 1. Get Base64 Logos
  const headerLogoBase64 = await getLogoBase64(localHeaderLogo, headerLogoUrl, log);
  const watermarkLogoBase64 = await getLogoBase64(localWatermarkLogo, watermarkLogoUrl, log);
  
  // 2. Read the raw HTML
  let htmlContent = fs.readFileSync(inputHtmlPath, 'utf8');
  
  // Smart Placeholder Replacement
  // Replace [DIAGRAM: topic] or [IMAGE: topic] with downloaded web images
  if (options.webDiagrams && Array.isArray(options.webDiagrams)) {
    options.webDiagrams.forEach(diag => {
      // Find placeholders like [DIAGRAM: topic name] case-insensitively
      const escapedTopic = diag.topic.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`\\[(DIAGRAM|IMAGE|PLACEHOLDER):\\s*${escapedTopic}\\s*\\]`, 'gi');
      
      const figureHtml = `
        <figure class="image">
          <a href="${diag.filename}"><img src="${diag.filename}" alt="${diag.topic}" /></a>
          <figcaption>${diag.title || diag.topic + ' Diagram'}</figcaption>
        </figure>
      `;
      htmlContent = htmlContent.replace(regex, figureHtml);
    });
  }
  
  // 3. Define the Custom CSS using theme colors
  const customCSS = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap');
    
    html, body {
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Inter', sans-serif;
      color: #333333;
      line-height: 1.5;
      background-color: #ffffff;
      padding: 0;
    }
    
    .page {
      padding: 10px 0px;
      max-width: 100% !important;
      margin: 0 auto !important;
    }
    
    .page-title {
      font-family: 'Montserrat', sans-serif;
      font-weight: 800;
      font-size: 24px;
      color: ${theme.primary};
      text-align: center;
      margin-top: 10px;
      margin-bottom: 25px;
      column-span: all;
    }
    
    .page-body {
      margin-top: 15px;
    }
    
    .two-columns {
      column-count: 2;
      column-gap: 28px;
      column-fill: balance;
      margin-bottom: 20px;
      break-inside: auto;
    }
    
    h1 {
      background-color: ${theme.secondary};
      color: #ffffff;
      padding: 8px 16px;
      font-family: 'Montserrat', sans-serif;
      font-size: 14px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 25px;
      margin-bottom: 15px;
      border-radius: 4px;
      page-break-after: avoid;
      break-after: avoid;
    }
    
    h2 {
      font-family: 'Montserrat', sans-serif;
      color: ${theme.primary};
      font-size: 12.5px;
      font-weight: 700;
      margin-top: 18px;
      margin-bottom: 10px;
      border-bottom: 1.5px solid ${theme.primary};
      padding-bottom: 4px;
      page-break-after: avoid;
      break-after: avoid;
    }
    
    h3 {
      font-family: 'Montserrat', sans-serif;
      color: ${theme.primary};
      font-size: 11px;
      font-weight: 700;
      margin-top: 14px;
      margin-bottom: 8px;
      page-break-after: avoid;
      break-after: avoid;
    }
    
    p, li {
      font-size: 10px;
      color: #333333;
      margin-top: 0;
      margin-bottom: 6px;
    }
    
    .bulleted-list, .numbered-list {
      padding-left: 18px;
      margin-top: 4px;
      margin-bottom: 8px;
    }
    
    li {
      margin-bottom: 4px;
    }
    
    li ul {
      list-style-type: circle !important;
      padding-left: 12px;
    }
    
    /* Callouts (Knowledge Nuggets) */
    .callout {
      border: 1.5px solid ${theme.secondary} !important;
      background-color: ${theme.lightBg} !important;
      border-radius: 6px !important;
      padding: 10px 14px !important;
      margin: 12px 0 !important;
      display: flex !important;
      align-items: flex-start !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
    
    .callout .icon {
      margin-right: 10px !important;
      font-size: 16px !important;
      display: inline-block !important;
      margin-top: 2px !important;
    }
    
    .callout div {
      font-size: 9.5px !important;
      color: #333333 !important;
    }
    
    .callout div strong {
      color: ${theme.secondary} !important;
      display: block;
      font-size: 10.5px;
      margin-bottom: 4px;
      font-family: 'Montserrat', sans-serif;
    }
    
    /* Table of Contents */
    .table_of_contents {
      background-color: #f7fafc !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 6px !important;
      padding: 16px !important;
      margin-bottom: 25px !important;
      column-count: 2 !important;
      column-gap: 30px !important;
      font-family: 'Inter', sans-serif !important;
    }
    
    .table_of_contents-item {
      margin-bottom: 0 !important;
      font-size: 10px !important;
      line-height: 1.4 !important;
      break-inside: avoid !important;
    }
    
    .table_of_contents-indent-0 {
      font-weight: 700 !important;
      color: ${theme.primary} !important;
    }
    
    .table_of_contents-indent-1 {
      padding-left: 12px !important;
      color: #333333 !important;
    }
    
    .table_of_contents-indent-2 {
      padding-left: 24px !important;
      color: #666666 !important;
    }
    
    .table_of_contents-indent-3 {
      padding-left: 36px !important;
      color: #888888 !important;
    }
    
    .table_of_contents-link {
      text-decoration: none !important;
      border-bottom: none !important;
    }
    
    /* Tables */
    table {
      width: 100% !important;
      border-collapse: collapse !important;
      margin: 15px 0 !important;
      font-size: 9px !important;
      break-inside: avoid !important;
    }
    
    th {
      background-color: ${theme.primary} !important;
      color: #ffffff !important;
      font-weight: 700 !important;
      text-align: left !important;
      padding: 6px 8px !important;
      border: 1px solid ${theme.primary} !important;
      font-family: 'Montserrat', sans-serif;
    }
    
    td {
      padding: 6px 8px !important;
      border: 1px solid #e0e0e0 !important;
    }
    
    tr:nth-child(even) {
      background-color: #f7fafc !important;
    }
    
    /* Images */
    figure.image {
      margin: 15px 0 !important;
      text-align: center !important;
      break-inside: avoid !important;
    }
    
    figure.image img {
      max-width: 90% !important;
      max-height: 180mm !important;
      object-fit: contain !important;
      border-radius: 4px !important;
      border: 1px solid #e0e0e0 !important;
      box-shadow: 0 1px 4px rgba(0,0,0,0.05) !important;
    }
    
    /* Highlights */
    mark.highlight-orange_background {
      background-color: rgba(27, 113, 172, 0.08) !important;
      color: ${theme.primary} !important;
      font-weight: 600;
      padding: 1px 3px;
      border-radius: 2px;
    }
    
    mark.highlight-red {
      color: #eb5757 !important;
      background-color: rgba(235, 87, 87, 0.06) !important;
      font-weight: 600;
      padding: 1px 3px;
      border-radius: 2px;
    }
    
    mark.highlight-blue {
      color: ${theme.primary} !important;
      background: none !important;
      font-weight: 700;
    }
    
    mark.highlight-teal {
      color: ${theme.secondary} !important;
      background: none !important;
      font-weight: 700;
    }
    
    strong {
      color: #222222;
      font-weight: 700;
    }
    
    /* Watermark styling */
    .watermark {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 550px;
      height: 550px;
      opacity: 0.2;
      z-index: -1000;
      pointer-events: none;
      background-image: url('${watermarkLogoBase64}');
      background-size: contain;
      background-repeat: no-repeat;
      background-position: center;
    }
  `;
  
  // Replace style block
  htmlContent = htmlContent.replace(/<style>[\s\S]*?<\/style>/, `<style>${customCSS}</style>`);
  
  // Inject watermark div immediately after <body> tag
  const watermarkDiv = `<div class="watermark"></div>`;
  htmlContent = htmlContent.replace(/<body[^>]*>/, (match) => `${match}\n${watermarkDiv}`);
  
  // Replace pushpins with rockets
  htmlContent = htmlContent.replaceAll('📌', '🚀');
  
  // Write styled HTML out
  fs.writeFileSync(outputHtmlPath, htmlContent, 'utf8');
  log(`Saved styled HTML to: ${outputHtmlPath}`);
  
  // 4. Launch Puppeteer to render PDF
  log("Launching Puppeteer...");
  
  // Find local chrome or edge
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Users\\Satwik\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  let executablePath = undefined;
  for (const p of chromePaths) {
    if (fs.existsSync(p)) {
      executablePath = p;
      log(`Found system browser for PDF rendering: ${p}`);
      break;
    }
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Load local HTML
  log("Loading HTML in page...");
  await page.goto(`file:///${outputHtmlPath.replace(/\\/g, '/')}`, {
    waitUntil: 'networkidle0'
  });
  
  // Dynamic DOM restructuring script
  log("Restructuring DOM for two-column text layout...");
  await page.evaluate(() => {
    const pageBody = document.querySelector('.page-body');
    if (!pageBody) return;
    
    // 1. Unwrap all display:contents wrapper divs to make DOM flat
    const wrappers = Array.from(pageBody.querySelectorAll('div[style*="display:contents"]'));
    wrappers.forEach(wrapper => {
      const parent = wrapper.parentNode;
      while (wrapper.firstChild) {
        parent.insertBefore(wrapper.firstChild, wrapper);
      }
      parent.removeChild(wrapper);
    });
    
    // 2. Group elements
    const children = Array.from(pageBody.children);
    const newChildren = [];
    let currentGroup = [];
    
    function flushGroup() {
      if (currentGroup.length > 0) {
        const colDiv = document.createElement('div');
        colDiv.className = 'two-columns';
        currentGroup.forEach(child => colDiv.appendChild(child));
        newChildren.push(colDiv);
        currentGroup = [];
      }
    }
    
    children.forEach(child => {
      const tagName = child.tagName.toLowerCase();
      const isImage = child.classList.contains('image') || tagName === 'figure';
      const isTable = tagName === 'table';
      const isH1 = tagName === 'h1';
      const isTOC = tagName === 'nav' || child.classList.contains('table_of_contents');
      
      if (isImage || isTable || isH1 || isTOC) {
        flushGroup();
        newChildren.push(child);
      } else {
        currentGroup.push(child);
      }
    });
    
    flushGroup();
    
    // 3. Clear and append
    pageBody.innerHTML = '';
    newChildren.forEach(child => pageBody.appendChild(child));
  });

  // Save restructured HTML back to disk for debugging/verifying
  const restructuredHtml = await page.content();
  fs.writeFileSync(outputHtmlPath, restructuredHtml, 'utf8');
  
  // Header template with base64 logo
  const headerTemplate = `
    <div style="font-family: 'Montserrat', 'Inter', sans-serif; font-size: 7px; width: 100%; display: flex; justify-content: space-between; align-items: center; border-bottom: 0.75px solid #e2e8f0; padding-bottom: 4px; padding-left: 40px; padding-right: 40px; box-sizing: border-box; -webkit-print-color-adjust: exact;">
      <img src="${headerLogoBase64}" style="height: 16px; object-fit: contain;" />
      <span style="color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">${subjectName} | ${chapterName}</span>
    </div>
  `;
  
  // Footer template
  const footerTemplate = `
    <div style="font-family: 'Montserrat', 'Inter', sans-serif; font-size: 7px; width: 100%; display: flex; justify-content: space-between; align-items: center; border-top: 0.75px solid #e2e8f0; padding-top: 4px; padding-left: 40px; padding-right: 40px; box-sizing: border-box; -webkit-print-color-adjust: exact;">
      <span style="color: #64748b; font-weight: 500;">+91 9999466225</span>
      <span style="color: #64748b; font-weight: 600;">www.anujjindal.in</span>
      <div style="background-color: ${theme.secondary}; color: #ffffff; padding: 2px 6px; border-radius: 2px; font-weight: 700; font-size: 8px;">
        <span class="pageNumber"></span>
      </div>
    </div>
  `;
  
  log("Generating PDF file...");
  await page.pdf({
    path: outputPdfPath,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: headerTemplate,
    footerTemplate: footerTemplate,
    margin: {
      top: '65px',
      bottom: '65px',
      left: '40px',
      right: '40px'
    }
  });
  
  await browser.close();
  log(`SUCCESS! Beautiful PDF generated at: ${outputPdfPath}`);
  return outputPdfPath;
}

// Fallback CLI runner
async function main() {
  try {
    await compilePDF();
  } catch (err) {
    console.error("CLI compilation failed:", err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  compilePDF,
  THEMES
};
