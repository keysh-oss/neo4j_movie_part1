# Neo4j Chat Agent - Setup Guide

This guide will help you set up and run the Neo4j Chat Agent application with your local Neo4j instance.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Setup Steps](#setup-steps)
3. [Configuration](#configuration)
4. [Running the Application](#running-the-application)
5. [Verification](#verification)
6. [Security Best Practices](#security-best-practices)

## Prerequisites

Before you start, ensure you have:

- **Node.js**: v14 or higher ([download](https://nodejs.org/))
- **npm**: v6 or higher (comes with Node.js)
- **Neo4j Database**: Running locally (port 7687) or accessible remotely
- **OpenAI API Key**: Get one from [OpenAI Platform](https://platform.openai.com/api-keys)

### Check Prerequisites

```bash
# Check Node.js version
node --version  # Should be v14+

# Check npm version
npm --version   # Should be v6+
```

## Setup Steps

### Step 1: Navigate to Chat Agent Directory

```bash
cd /path/to/recommendations/chat-agent
```

### Step 2: Install Dependencies

```bash
npm install
```

This will install all required packages:
- `express` - Web server framework
- `cors` - Cross-origin request handling
- `dotenv` - Environment variable management
- `neo4j-driver` - Neo4j database driver
- `openai` - OpenAI API client
- `nodemon` - Development server with auto-reload

### Step 3: Create Environment File

Copy the example environment file:

```bash
cp .env.example .env
```

### Step 4: Configure Environment Variables

Edit `.env` with your actual credentials:

```bash
nano .env  # or use your favorite editor
```

Update these values:

```env
# ============ NEO4J CONFIGURATION ============
# For local Neo4j installation
NEO4J_URI=neo4j://localhost:7687

# Neo4j credentials (default for local installation)
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_actual_password_here

# Database name
NEO4J_DATABASE=neo4j

# ============ OPENAI CONFIGURATION ============
# Get this from https://platform.openai.com/api-keys
OPENAI_API_KEY=sk-your_actual_api_key_here

# ============ SERVER CONFIGURATION ============
# Port where the application will run
PORT=5000

# Environment (development or production)
NODE_ENV=development
```

#### Neo4j Connection Examples

**Local Neo4j Instance (Default):**
```env
NEO4J_URI=neo4j://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_password
```

**Neo4j with Authentication:**
```env
NEO4J_URI=neo4j://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=secure_password
```

**Remote Neo4j Instance:**
```env
NEO4J_URI=neo4j+s://your-instance.neo4jlabs.com:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_password
```

## Configuration

### OpenAI API Setup

1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Sign in or create an account
3. Create a new API key
4. Copy the key and paste it in `.env`:

```env
OPENAI_API_KEY=sk-...
```

> ⚠️ **Never share your API key!** It will give anyone access to your OpenAI account.

### Neo4j Connection Verification

Before starting the application, verify your Neo4j connection:

```bash
# Using cypher-shell (if installed)
cypher-shell -u neo4j -p your_password "RETURN 'Connection successful' as result"
```

Or test from Node.js:

```bash
node -e "
const neo4j = require('neo4j-driver');
const driver = neo4j.driver('neo4j://localhost:7687', neo4j.auth.basic('neo4j', 'password'));
driver.getServerInfo().then(info => {
  console.log('✓ Connected:', info.agent);
  driver.close();
}).catch(err => {
  console.error('✗ Connection failed:', err.message);
  process.exit(1);
});
"
```

## Running the Application

### Development Mode (Recommended for Setup)

```bash
npm run dev
```

This uses `nodemon` to auto-reload when you make code changes.

Output should look like:
```
✓ Connected to Neo4j: Neo4j/5.0.0
🚀 Chat Agent Server running on http://localhost:5000
```

### Production Mode

```bash
npm start
```

### Stop the Server

Press `Ctrl + C` in the terminal.

## Verification

### 1. Check Server is Running

Open your browser and navigate to:
```
http://localhost:5000
```

You should see the Neo4j Chat Agent interface.

### 2. Verify Database Connection

Look for the status indicator in the top-right:
- 🟢 **Green dot** = Connected to Neo4j
- 🔴 **Red dot** = Connection failed
- 🟡 **Yellow dot** = Checking connection

### 3. Test a Query

Try asking:
```
Show me 5 nodes from the database
```

The agent should:
1. Generate a Cypher query
2. Execute it
3. Display results in the "Query Details" panel

### 4. Check Logs

Monitor the terminal for any errors:

```
GET http://localhost:5000 200
POST http://localhost:5000/api/chat 200
```

## Troubleshooting

### "Cannot connect to Neo4j"

**Issue**: `Error: Unable to connect to database`

**Solutions**:
```bash
# 1. Verify Neo4j is running
ps aux | grep neo4j

# 2. Check Neo4j port
netstat -an | grep 7687

# 3. Verify credentials by testing connection
cypher-shell -u neo4j -p your_password "RETURN 1"

# 4. Update .env with correct URI
```

### "OpenAI API Error"

**Issue**: `401 Unauthorized` or `No API key`

**Solutions**:
```bash
# 1. Check API key in .env
cat .env | grep OPENAI_API_KEY

# 2. Verify API key is valid at:
# https://platform.openai.com/api-keys

# 3. Check API has available credits
# https://platform.openai.com/account/billing/overview
```

### "Port already in use"

**Issue**: `EADDRINUSE: address already in use :::5000`

**Solutions**:
```bash
# 1. Change port in .env
PORT=5001

# 2. Or kill the process using port 5000
# macOS/Linux:
lsof -ti:5000 | xargs kill -9

# Windows:
netstat -ano | findstr :5000
taskkill /PID <PID> /F
```

### "Module not found"

**Issue**: `Cannot find module 'express'`

**Solutions**:
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

## Security Best Practices

### 1. Environment Variables

✅ **DO:**
- Store `.env` locally and never commit it
- Use `.env.example` for documentation
- Rotate API keys regularly
- Use strong passwords for Neo4j

❌ **DON'T:**
- Commit `.env` to version control
- Share API keys or passwords
- Use default Neo4j credentials in production
- Expose `.env` in logs or error messages

### 2. Database Access

- Create a dedicated Neo4j user for this application
- Restrict permissions to only required databases
- Use `neo4j+s://` (secure connection) for remote databases
- Enable authentication on Neo4j

### 3. API Security

- Keep OpenAI API key private
- Monitor API usage and costs
- Set spending limits in OpenAI account
- Rotate keys periodically

### 4. Deployment

- Use HTTPS in production
- Implement rate limiting
- Add authentication to the web interface
- Validate all user inputs
- Use environment-specific configs

## Next Steps

1. ✅ Install dependencies: `npm install`
2. ✅ Configure `.env` file
3. ✅ Verify Neo4j connection
4. ✅ Verify OpenAI API key
5. ✅ Run the application: `npm run dev`
6. ✅ Visit http://localhost:5000
7. ✅ Start asking questions!

## Support

For issues or questions:

1. Check the [troubleshooting section](#troubleshooting)
2. Review the main [README.md](./README.md)
3. Check the logs in the terminal
4. Verify all environment variables are set correctly

## Resources

- [Neo4j Driver Documentation](https://neo4j.com/docs/driver-manual/current/)
- [OpenAI API Documentation](https://platform.openai.com/docs/api-reference)
- [Express.js Documentation](https://expressjs.com/)
- [Neo4j Cypher Query Language](https://neo4j.com/docs/cypher-manual/current/)
