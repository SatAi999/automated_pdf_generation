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
        
        // Handle input document source
        if (req.files && req.files['file'] && req.files['file'][0]) {
          const uploadedFile = req.files['file'][0];
          rawHtml = fs.readFileSync(uploadedFile.path, 'utf8');
          // Clean up the uploaded file from uploadsDir
          fs.unlinkSync(uploadedFile.path);
          logMessage(buildId, `Read uploaded file: ${uploadedFile.originalname}`);
        } else if (pastedText.trim()) {
          rawHtml = pastedText;
          logMessage(buildId, 'Using pasted text/HTML content');
        } else {
          throw new Error('No content provided (upload a file or paste text)');
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
          const diagramRegex = /\[(DIAGRAM|IMAGE|PLACEHOLDER):\\s*([^\]]+)\\s*\]/gi;
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
