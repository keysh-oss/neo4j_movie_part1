// API base URL
const API_BASE_URL = window.location.origin;

// DOM Elements
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const chatForm = document.getElementById('chatForm');
const loadingIndicator = document.getElementById('loadingIndicator');
const statusIndicator = document.getElementById('statusIndicator');
const queryDetails = document.getElementById('queryDetails');
const dataFileInput = document.getElementById('dataFileInput');
const analyzeFileButton = document.getElementById('analyzeFileButton');
const uploadFileButton = document.getElementById('uploadFileButton');
const schemaSummary = document.getElementById('schemaSummary');
const schemaModal = document.getElementById('schemaModal');
const schemaModalHint = document.getElementById('schemaModalHint');
const schemaModalOptions = document.getElementById('schemaModalOptions');
const closeSchemaModalButton = document.getElementById('closeSchemaModalButton');
const confirmSchemaSelectionButton = document.getElementById('confirmSchemaSelectionButton');
const toggleUploadPanelButton = document.getElementById('toggleUploadPanelButton');
const toggleQueryDetailsButton = document.getElementById('toggleQueryDetailsButton');

const uploadPanelContainer = dataFileInput?.closest('.panel') || null;
const queryDetailsContainer = queryDetails?.closest('.panel') || null;

let analyzedSchemaOptions = [];
let selectedSchemaId = null;
let analyzedFileKey = null;

function getCurrentFileKey(file) {
    if (!file) return null;
    return `${file.name}::${file.size}::${file.lastModified}`;
}

/**
 * Format JSON for display
 */
function formatJSON(data) {
    return JSON.stringify(data, null, 2);
}

/**
 * Check connection status
 */
async function checkConnection() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/health`);
        const data = await response.json();

        if (data.status === 'ok') {
            updateStatus(true, `Connected (${data.version})`);
            enableInput();
        } else {
            updateStatus(false, 'Database Disconnected');
            disableInput();
        }
    } catch (error) {
        updateStatus(false, 'Connection Error');
        disableInput();
        console.error('Health check failed:', error);
    }
}

/**
 * Update status indicator
 */
function updateStatus(isConnected, message) {
    const dot = statusIndicator.querySelector('.status-dot');
    const text = statusIndicator.querySelector('.status-text');

    if (isConnected) {
        dot.classList.add('connected');
        dot.classList.remove('disconnected');
    } else {
        dot.classList.add('disconnected');
        dot.classList.remove('connected');
    }

    text.textContent = message;
}

/**
 * Enable input
 */
function enableInput() {
    messageInput.disabled = false;
    sendButton.disabled = false;
}

/**
 * Disable input
 */
function disableInput() {
    messageInput.disabled = true;
    sendButton.disabled = true;
}

/**
 * Send message
 */
async function sendMessage(event) {
    event.preventDefault();

    const message = messageInput.value.trim();
    if (!message) return;

    // Add user message to chat
    addMessageToChat(message, 'user');
    messageInput.value = '';

    // Show loading indicator
    showLoading(true);

    try {
        const response = await fetch(`${API_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // Display bot response
        addMessageToChat(data.message, 'bot');

        // Display query details
        if (data.cypher) {
            displayQueryDetails(data.cypher, data.resultCount);
        }

        // Scroll to bottom
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

    } catch (error) {
        console.error('Error:', error);
        addMessageToChat(
            `⚠️ Error: ${error.message || 'An unexpected error occurred. Please try again.'}`,
            'bot'
        );
    } finally {
        showLoading(false);
        messageInput.focus();
    }
}

/**
 * Add message to chat
 */
function addMessageToChat(text, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    contentDiv.textContent = text;

    messageDiv.appendChild(contentDiv);
    messagesContainer.appendChild(messageDiv);

    // Auto-scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * Display query details
 */
function displayQueryDetails(cypher, resultCount) {
    queryDetails.innerHTML = `
        <div>
            <p><strong>Generated Cypher Query:</strong></p>
            <code>${escapeHtml(cypher)}</code>
            <p style="margin-top: 0.75rem; font-size: 0.85em;">
                <strong>Results:</strong> ${resultCount || 0} record(s)
            </p>
        </div>
    `;
    setPanelCollapsed(queryDetailsContainer, toggleQueryDetailsButton, false);
}

function setPanelCollapsed(panelEl, toggleButton, collapsed) {
    if (!panelEl || !toggleButton) return;
    panelEl.classList.toggle('collapsed', collapsed);
    toggleButton.setAttribute('aria-expanded', String(!collapsed));
    toggleButton.textContent = collapsed ? '▸' : '▾';
}

function togglePanel(panelEl, toggleButton) {
    if (!panelEl || !toggleButton) return;
    const isCollapsed = panelEl.classList.contains('collapsed');
    setPanelCollapsed(panelEl, toggleButton, !isCollapsed);
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Show/hide loading indicator
 */
function showLoading(show) {
    if (show) {
        loadingIndicator.classList.remove('hidden');
    } else {
        loadingIndicator.classList.add('hidden');
    }
}

function openSchemaModal() {
    schemaModal.classList.remove('hidden');
}

function closeSchemaModal() {
    schemaModal.classList.add('hidden');
}

function renderSchemaOptionsInModal(options = [], fileName = '') {
    analyzedSchemaOptions = options;
    selectedSchemaId = null;

    if (!options.length) {
        schemaModalOptions.innerHTML = '<p class="muted">No schema options available.</p>';
        uploadFileButton.disabled = true;
        return;
    }

    schemaModalHint.textContent = fileName
        ? `Choose one schema option for ${fileName}.`
        : 'Choose one schema option to use for upload.';

    schemaModalOptions.innerHTML = options.map((option, index) => {
        const keyFields = (option.keyFields || []).join(', ') || 'N/A';
        const nodeSummary = Array.isArray(option.graphModel?.nodes) && option.graphModel.nodes.length
            ? option.graphModel.nodes.map(node => node.label).join(', ')
            : option.nodeLabel || 'N/A';

        const relationshipSummary = Array.isArray(option.graphModel?.relationships) && option.graphModel.relationships.length
            ? option.graphModel.relationships.map(rel => `${rel.from}-[:${rel.type}]->${rel.to}`).join(' | ')
            : (option.relationshipIdeas || []).join(' | ') || 'N/A';

        return `
            <label class="schema-option">
                <input type="radio" name="schemaOption" value="${escapeHtml(option.id)}" ${index === 0 ? 'checked' : ''}>
                <div>
                    <strong>${escapeHtml(option.title)}</strong>
                    <p><span class="chip">Nodes: ${escapeHtml(nodeSummary)}</span></p>
                    <p>${escapeHtml(option.description || '')}</p>
                    <p class="tiny">Key fields: ${escapeHtml(keyFields)}</p>
                    <p class="tiny">Relationships: ${escapeHtml(relationshipSummary)}</p>
                </div>
            </label>
        `;
    }).join('');

    selectedSchemaId = options[0]?.id || null;
    openSchemaModal();
}

function getSelectedSchemaId() {
    const selected = schemaModalOptions.querySelector('input[name="schemaOption"]:checked');
    return selected?.value;
}

function confirmSchemaSelection() {
    const schemaId = getSelectedSchemaId();
    if (!schemaId) {
        addMessageToChat('⚠️ Please choose a schema option.', 'bot');
        return;
    }

    selectedSchemaId = schemaId;
    uploadFileButton.disabled = false;
    closeSchemaModal();
    addMessageToChat('✅ Schema option selected. You can now click Upload to Neo4j.', 'bot');
}

async function analyzeUploadedFile() {
    const file = dataFileInput.files?.[0];
    if (!file) {
        addMessageToChat('⚠️ Please select a file before analyzing.', 'bot');
        return;
    }

    showLoading(true);
    uploadFileButton.disabled = false;

    try {
        const data = await analyzeFile(file);

        schemaSummary.textContent = `${data.fileName} (${data.fileType}) analyzed. ${data.detectedSummary}`;
        renderSchemaOptionsInModal(data.schemaOptions || [], data.fileName);
        addMessageToChat(`✅ Schema analysis complete for ${data.fileName}. Choose one of the 3 options and then click "Upload to Neo4j".`, 'bot');
    } catch (error) {
        console.error(error);
        schemaSummary.textContent = `Analysis failed: ${error.message}`;
        analyzedSchemaOptions = [];
        selectedSchemaId = null;
        analyzedFileKey = null;
        uploadFileButton.disabled = true;
        addMessageToChat(`⚠️ ${error.message}`, 'bot');
    } finally {
        showLoading(false);
    }
}

async function analyzeFile(file) {
    const formData = new FormData();
    formData.append('dataFile', file);

    const response = await fetch(`${API_BASE_URL}/api/upload/analyze`, {
        method: 'POST',
        body: formData
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to analyze file');

    analyzedSchemaOptions = data.schemaOptions || [];
    analyzedFileKey = getCurrentFileKey(file);
    return data;
}

async function uploadSelectedSchemaToNeo4j() {
    const file = dataFileInput.files?.[0];
    if (!file) {
        addMessageToChat('⚠️ Please upload/select a file first.', 'bot');
        return;
    }

    showLoading(true);

    try {
        const currentFileKey = getCurrentFileKey(file);

        // If this file was not analyzed in current session, analyze silently and rely on auto-best schema
        if (analyzedFileKey !== currentFileKey || !analyzedSchemaOptions.length) {
            const data = await analyzeFile(file);
            schemaSummary.textContent = `${data.fileName} (${data.fileType}) analyzed. ${data.detectedSummary}`;
            selectedSchemaId = null;
        }

        const response = await fetch(`${API_BASE_URL}/api/upload/ingest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: selectedSchemaId ? JSON.stringify({ schemaId: selectedSchemaId }) : JSON.stringify({})
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Upload failed');

        addMessageToChat(`✅ ${data.message}`, 'bot');
        queryDetails.innerHTML = `
            <p><strong>Last Upload Summary</strong></p>
            <code>${escapeHtml(formatJSON({ importedCount: data.importedCount, relationshipsCreated: data.relationshipsCreated || 0, schemaSelectionMode: data.schemaSelectionMode, schemaUsed: data.schemaUsed }))}</code>
        `;
        setPanelCollapsed(queryDetailsContainer, toggleQueryDetailsButton, false);
    } catch (error) {
        console.error(error);
        addMessageToChat(`⚠️ ${error.message}`, 'bot');
    } finally {
        showLoading(false);
    }
}

// Event listeners
chatForm.addEventListener('submit', sendMessage);
analyzeFileButton?.addEventListener('click', analyzeUploadedFile);
uploadFileButton?.addEventListener('click', uploadSelectedSchemaToNeo4j);
dataFileInput?.addEventListener('change', () => {
    const file = dataFileInput.files?.[0];
    selectedSchemaId = null;
    analyzedSchemaOptions = [];
    analyzedFileKey = null;
    closeSchemaModal();

    if (file) {
        schemaSummary.textContent = `${file.name} selected. Click "Upload to Neo4j" for auto-best schema, or click "Analyze Schema" to choose from 3 options.`;
        uploadFileButton.disabled = false;
    } else {
        schemaSummary.textContent = 'No file analyzed yet.';
        uploadFileButton.disabled = true;
    }
});
toggleUploadPanelButton?.addEventListener('click', () => togglePanel(uploadPanelContainer, toggleUploadPanelButton));
toggleQueryDetailsButton?.addEventListener('click', () => togglePanel(queryDetailsContainer, toggleQueryDetailsButton));
closeSchemaModalButton?.addEventListener('click', closeSchemaModal);
confirmSchemaSelectionButton?.addEventListener('click', confirmSchemaSelection);
schemaModal?.addEventListener('click', (event) => {
    if (event.target === schemaModal) {
        closeSchemaModal();
    }
});

// Allow Enter key to send message (Shift+Enter for new line)
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(new Event('submit'));
    }
});

// Check connection on page load
document.addEventListener('DOMContentLoaded', () => {
    setPanelCollapsed(uploadPanelContainer, toggleUploadPanelButton, false);
    setPanelCollapsed(queryDetailsContainer, toggleQueryDetailsButton, false);
    checkConnection();
    // Re-check connection every 30 seconds
    setInterval(checkConnection, 30000);
});
