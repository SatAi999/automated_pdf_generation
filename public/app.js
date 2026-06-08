// Client side script for Branded PDF Generator Dashboard

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('generator-form');
  const btnSubmit = document.getElementById('btn-submit');
  const btnSpinner = btnSubmit.querySelector('.btn-spinner');
  const btnDownload = document.getElementById('btn-download');
  const consoleBox = document.getElementById('console-box');
  const previewBox = document.getElementById('preview-box');
  const pdfIframe = document.getElementById('pdf-iframe');
  
  // API base detection to support direct file:// access
  const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';

  // Tab Switching
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  let activeTab = 'upload-tab';
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      activeTab = tab.getAttribute('data-tab');
      document.getElementById(activeTab).classList.add('active');
    });
  });

  // Dropzone File Indicators
  setupDropzone('doc-dropzone', 'file', 'doc-file-indicator', 'Browse or drop HTML/txt file');
  setupDropzone('images-dropzone', 'images', 'images-file-indicator', 'Browse or drop image assets');

  function setupDropzone(dropzoneId, inputId, indicatorId, defaultText) {
    const dropzone = document.getElementById(dropzoneId);
    const input = document.getElementById(inputId);
    const indicator = document.getElementById(indicatorId);
    const textEl = dropzone.querySelector('.dropzone-text');
    const originalTextHTML = textEl ? textEl.innerHTML : '';
    
    // Stop propagation on input click to prevent bubbling up and re-triggering file picker
    input.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Trigger input click when clicking dropzone text
    dropzone.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') {
        input.click();
      }
    });

    input.addEventListener('change', () => {
      updateIndicator();
    });

    // Drag events
    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('active-drag');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('active-drag');
      }, false);
    });

    dropzone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      const files = dt.files;
      input.files = files;
      updateIndicator();
    }, false);

    function updateIndicator() {
      if (input.files.length > 0) {
        dropzone.classList.add('has-file');
        if (input.files.length === 1) {
          const filename = input.files[0].name;
          indicator.textContent = 'file uploaded';
          indicator.style.color = '#2AB573'; // Success color
          if (textEl) {
            textEl.innerHTML = `File uploaded: <strong style="color: #2AB573">${filename}</strong>`;
          }
          addConsoleLine(`File selected: "${filename}" (${(input.files[0].size / 1024).toFixed(1)} KB)`, 'info');
        } else {
          indicator.textContent = `Selected ${input.files.length} files`;
          indicator.style.color = '#38bdf8';
          if (textEl) {
            textEl.innerHTML = `Selected <strong style="color: #38bdf8">${input.files.length} files</strong>`;
          }
          addConsoleLine(`Selected ${input.files.length} asset files for compilation.`, 'info');
        }
      } else {
        dropzone.classList.remove('has-file');
        indicator.textContent = defaultText;
        indicator.style.color = '';
        if (textEl) {
          textEl.innerHTML = originalTextHTML;
        }
      }
    }
  }

  // Handle mini-uploads for logos
  const miniUploads = document.querySelectorAll('.mini-upload');
  miniUploads.forEach(mu => {
    const input = mu.querySelector('input');
    const indicator = mu.querySelector('.mini-upload-indicator');
    
    input.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    mu.addEventListener('click', (e) => {
      if (e.target !== input) {
        input.click();
      }
    });
    
    input.addEventListener('change', () => {
      if (input.files.length > 0) {
        indicator.textContent = input.files[0].name;
        indicator.style.color = '#38bdf8';
      }
    });
  });

  // Log messages helper
  function addConsoleLine(text, type = '') {
    const line = document.createElement('div');
    line.className = `console-line ${type}`;
    line.textContent = text;
    consoleBox.appendChild(line);
    consoleBox.scrollTop = consoleBox.scrollHeight;
  }

  // Active build tracker for cleanup
  let currentBuildId = null;

  async function performCleanup() {
    if (currentBuildId) {
      try {
        await fetch(`${API_BASE}/api/builds/${currentBuildId}/cleanup`, { method: 'POST' });
        console.log(`Cleaned up build ${currentBuildId}`);
        currentBuildId = null;
      } catch (err) {
        console.error('Failed to run cleanup:', err);
      }
    }
  }

  // Handle unload cleanup
  window.addEventListener('beforeunload', () => {
    if (currentBuildId) {
      // Use beacon API if supported, falls back to standard fetch
      if (navigator.sendBeacon) {
        navigator.sendBeacon(`${API_BASE}/api/builds/${currentBuildId}/cleanup`);
      } else {
        fetch(`${API_BASE}/api/builds/${currentBuildId}/cleanup`, { method: 'POST', keepalive: true });
      }
    }
  });

  // Submit and start build
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Clean up previous build before starting new one
    await performCleanup();
    
    // Reset UI
    consoleBox.innerHTML = '';
    previewBox.classList.add('hidden');
    btnDownload.classList.add('hidden');
    pdfIframe.src = '';
    
    // Disable submit button
    btnSubmit.disabled = true;
    btnSpinner.classList.remove('hidden');
    
    addConsoleLine('Sending documents and properties to server...', 'system-msg');
    
    const formData = new FormData(form);
    
    // If we are on the paste tab, delete file input to ensure we don't submit empty files
    if (activeTab === 'paste-tab') {
      formData.delete('file');
      const textVal = document.getElementById('text_content').value;
      if (!textVal.trim()) {
        addConsoleLine('Error: Text content is empty!', 'error');
        btnSubmit.disabled = false;
        btnSpinner.classList.add('hidden');
        return;
      }
    } else {
      formData.delete('text_content');
      const fileInput = document.getElementById('file');
      if (fileInput.files.length === 0) {
        addConsoleLine('Error: No document file selected!', 'error');
        btnSubmit.disabled = false;
        btnSpinner.classList.add('hidden');
        return;
      }
    }
    
    try {
      const response = await fetch(`${API_BASE}/api/generate-start`, {
        method: 'POST',
        body: formData
      });
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Server error initiating compilation');
      }
      
      currentBuildId = result.buildId;
      addConsoleLine(`Build job created successfully. Job ID: ${currentBuildId}`, 'system-msg');
      addConsoleLine('Polling server logs...', 'info');
      
      // Start polling status
      pollBuildStatus(currentBuildId);
      
    } catch (err) {
      addConsoleLine(`Submission failed: ${err.message}`, 'error');
      btnSubmit.disabled = false;
      btnSpinner.classList.add('hidden');
    }
  });

  // Polling Status Logic
  let pollInterval = null;
  let loggedLinesCount = 0;

  function pollBuildStatus(buildId) {
    loggedLinesCount = 0;
    
    pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/api/builds/${buildId}/status`);
        if (response.status === 404) {
          clearInterval(pollInterval);
          addConsoleLine('Error: Build job not found on server.', 'error');
          resetSubmitButton();
          return;
        }
        
        const data = await response.json();
        
        if (!data.success) {
          throw new Error(data.error || 'Failed to fetch status');
        }

        // Print new logs
        const newLogs = data.logs.slice(loggedLinesCount);
        newLogs.forEach(log => {
          if (log.toLowerCase().includes('error')) {
            addConsoleLine(log, 'error');
          } else if (log.toLowerCase().includes('success') || log.toLowerCase().includes('complete')) {
            addConsoleLine(log, 'system-msg');
          } else {
            addConsoleLine(log);
          }
        });
        loggedLinesCount = data.logs.length;

        // Check completion status
        if (data.status === 'success') {
          clearInterval(pollInterval);
          addConsoleLine('Build succeeded! Loading preview...', 'system-msg');
          
          // Show PDF download action
          btnDownload.classList.remove('hidden');
          btnDownload.onclick = () => {
            window.location.href = `${API_BASE}/api/builds/${buildId}/download`;
          };

          // Render browser PDF iframe
          pdfIframe.src = `${API_BASE}/api/builds/${buildId}/download`;
          previewBox.classList.remove('hidden');
          
          resetSubmitButton();
        } else if (data.status === 'failed') {
          clearInterval(pollInterval);
          addConsoleLine(`Build failed: ${data.error || 'Unknown compilation error'}`, 'error');
          resetSubmitButton();
        }
        
      } catch (err) {
        clearInterval(pollInterval);
        addConsoleLine(`Connection polling failed: ${err.message}`, 'error');
        resetSubmitButton();
      }
    }, 800);
  }

  function resetSubmitButton() {
    btnSubmit.disabled = false;
    btnSpinner.classList.add('hidden');
  }
});
