# One-Shot Adaptive RAG - Usage Guide

## 🎯 Overview

The One-Shot Adaptive RAG architecture is a revolutionary search and response system that achieves:
- **50%+ cost reduction**: 1 Google Search + 1 LLM call (vs multiple calls)
- **Data assetization**: Automatic entity profile accumulation
- **Speed optimization**: Single-shot generation (all outputs in one call)
- **Accuracy**: CoT reasoning for temporal disambiguation

## 🏗️ Architecture

### Workflow: Cache → Entity DB → Search → Generate → Save

```
┌─────────────┐
│   Request   │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│  1. Check Cache │ ◄── Fast Return (if valid TTL)
└────────┬────────┘
         │ (miss)
         ▼
┌─────────────────┐
│ 2. Check Entity │ ◄── Context Enrichment
│      DB         │     (existing bio, tags)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  3. Google      │ ◄── Date Filtering Applied
│     Search      │     (2023+ for recent queries)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 4. Generate     │ ◄── One-Shot LLM Call
│   (All-in-One)  │     • Main Answer (persona)
│                 │     • Perspectives (3-4 people)
│                 │     • Entity Info (bio, tags)
│                 │     • Volatility (HIGH/MED/LOW)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 5. Save Results │ ◄── Cache (adaptive TTL)
│                 │     Entity DB (upsert)
└─────────────────┘
```

## 📝 Basic Usage

```typescript
import { executeOneShotAdaptiveRAG } from './search/searchClient';

// Example 1: Political figure
const response = await executeOneShotAdaptiveRAG(
  "Donald Trump",
  "What was the outcome of the 3rd election?",
  agentId
);

console.log(response.reasoning); // "3rd election refers to 2024..."
console.log(response.main_answer); // First-person response from Trump's perspective
console.log(response.perspectives); // Array of opposing/supporting viewpoints
console.log(response.entity_info); // Bio summary for DB storage
console.log(response.volatility); // "HIGH" (election = volatile topic)

// Example 2: Historical figure
const response2 = await executeOneShotAdaptiveRAG(
  "Albert Einstein",
  "Explain your theory of relativity",
  agentId
);

console.log(response2.volatility); // "LOW" (scientific knowledge = stable)
// TTL will be 14 days
```

## 🗃️ Entity Profile Database

### Automatic Data Assetization

Every search accumulates knowledge:

```typescript
// First search about a person
await executeOneShotAdaptiveRAG("Elon Musk", "What is Neuralink?", agentId);
// → Creates EntityProfile: { bio, tags: ["Tech CEO", "Entrepreneur"] }

// Second search (same person)
await executeOneShotAdaptiveRAG("Elon Musk", "Tell me about SpaceX", agentId);
// → Retrieves existing EntityProfile
// → Search results + entity context = better answer
// → Updates EntityProfile if new info found
```

### Manual Entity Access

```typescript
import { getEntityProfile, upsertEntityProfile } from './search/oneShotAdaptiveRAG';

// Retrieve entity
const profile = await getEntityProfile("Marie Curie");
console.log(profile);
// "Name: Marie Curie
//  Summary: Polish-French physicist, Nobel Prize winner...
//  Tags: ["Scientist", "Physicist"]"

// Manual upsert
await upsertEntityProfile(
  "Ada Lovelace",
  {
    summary: "First computer programmer, mathematician",
    tags: ["Computer Science", "Mathematics"]
  },
  "LOW", // volatility
  "Manual entry"
);
```

## ⏱️ Adaptive TTL System

### Volatility-Based Expiration

```typescript
import { calculateAdaptiveTTL } from './search/oneShotAdaptiveRAG';

// HIGH volatility (breaking news, elections, scandals)
const ttl1 = calculateAdaptiveTTL("HIGH");
// → 6 hours (21,600 seconds)

// MEDIUM volatility (general news, recent developments)
const ttl2 = calculateAdaptiveTTL("MEDIUM");
// → 3 days (259,200 seconds)

// LOW volatility (history, science, biographies)
const ttl3 = calculateAdaptiveTTL("LOW");
// → 14 days (1,209,600 seconds)
```

### LLM Determines Volatility

The LLM automatically classifies topics:

```typescript
// Query: "Trump's recent court case"
// → LLM detects: ongoing legal matter
// → Volatility: "HIGH" (6h TTL)

// Query: "Einstein's Nobel Prize year"
// → LLM detects: historical fact
// → Volatility: "LOW" (14d TTL)
```

## 🧠 CoT Reasoning & Disambiguation

### Relative Terms → Absolute Values

The system uses Chain-of-Thought reasoning to convert ambiguous terms:

```typescript
// User asks: "Tell me about Trump's 3rd election"
// Current date: 2025-11-24

// LLM reasoning process:
// "Trump has run in 2016 (1st), 2020 (2nd), and 2024 (3rd).
//  The user is asking about the 3rd election, which is 2024."

// Search query: "Donald Trump 2024 presidential election"
// Answer: Uses 2024 election data (not 2016 or 2020)
```

### Date Filtering

Code-level safety net prevents old information pollution:

```typescript
// If query contains: "recent", "current", "3rd", "latest", "2024", "2025"
// → Filter out articles published before 2023-01-01
// → Fallback: If filtered results = 0, use original (prevents empty returns)

// Example:
// Search: "Kim Gun-hee recent scandal"
// → Date filter removes 2020-2022 articles
// → Returns only 2023-2025 articles
// → If no recent articles exist, returns all (safety fallback)
```

## 📊 Response Structure

### Complete Output

```typescript
interface UltimateResponse {
  reasoning: string;          // CoT thought process
  main_answer: string;        // 1st person persona response
  perspectives: Array<{       // 3-4 opposing/supporting viewpoints
    name: string;             // "Kamala Harris"
    role: string;             // "Vice President"
    dialogue: string;         // "I respectfully disagree because..."
  }>;
  entity_info: {              // For database storage (null if not a person/org)
    summary: string;          // 2-3 sentence bio
    tags: string[];           // ["Politics", "US President"]
  } | null;
  volatility: "HIGH" | "MEDIUM" | "LOW";
}
```

## 🚀 Performance Benefits

### Before (Legacy System)
```
1. Search query classification (LLM call)
2. Google Search (API call)
3. Generate main answer (LLM call)
4. Extract perspectives (LLM call)
5. Generate dialogues (LLM call per person × 3-4)
Total: 1 search + 5-7 LLM calls ≈ 40-60 seconds
```

### After (One-Shot RAG)
```
1. Google Search (API call, with date filtering)
2. Generate everything (1 LLM call)
   • Reasoning
   • Main answer
   • Perspectives (all at once)
   • Entity info
   • Volatility
Total: 1 search + 1 LLM call ≈ 8-12 seconds
Cost: 50-70% reduction
```

## 🛡️ Safety Protocols

### Model Stability
```typescript
// ✅ CORRECT: Stable model
model: 'gemini-1.5-flash'  // v1 API, guaranteed stability

// ❌ WRONG: Experimental models
model: 'gemini-2.5-flash-exp'  // May break without notice
model: 'gemini-latest'         // Version changes unpredictably
```

### Date Filtering Fallback
```typescript
// ✅ Safe: Always returns results
const filtered = articles.filter(a => a.date >= '2023-01-01');
return filtered.length > 0 ? filtered : articles;  // Fallback to original

// ❌ Dangerous: Can return empty
return articles.filter(a => a.date >= '2023-01-01');  // No fallback
```

### Error Handling
```typescript
try {
  const response = await executeOneShotAdaptiveRAG(...);
  return response;
} catch (error) {
  // System logs error but doesn't crash
  // Falls back to existing mechanisms
  console.error('[One-Shot RAG Failed]', error);
  return fallbackResponse;
}
```

## 🔧 Integration Example

```typescript
// In your route handler (e.g., server/routes.ts)
import { executeOneShotAdaptiveRAG } from './search/searchClient';

app.post('/api/chat/one-shot', async (req, res) => {
  const { agentName, question, agentId } = req.body;
  
  try {
    const response = await executeOneShotAdaptiveRAG(
      agentName,
      question,
      agentId
    );
    
    res.json({
      success: true,
      answer: response.main_answer,
      perspectives: response.perspectives,
      reasoning: response.reasoning,
      sources: response.entity_info ? [`Entity DB: ${agentName}`] : []
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
```

## 📈 Monitoring

### Key Metrics to Track

```typescript
// Cache hit rate
console.log('[Cache] Hit rate:', cacheHits / totalRequests);

// Entity DB growth
console.log('[Entity DB] Total profiles:', entityCount);

// Average response time
console.log('[Performance] Avg latency:', avgMs, 'ms');

// Cost per request
console.log('[Cost] Per request:', 1 * searchCost + 1 * llmCost);
```

## 🎓 Best Practices

1. **Use for persona-based queries**: Ideal for questions about specific people/organizations
2. **Leverage entity accumulation**: Same person → cheaper over time
3. **Monitor volatility distribution**: Adjust TTLs if needed
4. **Check reasoning field**: Verify temporal disambiguation is working
5. **Review entity DB periodically**: Prune outdated profiles if needed

## 🚫 When NOT to Use

- **Document-specific queries**: Use document RAG instead
- **Mathematical calculations**: Use direct LLM call
- **Real-time data** (stock prices, weather): Use specialized APIs
- **User personal data**: Privacy-sensitive queries

## 📚 Related Files

- `server/search/oneShotAdaptiveRAG.ts` - Core engine
- `server/search/searchClient.ts` - Integration & workflow
- `shared/schema.ts` - EntityProfile table definition
- `replit.md` - Architecture documentation
