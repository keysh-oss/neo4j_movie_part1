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
const resultsPanel = document.getElementById('resultsPanel');

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

        // Display results
        if (data.results && data.results.length > 0) {
            displayResults(data.results);
        } else if (data.results) {
            displayResults(data.results);
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
}

/**
 * Display results
 */
function displayResults(results) {
    if (!results || results.length === 0) {
        resultsPanel.innerHTML = '<p style="color: #999;">No results returned</p>';
        return;
    }

    let html = `<p><strong>Records: ${results.length}</strong></p>`;

    results.slice(0, 5).forEach((record, index) => {
        html += `<details style="margin-top: 0.5rem;">
            <summary style="cursor: pointer; padding: 0.5rem; background-color: var(--dark-bg); border-radius: 4px;">Record ${index + 1}</summary>
            <pre style="margin-top: 0.5rem; font-size: 0.75em; background-color: var(--dark-bg); padding: 0.5rem; border-radius: 4px; overflow-x: auto;">${escapeHtml(formatJSON(record))}</pre>
        </details>`;
    });

    if (results.length > 5) {
        html += `<p style="margin-top: 0.75rem; font-size: 0.85em; color: var(--text-secondary);">
            ... and ${results.length - 5} more record(s)
        </p>`;
    }

    resultsPanel.innerHTML = html;
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

// Event listeners
chatForm.addEventListener('submit', sendMessage);

// Allow Enter key to send message (Shift+Enter for new line)
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(new Event('submit'));
    }
});

// Check connection on page load
document.addEventListener('DOMContentLoaded', () => {
    checkConnection();
    // Re-check connection every 30 seconds
    setInterval(checkConnection, 30000);
});
