# Neo4j Chat Agent

A web-based chat interface that uses LLM (OpenAI GPT-4) to convert natural language questions into Cypher queries and execute them against a Neo4j database.

## Features

- 💬 Natural language chat interface
- 🤖 AI-powered Cypher query generation using OpenAI
- 📊 Real-time database query execution
- 🎨 Modern, responsive UI
- 📋 Query details panel showing generated Cypher queries
- 📈 Results display with record inspection
- ✅ Database connection health check
- 📤 File upload panel for CSV/TSV/JSON/Cypher
- 🧠 LLM schema detection (exactly 3 schema options)
- 🗄️ One-click upload to Neo4j with either auto-best schema or user-selected analyzed schema

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Neo4j database instance running locally or remotely
- OpenAI API key

## Installation

1. **Install dependencies:**

```bash
cd chat-agent
npm install
```

2. **Create `.env` file:**

Copy `.env.example` to `.env` and update with your configuration:

```bash
cp .env.example .env
```

3. **Configure environment variables:**

Edit `.env` with your credentials:

```env
# Neo4j Configuration
NEO4J_URI=neo4j://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_neo4j_password
NEO4J_DATABASE=neo4j

# OpenAI Configuration
OPENAI_API_KEY=sk-your-openai-api-key-here

# Server Configuration
PORT=5000
NODE_ENV=development

```

## Running the Application

### Development Mode

```bash
npm run dev
```

This uses `nodemon` for auto-reload on file changes.

### Production Mode

```bash
npm start
```

The server will start on `http://localhost:5000` (or the configured PORT).

## Usage

1. Open your browser and navigate to `http://localhost:5000`
2. Wait for the database connection to be established (green status indicator)
3. Type your question in natural language, e.g.:
   - "Find all movies from 2020"
   - "Show actors who worked with Tom Hanks"
   - "What are the highest rated movies?"
4. Press Enter or click the Send button
5. The agent will:
   - Generate a Cypher query
   - Execute it against Neo4j
   - Return results in natural language
   - Display the query and results in the sidebar

## API Endpoints

### POST `/api/chat`

Submit a natural language question and get results.

**Request:**
```json
{
  "message": "Find all movies released in 2020"
}
```

**Response:**
```json
{
  "message": "Natural language response with results",
  "cypher": "MATCH (m:Movie {year: 2020}) RETURN m LIMIT 10",
  "results": [
    { "m": { "title": "Movie Title", "year": 2020 } }
  ],
  "resultCount": 1
}
```

### GET `/api/health`

Check database connection status.

**Response:**
```json
{
  "status": "ok",
  "database": "connected",
  "version": "Neo4j/5.0.0"
}
```

### POST `/api/upload/analyze`

Upload a file and get LLM-detected schema options.

**Form Data:**
- `dataFile`: CSV, TSV, JSON, or `.cypher/.cql` file

**Response (example):**
```json
{
  "fileName": "people.json",
  "fileType": "json",
  "previewCount": 2,
  "detectedSummary": "The data represents users with birth dates.",
  "schemaOptions": [
    {
      "id": "schema_1",
      "title": "User Birthdates",
      "nodeLabel": "User",
      "description": "User nodes with birth info",
      "keyFields": ["id", "name"],
      "dateFields": ["born"],
      "relationshipIdeas": ["(:User)-[:FRIEND]->(:User)"]
    }
  ]
}
```

### POST `/api/upload/ingest`

Imports the previously analyzed file into Neo4j using selected schema.

- CSV/TSV/JSON: creates multi-node graph structures and relationships based on selected schema `graphModel`
- Cypher: executes statements

**Request:**
```json
{
  "schemaId": "schema_1"
}
```

**Response (example):**
```json
{
  "message": "Upload complete. 2 nodes created with label User.",
  "importedCount": 2,
  "schemaUsed": {
    "id": "schema_1",
    "nodeLabel": "User"
  }
}
```

## Architecture

### Backend (server.js)

- **Express.js**: Web server and API
- **neo4j-driver**: Neo4j database connection
- **OpenAI**: LLM for query generation and response synthesis
- **CORS**: Cross-origin request handling

### Frontend (public/)

- **index.html**: Chat interface layout
- **styles.css**: Dark theme styling
- **script.js**: Client-side logic and API communication

## How It Works

1. **Query Generation**: The user's natural language question is sent to OpenAI GPT-4 along with the database schema
2. **Database Schema Extraction**: The app fetches node labels, relationship types, and sample properties
3. **Cypher Query Creation**: GPT-4 generates a valid Cypher query based on the question and schema
4. **Query Execution**: The generated query is executed against the Neo4j database
5. **Response Synthesis**: The results are sent back to GPT-4 to generate a natural language response
6. **Display**: Both the query and results are displayed to the user

### Upload + Schema workflow

1. User selects a CSV/TSV/JSON/Cypher file in the upload panel
2. App sends the file to `/api/upload/analyze`
3. LLM returns exactly 3 schema options with labels/key fields/date fields
4. User either:
  - clicks **Upload to Neo4j** directly (auto-best schema), or
  - clicks **Analyze Schema**, selects one option, then clicks **Upload to Neo4j**
5. App calls `/api/upload/ingest` and imports data into Neo4j
6. If user asks for “schema” in chat, app can answer from the latest uploaded file's schema options

## Security Considerations

⚠️ **Important:** This application handles sensitive information:

- **Database Credentials**: Store in `.env` file (never commit)
- **API Keys**: Keep OpenAI API key private
- **Database Access**: Restrict Neo4j database access from the web

Make sure to:
- Never commit `.env` file to version control
- Use environment variables for all sensitive data
- Implement authentication/authorization in production
- Validate all user inputs
- Use HTTPS in production
- Restrict database user permissions

## Troubleshooting

### Connection Error

If you see "Database Disconnected":
- Check Neo4j is running
- Verify `NEO4J_URI`, `NEO4J_USER`, and `NEO4J_PASSWORD` in `.env`
- Check network connectivity

### OpenAI API Error

If you get OpenAI errors:
- Verify `OPENAI_API_KEY` is correct
- Check you have API credits available
- Ensure you're using a supported model (gpt-4 or gpt-3.5-turbo)

### Cypher Generation Fails

If queries aren't being generated:
- Check the database has data and labels
- Try more specific questions
- Check OpenAI model compatibility

## Performance Tips

- Use `LIMIT` in generated queries to prevent large results
- Index frequently queried properties in Neo4j
- Consider caching schema information
- Use connection pooling (already configured)

## Future Enhancements

- [ ] User authentication
- [ ] Query history/conversation memory
- [ ] Support for custom database schemas
- [ ] Export results to CSV/JSON
- [ ] Rate limiting and usage tracking
- [ ] Multi-language support
- [ ] Improved error handling and logging

## License

ISC

## stop the process
pkill -f "node server.js" || pkill -f "nodemon" || true

## start the server

cd /Users/keysh/Downloads/neo4j_movie/neo4j_movie_part1/chat-agent && echo "Current directory: $(pwd)" && npm run dev
