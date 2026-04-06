require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const neo4j = require('neo4j-driver');
const { OpenAI } = require('openai');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Neo4j Driver
const driver = neo4j.driver(
  process.env.NEO4J_URI || 'neo4j://localhost:7687',
  neo4j.auth.basic(
    process.env.NEO4J_USER || 'neo4j',
    process.env.NEO4J_PASSWORD || 'password'
  ),
  { 
    connectionPoolSize: 10,
    disableLosslessIntegers: true 
  }
);

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Test Neo4j connection
(async () => {
  try {
    const serverInfo = await driver.getServerInfo();
    console.log('✓ Connected to Neo4j:', serverInfo);
  } catch (error) {
    console.error('✗ Failed to connect to Neo4j:', error.message);
  }
})();

/**
 * Query Neo4j database with Cypher query
 */
async function queryNeo4j(cypher, params = {}) {
  const session = driver.session({
    database: process.env.NEO4J_DATABASE || 'neo4j'
  });
  
  try {
    const result = await session.run(cypher, params);
    return result.records.map(record => record.toObject());
  } catch (error) {
    console.error('Neo4j Query Error:', error);
    throw error;
  } finally {
    await session.close();
  }
}

/**
 * Generate Cypher query from natural language using LLM
 */
async function generateCypherQuery(userMessage, schemaInfo) {
  const systemPrompt = `You are an expert Neo4j Cypher query generator. Your task is to convert natural language questions into valid Cypher queries.

Database Schema:
${schemaInfo}

Guidelines:
1. Only generate valid Cypher queries
2. Return ONLY the Cypher query, no explanations
3. Use appropriate relationships and properties from the schema
4. Add LIMIT 10 to prevent excessive results
5. If the question cannot be answered with the given schema, respond with: UNABLE_TO_GENERATE

Never include markdown code blocks or explanations, just the pure Cypher query.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 500
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('OpenAI Error:', error);
    throw new Error('Failed to generate Cypher query');
  }
}

/**
 * Get database schema information
 */
async function getDatabaseSchema() {
  try {
    // Get node labels
    const labelsResult = await queryNeo4j('CALL db.labels()');
    const labels = labelsResult.map(r => r.label);

    // Get relationship types
    const relTypesResult = await queryNeo4j('CALL db.relationshipTypes()');
    const relationshipTypes = relTypesResult.map(r => r.relationshipType);

    // Get sample properties for each label
    let schema = 'Node Labels:\n';
    for (const label of labels.slice(0, 5)) {
      try {
        const propsResult = await queryNeo4j(
          `MATCH (n:\`${label}\`) RETURN keys(properties(n)) as props LIMIT 1`
        );
        const props = propsResult[0]?.props || [];
        schema += `- ${label}: {${props.join(', ')}}\n`;
      } catch (e) {
        schema += `- ${label}\n`;
      }
    }

    schema += '\nRelationship Types:\n';
    relationshipTypes.slice(0, 10).forEach(rt => {
      schema += `- ${rt}\n`;
    });

    return schema;
  } catch (error) {
    console.error('Error getting schema:', error);
    return 'Database schema unavailable';
  }
}

/**
 * Main chat endpoint
 */
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    // Get database schema
    const schema = await getDatabaseSchema();

    // Generate Cypher query from natural language
    const cypherQuery = await generateCypherQuery(message, schema);

    if (cypherQuery === 'UNABLE_TO_GENERATE') {
      return res.json({
        message: 'I cannot generate a query for that request based on the current database schema.',
        cypher: null,
        results: null,
        error: 'Unable to generate Cypher query'
      });
    }

    // Execute the Cypher query
    const results = await queryNeo4j(cypherQuery);

    // Generate a natural language response
    const responsePrompt = `Based on the Neo4j query results below, provide a clear and concise answer to the user's question.

User Question: ${message}

Cypher Query: ${cypherQuery}

Query Results: ${JSON.stringify(results)}

Provide a natural language summary of the results.`;

    const nlResponse = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'user', content: responsePrompt }
      ],
      temperature: 0.7,
      max_tokens: 500
    });

    res.json({
      message: nlResponse.choices[0].message.content,
      cypher: cypherQuery,
      results: results,
      resultCount: results.length
    });

  } catch (error) {
    console.error('Chat Error:', error);
    res.status(500).json({
      error: error.message || 'An error occurred processing your request',
      message: 'I encountered an error while processing your request. Please try again.'
    });
  }
});

/**
 * Health check endpoint
 */
app.get('/api/health', async (req, res) => {
  try {
    const serverInfo = await driver.getServerInfo();
    res.json({
      status: 'ok',
      database: 'connected',
      version: serverInfo.agent
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      database: 'disconnected',
      error: error.message
    });
  }
});

// Serve the frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nClosing database connection...');
  await driver.close();
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Chat Agent Server running on http://localhost:${PORT}`);
  console.log('📊 Press Ctrl+C to stop the server');
});
