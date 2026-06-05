const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { compilePDF, THEMES } = require('./generate_pdf');
const { downloadRelevantDiagram } = require('./image_helper');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware to support direct file:// access
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Ensure temp_builds and uploads directories exist
const tempBuildsDir = path.join(__dirname, 'temp_builds');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(tempBuildsDir)) fs.mkdirSync(tempBuildsDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '_' + file.originalname);
  }
});

const upload = multer({ storage: storage });

// In-memory builds store
const builds = {};

function logMessage(buildId, msg) {
  const logLine = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(`[Build ${buildId}] ${msg}`);
  if (builds[buildId]) {
    builds[buildId].logs.push(logLine);
  }
}

function getAutoDiagramTopic(headingText) {
  const text = headingText.toLowerCase();
  if (text.includes('introduction to machine learning')) return 'Machine Learning Model';
  if (text.includes('artificial intelligence vs machine learning')) return 'Artificial Intelligence vs Machine Learning vs Deep Learning';
  if (text.includes('machine learning workflow')) return 'Machine Learning Workflow';
  if (text.includes('types of machine learning')) return 'Types of Machine Learning';
  if (text.includes('supervised learning')) return 'Supervised Learning';
  if (text.includes('unsupervised learning')) return 'Unsupervised Learning';
  if (text.includes('reinforcement learning')) return 'Reinforcement Learning';
  if (text.includes('overfitting')) return 'Overfitting and Underfitting';
  if (text.includes('bias and variance')) return 'Bias and Variance';
  if (text.includes('decision tree')) return 'Decision Tree';
  if (text.includes('random forest')) return 'Random Forest';
  if (text.includes('confusion matrix')) return 'Confusion Matrix';
  if (text.includes('cross validation')) return 'Cross Validation';
  if (text.includes('deep learning')) return 'Deep Learning';
  return null;
}

function parseTextToHtml(text, autoFindDiagrams = false) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let html = [];
  
  let state = {
    inList: false,
    listType: null,
    inTable: false,
    inPre: false,
    inCallout: false,
    lastWasColon: false
  };

  function closeAll() {
    if (state.inList) {
      html.push(`</${state.listType}>`);
      state.inList = false;
      state.listType = null;
    }
    if (state.inTable) {
      html.push('</tbody></table>');
      state.inTable = false;
    }
    if (state.inPre) {
      html.push('</pre>');
      state.inPre = false;
    }
    if (state.inCallout) {
      html.push('</div></div>');
      state.inCallout = false;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // 1. Empty Line
    if (trimmed === '') {
      closeAll();
      continue;
    }

    // 2. Headings (Heading breakouts must happen BEFORE active state checks)
    // 2a. Title (first line of the document)
    if (i === 0 && !trimmed.match(/^\d/) && trimmed.length < 80) {
      closeAll();
      html.push(`<h1 class="page-title">${trimmed}</h1>`);
      state.lastWasColon = false;
      continue;
    }

    // 2b. H2 - Numbered (e.g. 1. Introduction to Machine Learning)
    const h2Match = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (h2Match) {
      closeAll();
      html.push(`<h1 id="sec-${h2Match[1]}">${h2Match[1]}.0 ${h2Match[2]}</h1>`);
      const topic = getAutoDiagramTopic(h2Match[2]);
      if (topic && autoFindDiagrams) {
        html.push(`[DIAGRAM: ${topic}]`);
      }
      state.lastWasColon = false;
      continue;
    }

    // 2c. H3 - Lettered (e.g. A. Regression)
    const h3Match = trimmed.match(/^([A-Z])\.\s+(.+)$/);
    if (h3Match) {
      closeAll();
      html.push(`<h2>${h3Match[1]}. ${h3Match[2]}</h2>`);
      const topic = getAutoDiagramTopic(h3Match[2]);
      if (topic && autoFindDiagrams) {
        html.push(`[DIAGRAM: ${topic}]`);
      }
      state.lastWasColon = false;
      continue;
    }

    // 2d. H3 - Steps (e.g. Step 1: Data Collection)
    const stepMatch = trimmed.match(/^Step\s+(\d+):\s*(.+)$/i);
    if (stepMatch) {
      closeAll();
      html.push(`<h3>Step ${stepMatch[1]}: ${stepMatch[2]}</h3>`);
      const topic = getAutoDiagramTopic(stepMatch[2]);
      if (topic && autoFindDiagrams) {
        html.push(`[DIAGRAM: ${topic}]`);
      }
      state.lastWasColon = false;
      continue;
    }

    // 3. Active State Continuation
    if (state.inPre) {
      html.push(rawLine);
      state.lastWasColon = false;
      continue;
    }

    if (state.inTable) {
      const parts = trimmed.split(/\t|\s{2,}/).map(p => p.trim()).filter(p => p.length > 0);
      html.push('<tr>');
      parts.forEach(p => {
        html.push(`<td>${p}</td>`);
      });
      html.push('</tr>');
      state.lastWasColon = false;
      continue;
    }

    // 4. Block Lookahead logic (only run when not already in active block)
    let blockLines = [];
    let nextEmptyIndex = i;
    while (nextEmptyIndex < lines.length && lines[nextEmptyIndex].trim() !== '') {
      blockLines.push(lines[nextEmptyIndex]);
      nextEmptyIndex++;
    }

    // Check if the block is a diagram
    const hasDrawingChar = blockLines.some(l => /[│├└┌┐─↓↑]/.test(l));
    
    if (hasDrawingChar) {
      closeAll();
      html.push('<pre class="code">');
      state.inPre = true;
      html.push(rawLine);
      state.lastWasColon = false;
      continue;
    }

    // Check if the block is a table
    const isTableBlock = blockLines.length >= 2 && blockLines.every(l => {
      const t = l.trim();
      const parts = t.split(/\t|\s{2,}/).filter(p => p.trim().length > 0);
      return parts.length >= 2;
    });

    if (isTableBlock) {
      const parts = trimmed.split(/\t|\s{2,}/).map(p => p.trim()).filter(p => p.length > 0);
      closeAll();
      html.push('<table class="simple-table"><thead><tr>');
      parts.forEach(p => {
        html.push(`<th class="simple-table-header-color simple-table-header"><strong>${p}</strong></th>`);
      });
      html.push('</tr></thead><tbody>');
      state.inTable = true;
      state.lastWasColon = false;
      continue;
    }

    // 5. Callouts (Note: or Warning:)
    const calloutMatch = trimmed.match(/^(Note|Warning|Important|Tip|Caution):\s*(.+)$/i);
    if (calloutMatch) {
      closeAll();
      const type = calloutMatch[1].toLowerCase();
      html.push(`<div class="block-color-${type === 'note' ? 'blue' : 'pink'}_background callout" style="white-space:pre-wrap;display:flex">`);
      html.push(`<div style="font-size:1.5em"><span class="icon">🚀</span></div>`);
      html.push(`<div style="width:100%"><strong>${calloutMatch[1]}</strong>: ${calloutMatch[2]}</div>`);
      state.inCallout = true;
      state.lastWasColon = false;
      continue;
    }

    // 6. Explicit Bullets
    const bulletMatch = trimmed.match(/^([-•*+])\s*(.+)$/);
    if (bulletMatch) {
      if (!state.inList || state.listType !== 'ul') {
        closeAll();
        html.push('<ul class="bulleted-list">');
        state.inList = true;
        state.listType = 'ul';
      }
      html.push(`<li style="list-style-type:disc">${bulletMatch[2]}</li>`);
      state.lastWasColon = false;
      continue;
    }

    // Explicit Ordered List
    const olMatch = trimmed.match(/^(\d+)\)\s*(.+)$/);
    if (olMatch) {
      if (!state.inList || state.listType !== 'ol') {
        closeAll();
        html.push('<ol class="numbered-list">');
        state.inList = true;
        state.listType = 'ol';
      }
      html.push(`<li>${olMatch[2]}</li>`);
      state.lastWasColon = false;
      continue;
    }

    // 7. Short lines without punctuation (Implicit list items vs headings)
    const isShort = trimmed.length < 80;
    const hasPunctuation = /[.?!,;:)"'”]$/.test(trimmed);

    if (isShort && !hasPunctuation) {
      // If we are already in a list, continue it
      if (state.inList) {
        html.push(`<li style="list-style-type:disc">${trimmed}</li>`);
        state.lastWasColon = false;
        continue;
      }

      // If the last line ended with a colon, this line starts a list
      if (state.lastWasColon) {
        closeAll();
        html.push('<ul class="bulleted-list">');
        html.push(`<li style="list-style-type:disc">${trimmed}</li>`);
        state.inList = true;
        state.listType = 'ul';
        state.lastWasColon = false;
        continue;
      }

      // Check if it's a single word or ends with a colon -> subheading
      const isSingleWord = trimmed.split(/\s+/).length === 1;
      const endsWithColon = trimmed.endsWith(':');

      if (isSingleWord || endsWithColon) {
        closeAll();
        html.push(`<h3>${trimmed}</h3>`);
        const topic = getAutoDiagramTopic(trimmed.replace(/:$/, ''));
        if (topic && autoFindDiagrams) {
          html.push(`[DIAGRAM: ${topic}]`);
        }
        state.lastWasColon = endsWithColon;
        continue;
      }

      // Check lookahead for a list:
      // If the next non-empty line also has no punctuation and is not a heading
      let nextLineNoPunctuation = false;
      let nextLineIsHeading = false;
      for (let j = i + 1; j < lines.length; j++) {
        const nextTrimmed = lines[j].trim();
        if (nextTrimmed === '') continue;
        if (nextTrimmed.match(/^(\d+)\./) || nextTrimmed.match(/^([A-Z])\./) || nextTrimmed.match(/^Step\s+\d+:/i)) {
          nextLineIsHeading = true;
          break;
        }
        nextLineNoPunctuation = !/[.?!,;:)"'”]$/.test(nextTrimmed) && nextTrimmed.length < 80;
        break;
      }

      if (nextLineNoPunctuation && !nextLineIsHeading) {
        closeAll();
        html.push('<ul class="bulleted-list">');
        html.push(`<li style="list-style-type:disc">${trimmed}</li>`);
        state.inList = true;
        state.listType = 'ul';
        state.lastWasColon = false;
        continue;
      }

      // Default to subheading or bold paragraph
      closeAll();
      html.push(`<h3>${trimmed}</h3>`);
      state.lastWasColon = false;
      continue;
    }

    // 8. Normal Paragraph
    if (state.inList) {
      closeAll();
    }
    
    if (state.inCallout) {
      html.push(`<p>${trimmed}</p>`);
    } else {
      html.push(`<p>${trimmed}</p>`);
    }
    state.lastWasColon = trimmed.endsWith(':');
  }

  closeAll();
  return html.join('\n');
}

// 1. Get all available themes
app.get('/api/themes', (req, res) => {
  res.json({ success: true, themes: Object.keys(THEMES) });
});

// 2. Start build process
app.post('/api/generate-start', upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'images', maxCount: 20 },
  { name: 'header_logo', maxCount: 1 },
  { name: 'watermark_logo', maxCount: 1 }
]), async (req, res) => {
  try {
    const buildId = 'build_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    
    // Initialize build status
    builds[buildId] = {
      status: 'running',
      logs: [],
      pdfPath: null,
      error: null
    };

    logMessage(buildId, 'Starting new PDF generation request...');

    // Extract fields
    const subjectName = req.body.subjectName || 'Economic and Social Issues';
    const chapterName = req.body.chapterName || 'Economic Growth and Development';
    const themeName = req.body.theme || 'brand';
    const headerLogoUrl = req.body.headerLogoUrl || '';
    const watermarkLogoUrl = req.body.watermarkLogoUrl || '';
    const autoFindDiagrams = req.body.autoFindDiagrams === 'true';
    const pastedText = req.body.text_content || '';

    // Create custom folder for this build
    const buildDir = path.join(tempBuildsDir, buildId);
    fs.mkdirSync(buildDir, { recursive: true });
    builds[buildId].buildDir = buildDir;

    // Send back response with build ID immediately so client can poll
    res.json({ success: true, buildId });

    // Execute build asynchronously
    (async () => {
      try {
        let rawHtml = '';
        let isPlainText = false;
        
        // Handle input document source
        if (req.files && req.files['file'] && req.files['file'][0]) {
          const uploadedFile = req.files['file'][0];
          rawHtml = fs.readFileSync(uploadedFile.path, 'utf8');
          if (uploadedFile.originalname.endsWith('.txt')) {
            isPlainText = true;
          }
          // Clean up the uploaded file from uploadsDir
          fs.unlinkSync(uploadedFile.path);
          logMessage(buildId, `Read uploaded file: ${uploadedFile.originalname}`);
        } else if (pastedText.trim()) {
          rawHtml = pastedText;
          if (!/<[a-z][\s\S]*>/i.test(rawHtml)) {
            isPlainText = true;
          }
          logMessage(buildId, 'Using pasted text/HTML content');
        } else {
          throw new Error('No content provided (upload a file or paste text)');
        }

        if (isPlainText) {
          logMessage(buildId, 'Detected plain text content. Parsing to structured HTML...');
          rawHtml = parseTextToHtml(rawHtml, autoFindDiagrams);
        }

        // Standardize document structure if not a full HTML page
        if (!rawHtml.includes('page-body')) {
          logMessage(buildId, 'Wrapping content in standard page-body layout structure...');
          rawHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${chapterName}</title>
  <style></style>
</head>
<body>
  <div class="page">
    <h1 class="page-title">${chapterName}</h1>
    <div class="page-body">
      ${rawHtml}
    </div>
  </div>
</body>
</html>`;
        }

        // Copy custom user images into buildDir using their original filenames
        if (req.files && req.files['images']) {
          req.files['images'].forEach(imgFile => {
            const dest = path.join(buildDir, imgFile.originalname);
            fs.renameSync(imgFile.path, dest);
            logMessage(buildId, `Saved custom asset image: ${imgFile.originalname}`);
          });
        }

        // Handle logo uploads
        if (req.files && req.files['header_logo'] && req.files['header_logo'][0]) {
          const logoFile = req.files['header_logo'][0];
          fs.renameSync(logoFile.path, path.join(buildDir, 'header_logo.png'));
          logMessage(buildId, 'Saved custom header logo image');
        }
        if (req.files && req.files['watermark_logo'] && req.files['watermark_logo'][0]) {
          const logoFile = req.files['watermark_logo'][0];
          fs.renameSync(logoFile.path, path.join(buildDir, 'watermark_logo.png'));
          logMessage(buildId, 'Saved custom watermark logo image');
        }

        // Scan and fetch web diagrams/flowcharts if requested
        const webDiagrams = [];
        if (autoFindDiagrams) {
          logMessage(buildId, 'Scanning document content for diagram placeholders [DIAGRAM: topic]...');
          const diagramRegex = /\[(DIAGRAM|IMAGE|PLACEHOLDER):\s*([^\]]+)\s*\]/gi;
          let match;
          const topics = new Set();
          while ((match = diagramRegex.exec(rawHtml)) !== null) {
            topics.add(match[2].trim());
          }
          
          const topicsList = Array.from(topics);
          if (topicsList.length > 0) {
            logMessage(buildId, `Found ${topicsList.length} placeholders: ${JSON.stringify(topicsList)}`);
            for (const topic of topicsList) {
              try {
                logMessage(buildId, `Searching DuckDuckGo for: "${topic}" diagrams/flowcharts...`);
                const result = await downloadRelevantDiagram(topic, buildDir);
                webDiagrams.push({
                  topic: topic,
                  filename: result.filename,
                  title: result.title,
                  url: result.url
                });
                logMessage(buildId, `Successfully fetched web diagram for "${topic}": ${result.filename}`);
              } catch (err) {
                logMessage(buildId, `Warning: Could not fetch web diagram for "${topic}": ${err.message}`);
              }
            }
          } else {
            logMessage(buildId, 'No diagram placeholders found in text.');
          }
        }

        // Write input HTML to build directory
        const inputHtmlPath = path.join(buildDir, 'input.html');
        fs.writeFileSync(inputHtmlPath, rawHtml, 'utf8');

        // Compile PDF
        const outputHtmlPath = path.join(buildDir, 'output.html');
        const outputPdfPath = path.join(buildDir, 'output.pdf');
        
        logMessage(buildId, 'Initiating Puppeteer compiler...');
        await compilePDF({
          inputHtmlPath,
          outputHtmlPath,
          outputPdfPath,
          subjectName,
          chapterName,
          headerLogoUrl: headerLogoUrl || undefined,
          watermarkLogoUrl: watermarkLogoUrl || undefined,
          theme: themeName,
          webDiagrams: webDiagrams,
          logger: (msg) => logMessage(buildId, msg)
        });

        builds[buildId].status = 'success';
        builds[buildId].pdfPath = outputPdfPath;
        logMessage(buildId, 'Compilation completed successfully!');
      } catch (err) {
        builds[buildId].status = 'failed';
        builds[buildId].error = err.message;
        logMessage(buildId, `Error during compilation: ${err.message}`);
      }
    })();
  } catch (err) {
    console.error('Failed to initiate build:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Get logs and status for build
app.get('/api/builds/:buildId/status', (req, res) => {
  const buildId = req.params.buildId;
  const build = builds[buildId];
  if (!build) {
    return res.status(404).json({ success: false, error: 'Build not found' });
  }
  res.json({
    success: true,
    status: build.status,
    logs: build.logs,
    error: build.error
  });
});

// 4. Download PDF
app.get('/api/builds/:buildId/download', (req, res) => {
  const buildId = req.params.buildId;
  const build = builds[buildId];
  if (!build || build.status !== 'success' || !build.pdfPath) {
    return res.status(404).send('PDF not found or build is not complete');
  }

  res.download(build.pdfPath, 'document.pdf', (err) => {
    if (err) {
      console.error(`Error streaming PDF for build ${buildId}:`, err);
    }
  });
});

// 5. Cleanup route (can be called by frontend when user leaves or downloads)
app.post('/api/builds/:buildId/cleanup', (req, res) => {
  const buildId = req.params.buildId;
  const build = builds[buildId];
  if (build) {
    try {
      if (build.buildDir && fs.existsSync(build.buildDir)) {
        fs.rmSync(build.buildDir, { recursive: true, force: true });
        console.log(`Cleaned up temp directory for build ${buildId}`);
      }
      delete builds[buildId];
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  } else {
    res.status(404).json({ success: false, error: 'Build not found' });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
