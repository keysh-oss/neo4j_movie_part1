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

CRITICAL RULES FOR DIFFERENT DATA TYPES:

1. DATE/TEMPORAL QUERIES:
   - NEVER use property matching like {born: {year: 1951}} - this is INVALID
   - Always use WHERE clause with date functions for date filtering
   - Examples:
     * "directors born in 1951" → MATCH (d:Director) WHERE date(d.born).year = 1951 RETURN d.name
     * "movies released after 2020" → MATCH (m:Movie) WHERE m.released > date('2020-01-01') RETURN m.title
     * "actors born in 1990s" → MATCH (a:Actor) WHERE date(a.born).year >= 1990 AND date(a.born).year < 2000 RETURN a.name

2. STRING/TEXT PROPERTIES:
   - Use this format: (n:Label {property: 'value'})
   - For partial matches use WHERE with CONTAINS or STARTS WITH
   - Example: MATCH (m:Movie) WHERE m.title CONTAINS 'Matrix' RETURN m.title

3. NUMERIC PROPERTIES:
   - Filter in WHERE clause: WHERE n.age > 30
   - Or in property match: (p:Person {status: 'active'})

4. RETURN CLAUSE:
   - Always return specific properties you want to display
   - Don't return the entire node unless necessary
   - Example: RETURN d.name, d.born, d.birthPlace

Database Schema:
${schemaInfo}

Guidelines:
1. Only generate valid Cypher queries
2. Return ONLY the Cypher query, no explanations or code blocks
3. Use WHERE clause for complex filtering, especially dates and numbers
4. Add LIMIT 10 to prevent excessive results
5. Always check if a property is a DATE/TEMPORAL type - use date() functions
6. Use backticks for reserved words: \`User\`, \`year\`
7. If the question cannot be answered with the given schema, respond with: UNABLE_TO_GENERATE

EXAMPLES OF CORRECT PATTERNS:
- Year filtering: WHERE date(n.dateProperty).year = 2023
- Range filtering: WHERE n.numericProperty >= 100 AND n.numericProperty <= 500
- Text matching: WHERE n.textProperty = 'exact' OR n.textProperty CONTAINS 'partial'
- Date range: WHERE n.dateProperty >= date('2020-01-01') AND n.dateProperty <= date('2020-12-31')

Never use nested object syntax like {born: {year: 1951}} - it will not work in Neo4j Cypher.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.2,
      max_tokens: 500
    });

    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('OpenAI Error:', error);
    throw new Error('Failed to generate Cypher query');
  }
}

/**
 * Get database schema information with detailed properties
 */
async function getDatabaseSchema() {
  try {
    // Get node labels
    const labelsResult = await queryNeo4j('CALL db.labels()');
    const labels = labelsResult.map(r => r.label);

    // Get relationship types
    const relTypesResult = await queryNeo4j('CALL db.relationshipTypes()');
    const relationshipTypes = relTypesResult.map(r => r.relationshipType);

    // Get detailed schema for each label with sample data
    let schema = 'NODE LABELS AND PROPERTIES:\n';
    schema += '================================\n';
    
    for (const label of labels.slice(0, 10)) {
      try {
        // Get property information
        const propsResult = await queryNeo4j(
          `MATCH (n:\`${label}\`) RETURN keys(properties(n)) as props, properties(n) as sample LIMIT 1`
        );
        
        if (propsResult.length > 0) {
          const props = propsResult[0]?.props || [];
          const sample = propsResult[0]?.sample || {};
          
          schema += `\nLabel: ${label}\n`;
          schema += `Properties and Types:\n`;
          
          // Detect property types from sample data
          props.forEach(prop => {
            const value = sample[prop];
            let type = 'Unknown';
            
            if (value === null || value === undefined) {
              type = 'Mixed/Nullable';
            } else if (typeof value === 'string') {
              // Check if it looks like a date
              if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
                type = 'DATE/STRING';
              } else {
                type = 'STRING';
              }
            } else if (typeof value === 'number') {
              type = 'NUMBER/INTEGER';
            } else if (typeof value === 'boolean') {
              type = 'BOOLEAN';
            } else if (typeof value === 'object') {
              // Could be a date object or other object
              if (value.toString().includes('Date')) {
                type = 'DATE/TEMPORAL';
              } else {
                type = 'OBJECT';
              }
            }
            
            schema += `  - ${prop} (${type}): ${String(value).substring(0, 50)}\n`;
          });
        }
      } catch (e) {
        schema += `\nLabel: ${label}\n`;
      }
    }

    schema += '\n\nRELATIONSHIP TYPES:\n';
    schema += '====================\n';
    relationshipTypes.slice(0, 15).forEach(rt => {
      schema += `- :${rt}\n`;
    });

    // Add relationship details
    schema += '\n\nRELATIONSHIP STRUCTURE:\n';
    schema += '=======================\n';
    try {
      const relInfo = await queryNeo4j(
        `CALL db.relationshipTypes() YIELD relationshipType
         MATCH ()-[r]->() WHERE type(r) = relationshipType LIMIT 1
         RETURN relationshipType, keys(properties(r)) as props`
      );
      
      relInfo.forEach(rel => {
        schema += `${rel.relationshipType}: [${rel.props?.join(', ') || 'no properties'}]\n`;
      });
    } catch (e) {
      // Fallback if above doesn't work
    }

    schema += '\n\nIMPORTANT NOTES:\n';
    schema += '=================\n';
    schema += '- For DATE properties, use: WHERE date(n.dateProperty).year = YYYY\n';
    schema += '- For DATE RANGE queries, use: WHERE n.dateProperty >= date("YYYY-MM-DD") AND n.dateProperty <= date("YYYY-MM-DD")\n';
    schema += '- For NUMERIC comparisons, use: WHERE n.numericProperty > value OR n.numericProperty < value\n';
    schema += '- Always use WHERE clause for filtering, not property matching\n';

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

    // Generate a natural language response with better context
    const responsePrompt = `Based on the Neo4j query results below, provide a clear and concise answer to the user's question.
Extract and display the specific property values from the results.

User Question: ${message}

Cypher Query: ${cypherQuery}

Query Results (${results.length} records):
${JSON.stringify(results, null, 2)}

Guidelines:
1. List the key properties found in the results
2. Highlight any important relationships or connections
3. If multiple results, summarize them clearly
4. Include specific values/properties in your answer
5. Keep the response concise but informative

Provide a natural language summary of the results with specific property values.`;

    const nlResponse = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'user', content: responsePrompt }
      ],
      temperature: 0.5,
      max_tokens: 800
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
