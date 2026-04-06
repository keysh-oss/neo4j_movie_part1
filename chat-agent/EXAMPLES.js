// Example: Using the Neo4j Chat Agent API

// ============================================
// Example 1: Using fetch (Browser JavaScript)
// ============================================

async function askQuestion(question) {
  try {
    const response = await fetch('http://localhost:5000/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: question })
    });

    const data = await response.json();
    
    console.log('Response:', data.message);
    console.log('Cypher Query:', data.cypher);
    console.log('Results:', data.results);
    console.log('Count:', data.resultCount);
    
    return data;
  } catch (error) {
    console.error('Error:', error);
  }
}

// Usage:
// askQuestion('Find all movies from 2020');


// ============================================
// Example 2: Using Node.js (axios)
// ============================================

const axios = require('axios');

async function askQuestionNode(question) {
  try {
    const response = await axios.post('http://localhost:5000/api/chat', {
      message: question
    });

    console.log('Response:', response.data.message);
    console.log('Cypher Query:', response.data.cypher);
    console.log('Results Count:', response.data.resultCount);
    
    return response.data;
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

// Usage:
// await askQuestionNode('Show me top rated movies');


// ============================================
// Example 3: Using curl (Terminal)
// ============================================

/*
curl -X POST http://localhost:5000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Find all movies from 2020"}'

Example output:
{
  "message": "Found 15 movies released in 2020...",
  "cypher": "MATCH (m:Movie {year: 2020}) RETURN m LIMIT 10",
  "results": [
    { "m": { "title": "Movie 1", "year": 2020 } },
    { "m": { "title": "Movie 2", "year": 2020 } }
  ],
  "resultCount": 2
}
*/


// ============================================
// Example 4: Checking Server Health
// ============================================

async function checkHealth() {
  try {
    const response = await fetch('http://localhost:5000/api/health');
    const data = await response.json();
    
    if (data.status === 'ok') {
      console.log(`✓ Connected to ${data.version}`);
    } else {
      console.log('✗ Database disconnected');
    }
    
    return data;
  } catch (error) {
    console.error('✗ Server not running:', error);
  }
}

// Usage:
// await checkHealth();


// ============================================
// Example 5: Handling Different Question Types
// ============================================

const questions = [
  // Statistical queries
  "How many movies are in the database?",
  "What's the average rating of all movies?",
  
  // Search queries
  "Find movies with 'Marvel' in the title",
  "Show me movies directed by Christopher Nolan",
  
  // Relationship queries
  "Which actors have worked with Tom Hanks?",
  "Show me all movies in the Action genre",
  
  // Pattern queries
  "Find the shortest path between two actors",
  "Show me actors who have won awards",
  
  // Temporal queries
  "What movies came out in 2023?",
  "Show me the most recent movies"
];

// Example: Process all questions
async function processAllQuestions() {
  for (const question of questions) {
    console.log(`\n📝 Question: ${question}`);
    try {
      const result = await askQuestion(question);
      console.log(`✓ Answer: ${result.message.substring(0, 100)}...`);
      console.log(`📊 Results: ${result.resultCount} records`);
    } catch (error) {
      console.error(`✗ Error: ${error.message}`);
    }
    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}


// ============================================
// Example 6: Building a Conversational Loop
// ============================================

const readline = require('readline');

async function interactiveChat() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt) => {
    return new Promise(resolve => {
      rl.question(prompt, resolve);
    });
  };

  console.log('🤖 Neo4j Chat Agent');
  console.log('Type "exit" to quit\n');

  while (true) {
    const userInput = await question('You: ');
    
    if (userInput.toLowerCase() === 'exit') {
      console.log('Goodbye! 👋');
      rl.close();
      break;
    }

    try {
      const result = await askQuestionNode(userInput);
      console.log(`\nAgent: ${result.message}\n`);
    } catch (error) {
      console.log(`\n❌ Error: ${error.message}\n`);
    }
  }
}

// Usage:
// await interactiveChat();


// ============================================
// Example 7: Error Handling
// ============================================

async function robustQuestion(question, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch('http://localhost:5000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question }),
        timeout: 10000
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.message);
      
      if (attempt < retries) {
        console.log(`Retrying in 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        throw new Error(`Failed after ${retries} attempts`);
      }
    }
  }
}

// Usage:
// try {
//   const result = await robustQuestion('Find movies from 2020', 3);
//   console.log(result);
// } catch (error) {
//   console.error('Final error:', error.message);
// }


// ============================================
// Example 8: Response Types & Parsing
// ============================================

function parseResponse(data) {
  const {
    message,      // Natural language response
    cypher,       // Generated Cypher query
    results,      // Query results array
    resultCount,  // Number of results
    error         // Error message if any
  } = data;

  // Check for errors
  if (error) {
    return {
      success: false,
      error: error,
      message: message
    };
  }

  // Parse results based on query type
  if (cypher.includes('COUNT')) {
    return {
      success: true,
      type: 'count',
      value: results[0] ? Object.values(results[0])[0] : 0,
      message: message
    };
  }

  if (cypher.includes('RETURN DISTINCT')) {
    return {
      success: true,
      type: 'list',
      items: results.map(r => Object.values(r)[0]),
      message: message
    };
  }

  // Default: node/relationship results
  return {
    success: true,
    type: 'nodes',
    results: results,
    count: resultCount,
    message: message
  };
}

// Usage:
// const response = await askQuestion('Find all movies');
// const parsed = parseResponse(response);
// console.log(`Query type: ${parsed.type}`);
// console.log(`Results: ${parsed.count}`);


// ============================================
// Export functions for use in other modules
// ============================================

module.exports = {
  askQuestion: askQuestionNode,
  checkHealth,
  robustQuestion,
  parseResponse,
  interactiveChat
};
