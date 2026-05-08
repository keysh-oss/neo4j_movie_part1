require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const neo4j = require('neo4j-driver');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { OpenAI } = require('openai');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

let latestUploadContext = null;

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
   - If the value includes time (e.g., 2026-03-01 09:00), use datetime(...) and convert space to T
   - NEVER use date('YYYY-MM-DD HH:mm') because that causes parse errors; use datetime('YYYY-MM-DDTHH:mm')
   - Examples:
     * "directors born in 1951" → MATCH (d:Director) WHERE date(d.born).year = 1951 RETURN d.name
     * "movies released after 2020" → MATCH (m:Movie) WHERE m.released > date('2020-01-01') RETURN m.title
     * "actors born in 1990s" → MATCH (a:Actor) WHERE date(a.born).year >= 1990 AND date(a.born).year < 2000 RETURN a.name
     * "incidents created at 2026-03-01 09:00" → MATCH (i:Incident) WHERE datetime(i.created_at) >= datetime('2026-03-01T09:00') RETURN i.incident_id

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
8. IMPORTANT: Follow the actual relationship topology from schemaInfo; do NOT invent paths such as (Incident)-[:HAS_STATUS]->(Status) unless that edge exists in schemaInfo.
9. If user asks with domain words (e.g., "incident status") but schema links status to another label, use the real connected label path from schemaInfo.
10. For status filters, prefer case-insensitive matching: WHERE toLower(statusProperty) = 'open'

EXAMPLES OF CORRECT PATTERNS:
- Year filtering: WHERE date(n.dateProperty).year = 2023
- Range filtering: WHERE n.numericProperty >= 100 AND n.numericProperty <= 500
- Text matching: WHERE n.textProperty = 'exact' OR n.textProperty CONTAINS 'partial'
- Date range: WHERE n.dateProperty >= date('2020-01-01') AND n.dateProperty <= date('2020-12-31')
- Topology-first filtering: if schema has (System)-[:HAS_STATUS]->(Status), query open systems as:
  MATCH (sys:System)-[:HAS_STATUS]->(st:Status)
  WHERE toLower(st.status) = 'open'
  RETURN sys.affected_system
  LIMIT 10

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

function normalizeTemporalLiteralsInCypher(cypherQuery = '') {
  let query = String(cypherQuery || '').trim();
  if (!query) return query;

  // Any quoted datetime-like literal 'YYYY-MM-DD HH:mm[:ss]' -> 'YYYY-MM-DDTHH:mm[:ss]'
  query = query.replace(
    /(['"])(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}(?::\d{2})?)\1/g,
    '$1$2T$3$1'
  );

  // date('YYYY-MM-DD HH:mm[:ss]') -> datetime('YYYY-MM-DDTHH:mm[:ss]')
  query = query.replace(
    /date\((['"])(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\1\)/gi,
    "datetime($1$2T$3$1)"
  );

  // datetime('YYYY-MM-DD HH:mm[:ss]') -> datetime('YYYY-MM-DDTHH:mm[:ss]')
  query = query.replace(
    /datetime\((['"])(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}(?::\d{2})?)\1\)/gi,
    "datetime($1$2T$3$1)"
  );

  // datetime(node.property) -> datetime(replace(toString(node.property), ' ', 'T'))
  // This protects against source values stored as 'YYYY-MM-DD HH:mm'.
  query = query.replace(
    /datetime\(\s*([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*)\s*\)/g,
    "datetime(replace(toString($1), ' ', 'T'))"
  );

  return query;
}

function buildLocalResponseSummary(results = []) {
  if (!Array.isArray(results) || !results.length) {
    return 'No matching records were found for this query.';
  }

  const first = results[0] || {};
  const keys = Object.keys(first);
  const preview = results.slice(0, 5).map(row => JSON.stringify(row)).join('\n');

  return `Found ${results.length} record(s).${keys.length ? ` Fields: ${keys.join(', ')}.` : ''}\n\nPreview:\n${preview}`;
}

function extractAffectedSystemsByStatusIntent(message = '') {
  const text = String(message || '').toLowerCase().trim();
  const asksAffectedSystems = /affected\s*systems?|systems?\s+affected|impacted\s*systems?|systems?\s+impacted/.test(text);
  const asksStatus = /status|state/.test(text);
  if (!asksAffectedSystems || !asksStatus) return null;

  const knownStatuses = ['open', 'resolved', 'closed', 'pending', 'in progress', 'investigating', 'active'];
  const knownMatch = knownStatuses.find(status => text.includes(status));
  if (knownMatch) return knownMatch;

  const patterns = [
    /status\s*(?:is|=|:)?\s*['\"]?([a-z][a-z0-9 _-]{1,30})['\"]?/i,
    /([a-z][a-z0-9 _-]{1,30})\s+(?:incident\s+)?status/i,
    /status\s+of\s+([a-z][a-z0-9 _-]{1,30})/i
  ];

  const stopwords = new Set(['incident', 'incidents', 'system', 'systems', 'affected', 'by', 'the', 'with', 'for']);

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;

    const candidate = match[1].trim().replace(/\s+/g, ' ');
    if (!candidate || stopwords.has(candidate)) continue;
    return candidate;
  }

  return null;
}

function extractStatusValueFromMessage(message = '') {
  const text = String(message || '').toLowerCase().trim();
  const knownStatuses = ['open', 'resolved', 'closed', 'pending', 'in progress', 'investigating', 'active'];
  const knownMatch = knownStatuses.find(status => text.includes(status));
  if (knownMatch) return knownMatch;

  const patterns = [
    /status\s*(?:is|=|:)?\s*['\"]?([a-z][a-z0-9 _-]{1,30})['\"]?/i,
    /([a-z][a-z0-9 _-]{1,30})\s+(?:incident\s+)?status/i,
    /status\s+of\s+([a-z][a-z0-9 _-]{1,30})/i
  ];

  const stopwords = new Set(['incident', 'incidents', 'system', 'systems', 'affected', 'impacted', 'by', 'the', 'with', 'for', 'count', 'counts']);

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;

    const candidate = match[1].trim().replace(/\s+/g, ' ');
    if (!candidate || stopwords.has(candidate)) continue;
    return candidate;
  }

  return null;
}

function extractSeverityValueFromMessage(message = '') {
  const text = String(message || '').toLowerCase().trim();
  const knownSeverities = ['critical', 'high', 'medium', 'low', 'sev1', 'sev2', 'sev3', 'sev4', 'p1', 'p2', 'p3', 'p4'];
  const knownMatch = knownSeverities.find(level => text.includes(level));
  if (knownMatch) return knownMatch;

  const patterns = [
    /severity\s*(?:is|=|:)?\s*['\"]?([a-z0-9 _-]{1,20})['\"]?/i,
    /([a-z0-9 _-]{1,20})\s+severity/i
  ];

  const stopwords = new Set(['incident', 'incidents', 'issue', 'issues', 'ticket', 'tickets', 'by', 'the', 'with', 'for']);

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;

    const candidate = match[1].trim().replace(/\s+/g, ' ');
    if (!candidate || stopwords.has(candidate)) continue;
    return candidate;
  }

  return null;
}

function buildSchemaAgnosticAffectedSystemsByStatusCypher() {
  return `
MATCH (statusNode)
WHERE any(k IN keys(statusNode) WHERE toLower(k) CONTAINS 'status' OR toLower(k) CONTAINS 'state')
  AND any(k IN keys(statusNode)
          WHERE (toLower(k) CONTAINS 'status' OR toLower(k) CONTAINS 'state')
            AND toLower(toString(statusNode[k])) = toLower($status))

MATCH p=(statusNode)-[*1..3]-(candidate)
WHERE id(candidate) <> id(statusNode)
  AND any(k IN keys(candidate)
          WHERE toLower(k) = 'affected_system'
             OR toLower(k) = 'affectedsystem'
             OR toLower(k) = 'system'
             OR toLower(k) = 'system_name'
             OR toLower(k) CONTAINS 'affected'
             OR (toLower(k) CONTAINS 'system' AND toLower(k) <> '__entitykey'))

WITH DISTINCT statusNode,
     coalesce(
       candidate.affected_system,
       candidate.affectedSystem,
       candidate.system,
       candidate.system_name,
       candidate.name,
       candidate.title
     ) AS affected_system
WHERE affected_system IS NOT NULL AND trim(toString(affected_system)) <> ''
WITH affected_system,
     CASE
       WHEN statusNode.status IS NOT NULL THEN toString(statusNode.status)
       WHEN statusNode.incident_status IS NOT NULL THEN toString(statusNode.incident_status)
       WHEN statusNode.state IS NOT NULL THEN toString(statusNode.state)
       ELSE 'unknown'
     END AS status
WITH DISTINCT affected_system, status
ORDER BY affected_system
RETURN affected_system, status
LIMIT 100
`.trim();
}

function buildSchemaAgnosticStatusCountsCypher() {
  return `
MATCH (statusNode)
WHERE any(k IN keys(statusNode) WHERE toLower(k) CONTAINS 'status' OR toLower(k) CONTAINS 'state')
WITH statusNode,
     CASE
       WHEN statusNode.status IS NOT NULL THEN toString(statusNode.status)
       WHEN statusNode.incident_status IS NOT NULL THEN toString(statusNode.incident_status)
       WHEN statusNode.state IS NOT NULL THEN toString(statusNode.state)
       ELSE null
     END AS status
WHERE status IS NOT NULL AND trim(status) <> ''
OPTIONAL MATCH (statusNode)-[*1..2]-(entity)
WHERE id(entity) <> id(statusNode)
  AND NOT any(k IN keys(entity) WHERE toLower(k) CONTAINS 'status' OR toLower(k) CONTAINS 'state')
WITH toLower(status) AS status_key,
     status,
     count(DISTINCT entity) AS connected_count,
     count(DISTINCT statusNode) AS status_nodes
WITH status_key,
     collect(status)[0] AS display_status,
     CASE WHEN connected_count > 0 THEN connected_count ELSE status_nodes END AS count
RETURN display_status AS status, count
ORDER BY count DESC, status ASC
LIMIT 100
`.trim();
}

function buildSchemaAgnosticIncidentsBySeverityCypher() {
  return `
MATCH (severityNode)
WHERE any(k IN keys(severityNode) WHERE toLower(k) CONTAINS 'severity')
WITH severityNode,
     CASE
       WHEN severityNode.severity IS NOT NULL THEN toString(severityNode.severity)
       WHEN severityNode.level IS NOT NULL THEN toString(severityNode.level)
       WHEN severityNode.priority IS NOT NULL THEN toString(severityNode.priority)
       ELSE null
     END AS severity
WHERE severity IS NOT NULL AND trim(severity) <> ''
  AND ($severity IS NULL OR toLower(severity) = toLower($severity))
MATCH (severityNode)-[*0..2]-(candidate)
WHERE id(candidate) <> id(severityNode)
  AND (
    any(lbl IN labels(candidate) WHERE toLower(lbl) CONTAINS 'incident' OR toLower(lbl) CONTAINS 'issue' OR toLower(lbl) CONTAINS 'ticket')
    OR any(k IN keys(candidate)
           WHERE toLower(k) CONTAINS 'incident'
              OR toLower(k) CONTAINS 'issue'
              OR toLower(k) CONTAINS 'ticket'
              OR toLower(k) = 'title'
              OR toLower(k) = 'description')
  )
WITH DISTINCT
  coalesce(
    candidate.incident_id,
    candidate.incidentId,
    candidate.ticket_id,
    candidate.ticketId,
    candidate.issue_id,
    candidate.issueId,
    candidate.id,
    candidate.name,
    candidate.title,
    candidate.description
  ) AS incident,
  severity
WHERE incident IS NOT NULL AND trim(toString(incident)) <> ''
RETURN incident, severity
ORDER BY severity ASC, incident ASC
LIMIT 100
`.trim();
}

function buildSchemaAgnosticMttrCypher() {
  return `
MATCH (n)
WHERE any(k IN keys(n)
          WHERE toLower(k) CONTAINS 'created'
             OR toLower(k) CONTAINS 'opened'
             OR toLower(k) = 'start'
             OR toLower(k) CONTAINS 'start_time')
  AND any(k IN keys(n)
          WHERE toLower(k) CONTAINS 'resolved'
             OR toLower(k) CONTAINS 'closed'
             OR toLower(k) = 'end'
             OR toLower(k) CONTAINS 'end_time')
WITH
  coalesce(n.created_at, n.createdAt, n.created, n.opened_at, n.openedAt, n.start, n.start_time, n.startTime) AS createdRaw,
  coalesce(n.resolved_at, n.resolvedAt, n.resolved, n.closed_at, n.closedAt, n.end, n.end_time, n.endTime) AS resolvedRaw
WHERE createdRaw IS NOT NULL AND resolvedRaw IS NOT NULL
WITH
  toString(createdRaw) AS createdText,
  toString(resolvedRaw) AS resolvedText
WITH
  CASE
    WHEN createdText CONTAINS 'T' THEN datetime(createdText)
    WHEN createdText CONTAINS ' ' THEN datetime(replace(createdText, ' ', 'T'))
    ELSE datetime(createdText + 'T00:00:00')
  END AS createdDt,
  CASE
    WHEN resolvedText CONTAINS 'T' THEN datetime(resolvedText)
    WHEN resolvedText CONTAINS ' ' THEN datetime(replace(resolvedText, ' ', 'T'))
    ELSE datetime(resolvedText + 'T00:00:00')
  END AS resolvedDt
WHERE resolvedDt >= createdDt
WITH duration.between(createdDt, resolvedDt) AS dur
WITH avg(dur.hours + (dur.minutes / 60.0) + (dur.seconds / 3600.0)) AS mttr_hours,
     count(*) AS sample_count
RETURN round(mttr_hours * 100) / 100.0 AS mttr_hours,
       round((mttr_hours / 24.0) * 100) / 100.0 AS mttr_days,
       sample_count
`.trim();
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function addDaysIso(dateStr, days = 1) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const year = d.getUTCFullYear();
  const month = pad2(d.getUTCMonth() + 1);
  const day = pad2(d.getUTCDate());
  return `${year}-${month}-${day}`;
}

function addMonthIso(year, month) {
  const y = Number(year);
  const m = Number(month);
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-01`;
}

function monthNameToNumber(name = '') {
  const months = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12
  };
  return months[String(name || '').toLowerCase()] || null;
}

function extractTemporalPropertyHint(message = '') {
  const text = String(message || '').toLowerCase();
  if (/created|opened|start/.test(text)) return 'created';
  if (/resolved|closed|end/.test(text)) return 'resolved';
  if (/updated|modified/.test(text)) return 'updated';
  if (/due|deadline/.test(text)) return 'due';
  return null;
}

function extractTemporalFilterIntent(message = '') {
  const text = String(message || '').toLowerCase().trim();
  const propertyHint = extractTemporalPropertyHint(text);

  const betweenDate = text.match(/between\s+(\d{4}-\d{2}-\d{2})\s+(?:and|to)\s+(\d{4}-\d{2}-\d{2})/i);
  if (betweenDate) {
    const startDate = betweenDate[1];
    const endDateInclusive = betweenDate[2];
    return {
      mode: 'between-dates',
      params: {
        start: `${startDate}T00:00:00`,
        endExclusive: `${addDaysIso(endDateInclusive, 1)}T00:00:00`,
        propertyHint
      }
    };
  }

  const betweenMonthNumeric = text.match(/between\s+(\d{4})-(\d{2})\s+(?:and|to)\s+(\d{4})-(\d{2})/i);
  if (betweenMonthNumeric) {
    const startYear = betweenMonthNumeric[1];
    const startMonth = betweenMonthNumeric[2];
    const endYear = betweenMonthNumeric[3];
    const endMonth = betweenMonthNumeric[4];

    return {
      mode: 'between-months',
      params: {
        start: `${startYear}-${startMonth}-01T00:00:00`,
        endExclusive: `${addMonthIso(endYear, endMonth)}T00:00:00`,
        propertyHint
      }
    };
  }

  const betweenMonthNamed = text.match(/between\s+([a-z]+)\s+(\d{4})\s+(?:and|to)\s+([a-z]+)\s+(\d{4})/i);
  if (betweenMonthNamed) {
    const startMonthNum = monthNameToNumber(betweenMonthNamed[1]);
    const startYear = betweenMonthNamed[2];
    const endMonthNum = monthNameToNumber(betweenMonthNamed[3]);
    const endYear = betweenMonthNamed[4];

    if (startMonthNum && endMonthNum) {
      return {
        mode: 'between-months',
        params: {
          start: `${startYear}-${pad2(startMonthNum)}-01T00:00:00`,
          endExclusive: `${addMonthIso(endYear, endMonthNum)}T00:00:00`,
          propertyHint
        }
      };
    }
  }

  const isoYearMonth = text.match(/\b(\d{4})-(\d{2})(?!-\d{2})\b/);
  if (isoYearMonth) {
    return {
      mode: 'year-month',
      params: {
        year: Number(isoYearMonth[1]),
        month: Number(isoYearMonth[2]),
        propertyHint
      }
    };
  }

  const namedMonthYear = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})\b/i);
  if (namedMonthYear) {
    const month = monthNameToNumber(namedMonthYear[1]);
    if (month) {
      return {
        mode: 'year-month',
        params: {
          year: Number(namedMonthYear[2]),
          month,
          propertyHint
        }
      };
    }
  }

  const yearOnly = text.match(/(?:\bin\b|\bfor\b|\bduring\b|\byear\b)?\s*(\b(?:19|20)\d{2}\b)/i);
  if (yearOnly) {
    return {
      mode: 'year-only',
      params: {
        year: Number(yearOnly[1]),
        propertyHint
      }
    };
  }

  return null;
}

function buildSchemaAgnosticTemporalFilterCypher(mode = 'year-only') {
  const base = `
MATCH (n)
UNWIND keys(n) AS k
WITH n, k, toLower(k) AS keyLower, toString(n[k]) AS raw
WHERE raw IS NOT NULL AND trim(raw) <> ''
  AND (
    keyLower CONTAINS 'date'
    OR keyLower CONTAINS 'time'
    OR keyLower CONTAINS 'year'
    OR keyLower CONTAINS 'month'
    OR keyLower CONTAINS 'created'
    OR keyLower CONTAINS 'updated'
    OR keyLower CONTAINS 'resolved'
    OR keyLower CONTAINS 'closed'
    OR keyLower CONTAINS 'opened'
    OR keyLower CONTAINS 'start'
    OR keyLower CONTAINS 'end'
  )
  AND ($propertyHint IS NULL OR keyLower CONTAINS $propertyHint)
WITH n, k, replace(raw, ' ', 'T') AS normalized
WITH n, k,
  CASE
    WHEN normalized =~ '\\d{4}-\\d{2}-\\d{2}$' THEN datetime(normalized + 'T00:00:00')
    WHEN normalized =~ '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2})?$' THEN datetime(normalized)
    WHEN normalized =~ '\\d{4}-\\d{2}$' THEN datetime(normalized + '-01T00:00:00')
    ELSE NULL
  END AS dt
WHERE dt IS NOT NULL
`;

  const condition = mode === 'between-dates' || mode === 'between-months'
    ? 'AND dt >= datetime($start) AND dt < datetime($endExclusive)'
    : mode === 'year-month'
      ? 'AND dt.year = $year AND dt.month = $month'
      : 'AND dt.year = $year';

  return `
${base}
${condition}
RETURN DISTINCT
  coalesce(n.incident_id, n.incidentId, n.ticket_id, n.ticketId, n.issue_id, n.issueId, n.id, n.name, n.title, toString(id(n))) AS entity,
  labels(n) AS labels,
  k AS matched_field,
  toString(dt) AS matched_datetime
ORDER BY matched_datetime DESC
LIMIT 100
`.trim();
}

function resolveSchemaAgnosticIntent(message = '') {
  const text = String(message || '').toLowerCase().trim();

  const affectedStatus = extractAffectedSystemsByStatusIntent(text);
  if (affectedStatus) {
    return {
      type: 'affected-systems-by-status',
      cypher: buildSchemaAgnosticAffectedSystemsByStatusCypher(),
      params: { status: affectedStatus }
    };
  }

  const asksMttr = /(\bmttr\b|mean\s+time\s+to\s+resolve|average\s+time\s+to\s+resolve|avg\s+time\s+to\s+resolve|resolution\s+time|time\s+to\s+resolve)/i.test(text);
  if (asksMttr) {
    return {
      type: 'mttr',
      cypher: buildSchemaAgnosticMttrCypher(),
      params: {}
    };
  }

  const asksIncidentsBySeverity = /(incidents?|issues?|tickets?).*(severity|priority)|(severity|priority).*(incidents?|issues?|tickets?)/i.test(text);
  if (asksIncidentsBySeverity) {
    return {
      type: 'incidents-by-severity',
      cypher: buildSchemaAgnosticIncidentsBySeverityCypher(),
      params: { severity: extractSeverityValueFromMessage(text) }
    };
  }

  const asksCountsByStatus = /(count|counts|how\s+many|distribution|breakdown).*(status|state)|(status|state).*(count|counts|how\s+many|distribution|breakdown)/i.test(text);
  if (asksCountsByStatus) {
    return {
      type: 'counts-by-status',
      cypher: buildSchemaAgnosticStatusCountsCypher(),
      params: {}
    };
  }

  const asksTemporalFilter = /(between\s+\d{4}-\d{2}(?:-\d{2})?\s+(?:and|to)\s+\d{4}-\d{2}(?:-\d{2})?|between\s+[a-z]+\s+\d{4}\s+(?:and|to)\s+[a-z]+\s+\d{4}|\b(?:in|for|during)\s+(?:19|20)\d{2}\b|\b(?:19|20)\d{2}-\d{2}(?:-\d{2})?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(?:19|20)\d{2}\b|between\s+dates?|between\s+months?|\byear\b|\bmonth\b)/i.test(text);
  if (asksTemporalFilter) {
    const temporal = extractTemporalFilterIntent(text);
    if (temporal) {
      return {
        type: `temporal-${temporal.mode}`,
        cypher: buildSchemaAgnosticTemporalFilterCypher(temporal.mode),
        params: temporal.params
      };
    }
  }

  return null;
}

function sanitizeLabel(label) {
  const value = String(label || 'ImportedRecord').replace(/[^a-zA-Z0-9_]/g, '');
  return value || 'ImportedRecord';
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) return [];

  return rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return { value: String(row), rowIndex: index + 1 };
    }

    const normalized = {};
    Object.entries(row).forEach(([key, value]) => {
      const sanitizedKey = String(key).replace(/[^a-zA-Z0-9_]/g, '_');
      if (!sanitizedKey) return;

      if (value === null || value === undefined) {
        normalized[sanitizedKey] = null;
      } else if (typeof value === 'object') {
        normalized[sanitizedKey] = JSON.stringify(value);
      } else {
        normalized[sanitizedKey] = value;
      }
    });

    if (!Object.keys(normalized).length) {
      normalized.value = JSON.stringify(row);
    }

    return normalized;
  });
}

function stripMarkdownCodeFences(text = '') {
  return String(text || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function extractFirstJSONObject(text = '') {
  const source = String(text || '');
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
      continue;
    }

    if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        return source.slice(start, i + 1);
      }
    }
  }

  return '';
}

function tryParseJSONWithRepairs(raw = '') {
  const candidates = [];
  const cleaned = stripMarkdownCodeFences(raw);
  const extracted = extractFirstJSONObject(cleaned);

  if (cleaned) candidates.push(cleaned);
  if (extracted && extracted !== cleaned) candidates.push(extracted);

  const addCandidate = (value) => {
    if (value && !candidates.includes(value)) candidates.push(value);
  };

  for (const base of [...candidates]) {
    // Remove trailing commas before } or ]
    addCandidate(base.replace(/,\s*([}\]])/g, '$1'));
    // Normalize fancy quotes that occasionally appear in LLM output
    addCandidate(base.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'"));
    // Apply both repairs
    addCandidate(
      base
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/,\s*([}\]])/g, '$1')
    );
  }

  const errors = [];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (err) {
      errors.push(err.message);
    }
  }

  throw new Error(`Failed to parse LLM schema JSON after repairs: ${errors[0] || 'unknown parse error'}`);
}

function buildHeuristicSchemaAnalysis(rows = [], fileType = 'unknown') {
  const fields = Array.from(new Set((Array.isArray(rows) ? rows : []).flatMap(r => Object.keys(r || {}))));

  const mainLabel = 'ImportedRecord';
  const attrLabel = 'Attribute';
  const metricLabel = 'Metric';

  return {
    detectedSummary: `Schema inferred using fallback heuristics for ${fileType.toUpperCase()} data (LLM output was not valid JSON).`,
    schemaOptions: [
      {
        id: 'schema_1',
        title: 'Record-Centric Model',
        description: 'Store each row as one main node with all detected properties.',
  keyFields: fields.filter(f => /id|uuid|key|code|name/i.test(f)),
  dateFields: fields.filter(f => /date|time|created|updated|born/i.test(f)),
        relationshipIdeas: [],
        graphModel: {
          nodes: [{ label: mainLabel, properties: fields }],
          relationships: []
        },
        nodeLabel: mainLabel
      },
      {
        id: 'schema_2',
        title: 'Record-Attribute Model',
        description: 'Split attributes into separate nodes connected from each record.',
  keyFields: fields.filter(f => /id|uuid|key|code|name/i.test(f)),
  dateFields: fields.filter(f => /date|time|created|updated|born/i.test(f)),
        relationshipIdeas: [`(:${mainLabel})-[:HAS_ATTRIBUTE]->(:${attrLabel})`],
        graphModel: {
          nodes: [
            { label: mainLabel, properties: fields },
            { label: attrLabel, properties: ['name', 'value'] }
          ],
          relationships: [
            { type: 'HAS_ATTRIBUTE', from: mainLabel, to: attrLabel, description: 'Record has attribute' }
          ]
        },
        nodeLabel: mainLabel
      },
      {
        id: 'schema_3',
        title: 'Record-Metric Model',
        description: 'Represent measurable values as metric nodes linked to records.',
  keyFields: fields.filter(f => /id|uuid|key|code|name/i.test(f)),
  dateFields: fields.filter(f => /date|time|created|updated|born/i.test(f)),
        relationshipIdeas: [`(:${mainLabel})-[:HAS_METRIC]->(:${metricLabel})`],
        graphModel: {
          nodes: [
            { label: mainLabel, properties: fields },
            { label: metricLabel, properties: ['name', 'value'] }
          ],
          relationships: [
            { type: 'HAS_METRIC', from: mainLabel, to: metricLabel, description: 'Record has metric' }
          ]
        },
        nodeLabel: mainLabel
      }
    ]
  };
}

function toPascalCase(input = '') {
  return String(input || '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

function expandGraphModelFromFields(option = {}, rows = []) {
  const graphModel = option.graphModel || { nodes: [], relationships: [] };
  const nodes = Array.isArray(graphModel.nodes) ? [...graphModel.nodes] : [];
  const relationships = Array.isArray(graphModel.relationships) ? [...graphModel.relationships] : [];

  const fields = Array.from(new Set((Array.isArray(rows) ? rows : []).flatMap(r => Object.keys(r || {}))));
  if (!fields.length) {
    return {
      ...option,
      graphModel: { nodes, relationships }
    };
  }

  const baseNodeLabel = sanitizeLabel(option.nodeLabel || nodes[0]?.label || 'ImportedRecord');

  const nodeByLabel = new Map();
  for (const n of nodes) {
    const label = sanitizeLabel(n?.label || 'ImportedRecord');
    const props = Array.isArray(n?.properties) ? [...new Set(n.properties)] : [];
    nodeByLabel.set(label, { label, properties: props });
  }

  if (!nodeByLabel.has(baseNodeLabel)) {
    nodeByLabel.set(baseNodeLabel, { label: baseNodeLabel, properties: [] });
  }

  const relKeySet = new Set(
    relationships.map(r => `${sanitizeLabel(r?.from || '')}|${sanitizeLabel(r?.type || '').toUpperCase()}|${sanitizeLabel(r?.to || '')}`)
  );

  const normalizedRelationships = relationships.map(r => ({
    type: sanitizeLabel(r?.type || 'RELATED_TO').toUpperCase(),
    from: sanitizeLabel(r?.from || baseNodeLabel),
    to: sanitizeLabel(r?.to || baseNodeLabel),
    description: r?.description || ''
  }));

  for (const field of fields) {
    const fieldNodeLabel = sanitizeLabel(toPascalCase(field) || `Field_${field}`);
    if (!fieldNodeLabel) continue;

    if (!nodeByLabel.has(fieldNodeLabel)) {
      nodeByLabel.set(fieldNodeLabel, { label: fieldNodeLabel, properties: [field] });
    } else {
      const existing = nodeByLabel.get(fieldNodeLabel);
      existing.properties = [...new Set([...(existing.properties || []), field])];
      nodeByLabel.set(fieldNodeLabel, existing);
    }

    const relType = sanitizeLabel(`HAS_${field}`).toUpperCase() || 'HAS_FIELD';
    const relKey = `${baseNodeLabel}|${relType}|${fieldNodeLabel}`;
    if (!relKeySet.has(relKey) && fieldNodeLabel !== baseNodeLabel) {
      relKeySet.add(relKey);
      normalizedRelationships.push({
        type: relType,
        from: baseNodeLabel,
        to: fieldNodeLabel,
        description: `${baseNodeLabel} has ${field}`
      });
    }
  }

  const expandedNodes = Array.from(nodeByLabel.values());
  const relationshipIdeas = normalizedRelationships.map(r => `(:${r.from})-[:${r.type}]->(:${r.to})`);

  return {
    ...option,
    relationshipIdeas,
    graphModel: {
      nodes: expandedNodes,
      relationships: normalizedRelationships
    },
    nodeLabel: baseNodeLabel
  };
}

function parseUploadedFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const content = file.buffer.toString('utf-8');

  if (ext === '.csv') {
    const rows = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    return { type: 'csv', rows: normalizeRows(rows), rawText: content };
  }

  if (ext === '.tsv') {
    const rows = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      delimiter: '\t'
    });
    return { type: 'tsv', rows: normalizeRows(rows), rawText: content };
  }

  if (ext === '.json') {
    const parsed = JSON.parse(content);
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.data)
        ? parsed.data
        : [parsed];

    return { type: 'json', rows: normalizeRows(rows), rawText: content };
  }

  if (ext === '.cypher' || ext === '.cql') {
    return {
      type: 'cypher',
      rows: [],
      rawText: content,
      statements: content
        .split(';')
        .map(s => s.trim())
        .filter(Boolean)
    };
  }

  throw new Error('Unsupported file type. Please upload CSV, TSV, JSON, or Cypher (.cypher/.cql).');
}

async function generateSchemaOptionsFromFile(fileName, fileType, rows, rawText) {
  const sampleRows = rows.slice(0, 50);
  const preview = fileType === 'cypher'
    ? rawText.substring(0, 12000)
    : JSON.stringify(sampleRows, null, 2).substring(0, 12000);

  const prompt = `Analyze the uploaded file and suggest 2-3 Neo4j schema options.

File Name: ${fileName}
File Type: ${fileType}
Data Preview:
${preview}

Return valid JSON only with this shape:
{
  "detectedSummary": "short summary",
  "schemaOptions": [
    {
      "id": "schema_1",
      "title": "short title",
      "description": "what this schema represents",
      "keyFields": ["id", "name"],
      "dateFields": ["createdAt"],
      "graphModel": {
        "nodes": [
          { "label": "User", "properties": ["id", "name"] },
          { "label": "Product", "properties": ["sku", "title"] }
        ],
        "relationships": [
          { "type": "PURCHASED", "from": "User", "to": "Product", "description": "User purchased product" },
          { "type": "VIEWED", "from": "User", "to": "Product", "description": "User viewed product" }
        ]
      },
      "relationshipIdeas": ["(:User)-[:PURCHASED]->(:Product)", "(:User)-[:VIEWED]->(:Product)"]
    }
  ]
}

Constraints:
- Provide exactly 3 options
- Each option should include all realistically inferable node types and relationship types from the data preview (do not artificially cap counts)
- node labels and relationship types must be alphanumeric/underscore (no spaces)
- Keep concise and practical`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [
      { role: 'system', content: 'You are a Neo4j data modeling assistant. Output strictly valid JSON.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.2,
    max_tokens: 2000
  });

  const rawContent = completion.choices[0].message.content?.trim() || '{}';

  let parsed;
  try {
    parsed = tryParseJSONWithRepairs(rawContent);
  } catch (parseError) {
    console.warn('Schema JSON parse failed, using heuristic fallback:', parseError.message);
    parsed = buildHeuristicSchemaAnalysis(rows, fileType);
  }

  const schemaOptions = Array.isArray(parsed.schemaOptions) ? parsed.schemaOptions.slice(0, 3) : [];

  const normalizedOptions = schemaOptions.map((option, idx) => {
    const normalized = {
      id: option.id || `schema_${idx + 1}`,
      title: option.title || `Schema Option ${idx + 1}`,
      description: option.description || 'Imported nodes from uploaded data.',
      keyFields: Array.isArray(option.keyFields) ? option.keyFields : [],
      dateFields: Array.isArray(option.dateFields) ? option.dateFields : [],
      relationshipIdeas: Array.isArray(option.relationshipIdeas) ? option.relationshipIdeas : [],
      graphModel: {
        nodes: Array.isArray(option?.graphModel?.nodes)
          ? option.graphModel.nodes
              .map(n => ({
                label: sanitizeLabel(n?.label || 'ImportedRecord'),
                properties: Array.isArray(n?.properties) ? n.properties : []
              }))
          : [],
        relationships: Array.isArray(option?.graphModel?.relationships)
          ? option.graphModel.relationships
              .map(r => ({
                type: sanitizeLabel(r?.type || 'RELATED_TO').toUpperCase(),
                from: sanitizeLabel(r?.from || 'ImportedRecord'),
                to: sanitizeLabel(r?.to || 'ImportedRecord'),
                description: r?.description || ''
              }))
          : []
      },
      nodeLabel:
        sanitizeLabel(
          option?.nodeLabel
          || option?.graphModel?.nodes?.[0]?.label
          || 'ImportedRecord'
        )
      };

      return expandGraphModelFromFields(normalized, rows);
    });

  while (normalizedOptions.length > 0 && normalizedOptions.length < 3) {
    const base = normalizedOptions[0];
    const nextIndex = normalizedOptions.length + 1;
    normalizedOptions.push({
      ...base,
      id: `schema_${nextIndex}`,
      title: `${base.title} (Alternative ${nextIndex})`
    });
  }

  if (!normalizedOptions.length) {
    normalizedOptions.push(
      {
        id: 'schema_1',
        title: 'Generic Entity Model',
        description: 'Generic entity-centric model inferred from uploaded data.',
        keyFields: [],
        dateFields: [],
        relationshipIdeas: ['(:Entity)-[:RELATED_TO]->(:Entity)'],
        graphModel: {
          nodes: [{ label: 'Entity', properties: [] }],
          relationships: [{ type: 'RELATED_TO', from: 'Entity', to: 'Entity', description: 'Generic relationship' }]
        },
        nodeLabel: 'Entity'
      },
      {
        id: 'schema_2',
        title: 'Attribute-Centric Model',
        description: 'Separates core entities from attribute nodes for flexibility.',
        keyFields: [],
        dateFields: [],
        relationshipIdeas: ['(:Entity)-[:HAS_ATTRIBUTE]->(:Attribute)'],
        graphModel: {
          nodes: [{ label: 'Entity', properties: [] }, { label: 'Attribute', properties: [] }],
          relationships: [{ type: 'HAS_ATTRIBUTE', from: 'Entity', to: 'Attribute', description: 'Entity has attribute' }]
        },
        nodeLabel: 'Entity'
      },
      {
        id: 'schema_3',
        title: 'Event-Centric Model',
        description: 'Models interactions/events as separate nodes connected to entities.',
        keyFields: [],
        dateFields: [],
        relationshipIdeas: ['(:Entity)-[:PERFORMED]->(:Event)'],
        graphModel: {
          nodes: [{ label: 'Entity', properties: [] }, { label: 'Event', properties: [] }],
          relationships: [{ type: 'PERFORMED', from: 'Entity', to: 'Event', description: 'Entity performed event' }]
        },
        nodeLabel: 'Entity'
      }
    );
  }

  return {
    detectedSummary: parsed.detectedSummary || 'Schema inferred from uploaded file.',
    schemaOptions: normalizedOptions.slice(0, 3)
  };
}

async function chooseBestSchemaOption(uploadContext) {
  const schemaOptions = Array.isArray(uploadContext?.schemaOptions) ? uploadContext.schemaOptions : [];
  if (!schemaOptions.length) return null;
  if (schemaOptions.length === 1) return schemaOptions[0];

  const sampleRows = Array.isArray(uploadContext?.rows) ? uploadContext.rows.slice(0, 50) : [];
  const preview = uploadContext?.fileType === 'cypher'
    ? String(uploadContext?.rawText || '').slice(0, 12000)
    : JSON.stringify(sampleRows, null, 2).slice(0, 12000);

  const optionsText = schemaOptions.map((option, idx) => ({
    index: idx + 1,
    id: option.id,
    title: option.title,
    description: option.description,
    keyFields: option.keyFields,
    nodes: option.graphModel?.nodes || [],
    relationships: option.graphModel?.relationships || []
  }));

  const prompt = `Choose the best schema option for ingestion into Neo4j.

File Type: ${uploadContext?.fileType}
Data Preview:
${preview}

Schema Options:
${JSON.stringify(optionsText, null, 2)}

Return ONLY valid JSON with this shape:
{
  "bestSchemaId": "schema_1",
  "reason": "short reason"
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are an expert Neo4j data model selector. Return only valid JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 250
    });

    const raw = completion.choices[0].message.content?.trim() || '{}';
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    const bestSchema = schemaOptions.find(option => option.id === parsed.bestSchemaId);
    return bestSchema || schemaOptions[0];
  } catch (error) {
    console.warn('Best schema auto-selection fallback to first option:', error.message);
    return schemaOptions[0];
  }
}

async function ingestRowsToNeo4j(rows, nodeLabel) {
  if (!rows.length) {
    return { nodesCreated: 0 };
  }

  const safeLabel = sanitizeLabel(nodeLabel);
  const cypher = `UNWIND $rows AS row CREATE (n:\`${safeLabel}\`) SET n += row`;
  await queryNeo4j(cypher, { rows });
  return { nodesCreated: rows.length, nodeLabel: safeLabel };
}

function pickNodeKeyFields(nodeConfig, schemaKeyFields, row) {
  const preferred = Array.isArray(schemaKeyFields) ? schemaKeyFields : [];
  const nodeProps = Array.isArray(nodeConfig?.properties) ? nodeConfig.properties : [];

  const usablePreferred = preferred.filter(
    k => nodeProps.includes(k) && row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== ''
  );

  if (usablePreferred.length) return usablePreferred;

  const fallbackPriority = ['id', 'uuid', 'key', 'code', 'name', ...nodeProps];
  const fallback = [];
  for (const candidate of fallbackPriority) {
    if (row[candidate] !== undefined && row[candidate] !== null && String(row[candidate]).trim() !== '') {
      fallback.push(candidate);
      break;
    }
  }

  return fallback;
}

function buildNodeEntityPayload(row, nodeConfig, schemaKeyFields, rowIndex) {
  const label = sanitizeLabel(nodeConfig?.label || 'ImportedRecord');
  const nodeProps = Array.isArray(nodeConfig?.properties) ? nodeConfig.properties : [];

  const props = {};
  nodeProps.forEach(prop => {
    if (row[prop] !== undefined && row[prop] !== null && String(row[prop]).trim() !== '') {
      props[prop] = row[prop];
    }
  });

  const keyFields = pickNodeKeyFields(nodeConfig, schemaKeyFields, row);
  let entityKey;

  if (keyFields.length) {
    entityKey = keyFields.map(field => `${field}:${String(row[field])}`).join('|');
  } else if (Object.keys(props).length) {
    const firstProp = Object.keys(props)[0];
    entityKey = `${firstProp}:${String(props[firstProp])}`;
  } else {
    entityKey = `row:${rowIndex}`;
    props.rowIndex = rowIndex;
  }

  return {
    label,
    keyFields,
    entityKey,
    props,
    exists: true
  };
}

async function ingestGraphModelToNeo4j(rows, selectedSchema) {
  const graphModel = selectedSchema?.graphModel || {};
  const nodes = Array.isArray(graphModel.nodes) ? graphModel.nodes : [];
  const relationships = Array.isArray(graphModel.relationships) ? graphModel.relationships : [];

  if (!nodes.length) {
    return ingestRowsToNeo4j(rows, selectedSchema?.nodeLabel || 'ImportedRecord');
  }

  const session = driver.session({
    database: process.env.NEO4J_DATABASE || 'neo4j'
  });

  let nodesCreated = 0;
  let relationshipsCreated = 0;

  try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const nodeRefMap = new Map();

      for (const nodeConfig of nodes) {
        const payload = buildNodeEntityPayload(row, nodeConfig, selectedSchema?.keyFields, i + 1);
        const cypher = `
          MERGE (n:\`${payload.label}\` {__entityKey: $entityKey})
          SET n += $props
          RETURN n
        `;

        const result = await session.run(cypher, {
          entityKey: payload.entityKey,
          props: payload.props
        });

        const updates = result.summary.counters.updates();
        nodesCreated += updates.nodesCreated || 0;
        nodeRefMap.set(payload.label, payload.entityKey);
      }

      for (const relConfig of relationships) {
        const relType = sanitizeLabel(relConfig?.type || 'RELATED_TO').toUpperCase();
        const fromLabel = sanitizeLabel(relConfig?.from || 'ImportedRecord');
        const toLabel = sanitizeLabel(relConfig?.to || 'ImportedRecord');

        const fromKey = nodeRefMap.get(fromLabel);
        const toKey = nodeRefMap.get(toLabel);
        if (!fromKey || !toKey) continue;

        const relCypher = `
          MATCH (a:\`${fromLabel}\` {__entityKey: $fromKey})
          MATCH (b:\`${toLabel}\` {__entityKey: $toKey})
          MERGE (a)-[r:\`${relType}\`]->(b)
          RETURN r
        `;

        const relResult = await session.run(relCypher, {
          fromKey,
          toKey
        });

        const relUpdates = relResult.summary.counters.updates();
        relationshipsCreated += relUpdates.relationshipsCreated || 0;
      }
    }

    return {
      nodesCreated,
      relationshipsCreated,
      nodeLabel: selectedSchema?.nodeLabel || nodes[0]?.label || 'ImportedRecord'
    };
  } finally {
    await session.close();
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
  let generatedCypherForDebug = null;
  try {
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    if (/schema/i.test(message) && latestUploadContext?.schemaOptions?.length) {
      const optionsText = latestUploadContext.schemaOptions
        .map((opt, index) => `${index + 1}. ${opt.title} (${opt.nodeLabel}) - ${opt.description}`)
        .join('\n');

      return res.json({
        message: `Based on the uploaded file, here are ${latestUploadContext.schemaOptions.length} schema options:\n${optionsText}`,
        cypher: null,
        results: latestUploadContext.schemaOptions,
        resultCount: latestUploadContext.schemaOptions.length
      });
    }

    // Get database schema
    const schema = await getDatabaseSchema();

    // Use schema-agnostic shortcuts for high-value intents
    const intent = resolveSchemaAgnosticIntent(message);
    const cypherQuery = intent
      ? intent.cypher
      : normalizeTemporalLiteralsInCypher(await generateCypherQuery(message, schema));
    generatedCypherForDebug = cypherQuery;

    if (cypherQuery === 'UNABLE_TO_GENERATE') {
      return res.json({
        message: 'I cannot generate a query for that request based on the current database schema.',
        cypher: null,
        results: null,
        error: 'Unable to generate Cypher query'
      });
    }

    // Execute the Cypher query
    const results = await queryNeo4j(cypherQuery, intent?.params || {});

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

    let finalMessage;
    try {
      const nlResponse = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'user', content: responsePrompt }
        ],
        temperature: 0.5,
        max_tokens: 800
      });
      finalMessage = nlResponse.choices[0].message.content;
    } catch (summaryError) {
      console.warn('OpenAI response synthesis unavailable, using local summary:', summaryError.message);
      finalMessage = buildLocalResponseSummary(results);
    }

    res.json({
      message: finalMessage,
      cypher: cypherQuery,
      results: results,
      resultCount: results.length
    });

  } catch (error) {
    console.error('Chat Error:', error);
    if (generatedCypherForDebug) {
      console.error('Failed Cypher Query:', generatedCypherForDebug);
    }
    res.status(500).json({
      error: error.message || 'An error occurred processing your request',
      message: 'I encountered an error while processing your request. Please try again.'
    });
  }
});

/**
 * Analyze uploaded file and return LLM schema suggestions
 */
app.post('/api/upload/analyze', upload.single('dataFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const parsed = parseUploadedFile(req.file);
    const schemaAnalysis = await generateSchemaOptionsFromFile(
      req.file.originalname,
      parsed.type,
      parsed.rows,
      parsed.rawText
    );

    latestUploadContext = {
      fileName: req.file.originalname,
      fileType: parsed.type,
      rows: parsed.rows,
      rawText: parsed.rawText,
      statements: parsed.statements || [],
      ...schemaAnalysis
    };

    res.json({
      fileName: req.file.originalname,
      fileType: parsed.type,
      previewCount: parsed.rows.length,
      fileSize: req.file.size,
      detectedSummary: schemaAnalysis.detectedSummary,
      schemaOptions: schemaAnalysis.schemaOptions
    });
  } catch (error) {
    console.error('Analyze Upload Error:', error);
    res.status(500).json({ error: error.message || 'Failed to analyze file.' });
  }
});

/**
 * Upload analyzed file into Neo4j using selected schema option
 */
app.post('/api/upload/ingest', async (req, res) => {
  try {
    const { schemaId } = req.body;

    if (!latestUploadContext) {
      return res.status(400).json({ error: 'No analyzed file found. Please analyze a file first.' });
    }

    const selectedSchema = schemaId
      ? (latestUploadContext.schemaOptions.find(option => option.id === schemaId)
          || latestUploadContext.schemaOptions[0])
      : await chooseBestSchemaOption(latestUploadContext);

    if (!selectedSchema) {
      return res.status(400).json({ error: 'No schema option available.' });
    }

    if (latestUploadContext.fileType === 'cypher') {
      for (const statement of latestUploadContext.statements.slice(0, 200)) {
        await queryNeo4j(statement);
      }

      return res.json({
        message: 'Cypher file uploaded and executed successfully.',
        importedCount: latestUploadContext.statements.length,
        schemaUsed: selectedSchema
      });
    }

    const importResult = await ingestGraphModelToNeo4j(latestUploadContext.rows, selectedSchema);

    return res.json({
      message: `Upload complete. ${importResult.nodesCreated} nodes and ${importResult.relationshipsCreated || 0} relationships created.`,
      importedCount: importResult.nodesCreated,
      relationshipsCreated: importResult.relationshipsCreated || 0,
      schemaSelectionMode: schemaId ? 'manual' : 'auto-best',
      schemaUsed: selectedSchema
    });
  } catch (error) {
    console.error('Ingest Upload Error:', error);
    res.status(500).json({ error: error.message || 'Failed to upload into Neo4j.' });
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
