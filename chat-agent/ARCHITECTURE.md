# 📊 Neo4j Chat Agent - Visual Architecture Guide

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER'S BROWSER                              │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────────────────────────────┐ │  │
│  │  │                    Chat Interface                      │ │  │
│  │  │  ┌─────────────────────────────────────────────────┐  │ │  │
│  │  │  │        Chat Messages Display Area            │  │ │  │
│  │  │  │  ┌─────────────────────────────────────────┐ │  │ │  │
│  │  │  │  │ Bot: Hello! Ask me something...        │ │  │ │  │
│  │  │  │  │                                         │ │  │ │  │
│  │  │  │  │ You: Find all movies from 2020         │ │  │ │  │
│  │  │  │  │                                         │ │  │ │  │
│  │  │  │  │ Bot: Found 15 movies released in 2020  │ │  │ │  │
│  │  │  │  └─────────────────────────────────────────┘ │  │ │  │
│  │  │  └─────────────────────────────────────────────────┘  │ │  │
│  │  │                                                       │ │  │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │ │  │
│  │  │  │ Query Details│  │   Results    │  │   Status   │ │ │  │
│  │  │  │              │  │              │  │ 🟢 Online  │ │ │  │
│  │  │  └──────────────┘  └──────────────┘  └────────────┘ │ │  │
│  │  │                                                       │ │  │
│  │  │  [Input Box]                              [Send] →   │ │  │
│  │  └─────────────────────────────────────────────────────┘ │ │  │
│  │                                                           │ │  │
│  └──────────────────────┬──────────────────────────────────┘ │  │
│                         │ HTTP Requests                       │  │
└─────────────────────────┼────────────────────────────────────┘
                          │
                          │ fetch('/api/chat')
                          │ {message: "user question"}
                          ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    EXPRESS.JS SERVER                                │
│  PORT 5000                                                          │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Request Handler                           │  │
│  │                                                              │  │
│  │  1. Receive: {message: "Find all movies from 2020"}         │  │
│  └────────────────┬─────────────────────────────────────────────┘  │
│                   │                                                 │
│                   ↓                                                 │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │            Extract Database Schema                           │  │
│  │                                                              │  │
│  │  CALL db.labels()                                            │  │
│  │  CALL db.relationshipTypes()                                 │  │
│  │  Sample properties for each label                            │  │
│  │                                                              │  │
│  │  Result: "Movie, Actor, Director labels"                     │  │
│  │          "ACTED_IN, DIRECTED relationships"                 │  │
│  └────────────────┬─────────────────────────────────────────────┘  │
│                   │                                                 │
│                   ↓                                                 │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │            Call OpenAI GPT-4                                 │  │
│  │            (Query Generation)                                │  │
│  │                                                              │  │
│  │  Prompt: "User: Find all movies from 2020"                  │  │
│  │          "Schema: Movie{year, title...}"                    │  │
│  │                                                              │  │
│  │  Response: "MATCH (m:Movie {year: 2020})"                   │  │
│  │            "RETURN m LIMIT 10"                               │  │
│  │                                                              │  │
│  │  Cypher Query Generated ✓                                    │  │
│  └────────────────┬─────────────────────────────────────────────┘  │
│                   │                                                 │
│                   ↓                                                 │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │            Execute on Neo4j Database                         │  │
│  │                                                              │  │
│  │  neo4j-driver (v5.7.0)                                       │  │
│  │  ├─ Connection Pool: 10 connections                          │  │
│  │  ├─ Query Timeout: Configured                               │  │
│  │  └─ Results: 15 movie records                                │  │
│  │                                                              │  │
│  │  Results:                                                    │  │
│  │  [                                                            │  │
│  │    {m: {title: "Movie 1", year: 2020}},                      │  │
│  │    {m: {title: "Movie 2", year: 2020}},                      │  │
│  │    ... 13 more                                               │  │
│  │  ]                                                            │  │
│  └────────────────┬─────────────────────────────────────────────┘  │
│                   │                                                 │
│                   ↓                                                 │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │            Call OpenAI GPT-4                                 │  │
│  │            (Response Synthesis)                              │  │
│  │                                                              │  │
│  │  Prompt: "Query returned 15 movies from 2020:"               │  │
│  │          "[list of results]"                                 │  │
│  │          "Write natural language summary"                    │  │
│  │                                                              │  │
│  │  Response: "Found 15 movies released in 2020"                │  │
│  │            "Including: Movie 1, Movie 2,..."                │  │
│  │                                                              │  │
│  │  Natural Response Generated ✓                                │  │
│  └────────────────┬─────────────────────────────────────────────┘  │
│                   │                                                 │
│                   ↓                                                 │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │            Format & Send Response                            │  │
│  │                                                              │  │
│  │  {                                                            │  │
│  │    "message": "Found 15 movies released in 2020",            │  │
│  │    "cypher": "MATCH (m:Movie {year: 2020})...",             │  │
│  │    "results": [...15 records...],                            │  │
│  │    "resultCount": 15                                         │  │
│  │  }                                                            │  │
│  │                                                              │  │
│  │  ↓ HTTP Response (JSON)                                      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└──────────────────┬──────────────────────────────────────────────────┘
                   │
                   │ Response JSON
                   │
                   ↓
┌─────────────────────────────────────────────────────────────────────┐
│                    USER'S BROWSER (cont.)                          │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Frontend JavaScript processes response:                    │  │
│  │                                                              │  │
│  │  1. Parse JSON response                                     │  │
│  │  2. Add message to chat: "Found 15 movies..."              │  │
│  │  3. Display Cypher in sidebar: "MATCH (m:Movie..."         │  │
│  │  4. Show results in Results panel                           │  │
│  │  5. Auto-scroll to bottom                                   │  │
│  │  6. Clear input field                                       │  │
│  │                                                              │  │
│  │  Display Updated ✓                                           │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Interaction Diagram

```
┌──────────────────────────┐
│   Frontend (Browser)     │
│  ┌────────────────────┐  │
│  │  Chat Component    │  │
│  │  - Messages       │  │
│  │  - Input Box      │  │
│  │  - Status         │  │
│  └────────┬───────────┘  │
└───────────┼──────────────┘
            │
            │ HTTP POST
            │ /api/chat
            │
┌───────────▼──────────────┐
│   Backend (Express)      │
│  ┌────────────────────┐  │
│  │  Request Handler   │  │
│  │  - Validate input  │  │
│  │  - Error handling  │  │
│  │  - CORS            │  │
│  └────────┬───────────┘  │
└───────────┼──────────────┘
            │
     ┌──────┴──────┐
     │             │
     ↓             ↓
┌─────────┐   ┌──────────────┐
│ Neo4j   │   │  OpenAI      │
│ Driver  │   │  (GPT-4)     │
└────┬────┘   └──────┬───────┘
     │               │
     │ Cypher        │ NL Query
     │ ┌─────────┐   │ ┌──────────┐
     │ │ Schema  │   │ │Generate  │
     │ │Extract  │   │ │Cypher    │
     │ └────┬────┘   │ └──────┬───┘
     │      │        │       │
     │ ┌────▼────────┴──────┐│
     │ │ Neo4j              ││
     │ │ Local Database     ││
     │ │ :7687              ││
     │ └────┬───────────────┘│
     │      │                │
     │ ┌────▼──────────┐     │
     │ │ Execute Query │     │
     │ │ Get Results   │     │
     │ └────┬──────────┘     │
     │      │                │
     └──────┼────────────────┘
            │
            │ Results
            │
     ┌──────▼───────────────┐
     │ OpenAI (GPT-4) cont. │
     │ Synthesize Response  │
     └──────┬───────────────┘
            │
            │ NL Response
            │
     ┌──────▼─────────────────────┐
     │ Format Response JSON        │
     │ {                           │
     │   message: "...",           │
     │   cypher: "...",            │
     │   results: [...],           │
     │   resultCount: N            │
     │ }                           │
     └──────┬─────────────────────┘
            │
            │ HTTP Response
            │
     ┌──────▼─────────────────┐
     │ Frontend Updates UI     │
     │ - New message          │
     │ - Cypher query         │
     │ - Results display      │
     └────────────────────────┘
```

## Data Flow Diagram

```
User Input
   │
   │ "Find movies from 2020"
   │
   ↓
┌─────────────────────────┐
│  Frontend Script        │
│  script.js              │
└────────┬────────────────┘
         │
         │ Fetch API
         │ {message: "..."}
         │
         ↓
┌─────────────────────────┐
│  Express Router         │
│  POST /api/chat         │
└────────┬────────────────┘
         │
         ├─→ ┌──────────────────┐
         │   │ Get Schema Info  │
         │   │ - Labels         │
         │   │ - Properties     │
         │   │ - Relationships  │
         │   └────┬─────────────┘
         │        │
         │   ┌────▼─────────────────────┐
         │   │ Neo4j Query 1             │
         │   │ CALL db.labels()          │
         │   └────┬─────────────────────┘
         │        │
         │   ┌────▼──────────────────────┐
         │   │ Schema Assembled          │
         │   │ Ready for LLM             │
         │   └──────────────────────────┘
         │
         ├─→ ┌──────────────────────────┐
         │   │ OpenAI Call #1           │
         │   │ Generate Cypher          │
         │   │                          │
         │   │ System: "You are..."     │
         │   │ User: "Find movies..."   │
         │   │ Schema: "Movie, ..."     │
         │   │                          │
         │   │ Response:                │
         │   │ "MATCH (m:Movie..."      │
         │   └────┬──────────────────────┘
         │        │
         │   ┌────▼─────────────────────┐
         │   │ Cypher Query Generated   │
         │   └──────────────────────────┘
         │
         ├─→ ┌──────────────────────────┐
         │   │ Neo4j Query 2            │
         │   │ Execute Cypher           │
         │   │ MATCH (m:Movie...)       │
         │   │                          │
         │   │ Results: 15 records      │
         │   └────┬──────────────────────┘
         │        │
         │   ┌────▼──────────────────────┐
         │   │ Results Collected         │
         │   │ [{m: {...}}, ...]        │
         │   └──────────────────────────┘
         │
         ├─→ ┌──────────────────────────┐
         │   │ OpenAI Call #2           │
         │   │ Synthesize Response      │
         │   │                          │
         │   │ "Based on query..."      │
         │   │ "[results array]"        │
         │   │ "Write summary"          │
         │   │                          │
         │   │ Response:                │
         │   │ "Found 15 movies..."     │
         │   └────┬──────────────────────┘
         │        │
         │   ┌────▼──────────────────────┐
         │   │ Response Generated        │
         │   └──────────────────────────┘
         │
         ↓
┌─────────────────────────────┐
│  Format JSON Response       │
│  {                          │
│    message: "Found...",     │
│    cypher: "MATCH...",      │
│    results: [...],          │
│    resultCount: 15          │
│  }                          │
└────────┬────────────────────┘
         │
         │ JSON Response
         │
         ↓
┌─────────────────────────┐
│  Frontend Display       │
│ - Message added        │
│ - Cypher shown         │
│ - Results displayed    │
│ - UI updated           │
└─────────────────────────┘
```

## Technology Stack Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Client Layer (Browser)                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │   HTML5          │  │   CSS3           │                │
│  │  index.html      │  │  styles.css      │                │
│  └──────────────────┘  └──────────────────┘                │
│                                                             │
│  ┌────────────────────────────────────────┐                │
│  │    Vanilla JavaScript (No Framework)   │                │
│  │           script.js                    │                │
│  │  - Event handlers                      │                │
│  │  - Fetch API calls                     │                │
│  │  - DOM manipulation                    │                │
│  └────────────────────────────────────────┘                │
│                                                             │
└──────────────────┬───────────────────────────────────────────┘
                   │ HTTP/HTTPS
                   │
┌──────────────────▼───────────────────────────────────────────┐
│                   Application Server                         │
├────────────────────────────────────────────────────────────--┤
│                                                             │
│  ┌──────────────────────────────────────┐                  │
│  │      Node.js Runtime                 │                  │
│  │    JavaScript Execution              │                  │
│  └──────────────────────────────────────┘                  │
│                                                             │
│  ┌──────────────────────────────────────┐                  │
│  │    Express.js Framework              │                  │
│  │  - HTTP Server (Port 5000)           │                  │
│  │  - Request routing                   │                  │
│  │  - Middleware (CORS)                 │                  │
│  │  - Response handling                 │                  │
│  └────────┬─────────────────────────────┘                  │
│           │                                                │
│      ┌────┼─────┐                                          │
│      │    │     │                                          │
│      ↓    ↓     ↓                                          │
│  ┌────┐┌────┐┌──────────────────┐                         │
│  │neo4j││Open│ Utilities         │                         │
│  │DriverAI  │ - Schema Extract   │                         │
│  │  v5.7 │API │ - Error Handling  │                         │
│  └────┘└────┘└──────────────────┘                         │
│      │    │                                                │
└──────┼────┼────────────────────────────────────────────────┘
       │    │
       │    │
       │    └──────────────────────┐
       │                           │
       ↓                           ↓
  ┌─────────┐             ┌──────────────────┐
  │ Neo4j   │             │  OpenAI          │
  │ Database│             │  API (GPT-4)     │
  │:7687    │             │                  │
  │         │             │ - Generate Query │
  │ Graph   │             │ - Synthesize Res │
  │ Storage │             │                  │
  │ Query   │             │ https://api.     │
  │ Engine  │             │ openai.com       │
  └────┬────┘             └──────────────────┘
       │                           │
       │ Cypher Results            │ NL Response
       │                           │
       └───────────┬───────────────┘
                   │
                   ↓
            ┌──────────────┐
            │ JSON Response│
            │ to Client    │
            └──────────────┘
```

## Request-Response Cycle

```
BROWSER                      SERVER                   DATABASE

   │                            │                         │
   │ 1. User types question     │                         │
   │    "Find movies 2020"      │                         │
   │                            │                         │
   │ 2. Click Send              │                         │
   │                            │                         │
   │ 3. script.js creates JSON  │                         │
   │    {message: "..."}        │                         │
   │                            │                         │
   │ 4. fetch() POST request    │                         │
   ├─ POST /api/chat ─────────>│                         │
   │    {message: "..."}        │                         │
   │                            │ 5. Express receives    │
   │                            │    and validates       │
   │                            │                         │
   │                            │ 6. Extract schema     │
   │                            ├─ CALL db.labels() ───>│
   │                            │                        │
   │                            │<─ Return labels ──────│
   │                            │                        │
   │                            │ 7. Call OpenAI #1     │
   │                            │    for Cypher gen     │
   │                            │                        │
   │                            │ 8. Execute Cypher    │
   │                            ├─ MATCH (m:Movie...) ->│
   │                            │                        │
   │                            │<─ Return results ─────│
   │                            │                        │
   │                            │ 9. Call OpenAI #2     │
   │                            │    for response       │
   │                            │                        │
   │                            │ 10. Format JSON       │
   │                            │     response          │
   │                            │                        │
   │<─ HTTP 200 JSON response ──│                        │
   │   {message: "Found...",    │                        │
   │    cypher: "MATCH...",     │                        │
   │    results: [...],         │                        │
   │    resultCount: 15}        │                        │
   │                            │                        │
   │ 11. JavaScript processes   │                        │
   │     response               │                        │
   │                            │                        │
   │ 12. Update DOM:            │                        │
   │     - Add message          │                        │
   │     - Show query           │                        │
   │     - Display results      │                        │
   │                            │                        │
   │ 13. User sees answer ✓     │                        │
   │                            │                        │
```

## Security Architecture

```
                    ┌─────────────────┐
                    │  .gitignore     │
                    │  (PROTECTION)   │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ↓                    ↓                    ↓
    ┌──────┐          ┌──────────┐          ┌─────────┐
    │.env  │          │*.pem,key │          │secrets/ │
    │file  │          │*.crt,pfx │          │dir      │
    │BLOCKED          │BLOCKED               │BLOCKED  │
    └──────┘          └──────────┘          └─────────┘

    ✓ Credentials protected
    ✓ API keys protected
    ✓ Certificates protected
    ✓ Secrets directory protected

                    ┌────────────────────┐
                    │   Runtime Env      │
                    │   Variables        │
                    └────────┬───────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ↓                    ↓                    ↓
   ┌─────────┐          ┌──────────┐        ┌────────┐
   │Neo4j    │          │OpenAI    │        │Server  │
   │URI      │          │API Key   │        │Config  │
   │Password │          │          │        │        │
   └─────────┘          └──────────┘        └────────┘
   NEVER IN GIT         NEVER IN GIT        NEVER IN GIT
```

---

These diagrams show:
1. **Complete system architecture** - How all components interact
2. **Component relationships** - Dependencies between parts
3. **Data flow** - How information moves through the system
4. **Technology stack** - All tools and frameworks used
5. **Request-response cycle** - Detailed interaction sequence
6. **Security measures** - How sensitive data is protected

