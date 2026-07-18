const WP_SITE = 'https://hyeonalytics.com'
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = 'llama-3.3-70b-versatile'
const MAX_RESULTS = 3
const MAX_CONTENT_CHARS = 1500

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// Relying on the model to infer the input language from a general
// instruction is unreliable - it's competing against the English-heavy
// reference material and sometimes reverts to English anyway. Detect the
// language deterministically from Unicode script ranges instead, and tell
// the model explicitly and unambiguously which language to reply in.
function detectLanguage(text) {
  if (/[぀-ゟ゠-ヿ]/.test(text)) return 'Japanese'
  if (/[가-힣ᄀ-ᇿ]/.test(text)) return 'Korean'
  if (/[一-鿿]/.test(text)) return 'Chinese'
  return 'English'
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#8217;/g, '’')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8220;/g, '“')
    .replace(/&#8221;/g, '”')
    .replace(/&#8211;/g, '-')
    .replace(/&#8212;/g, '--')
    .replace(/\s+/g, ' ')
    .trim()
}

async function searchSite(query) {
  const res = await fetch(`${WP_SITE}/wp-json/wp/v2/search?search=${encodeURIComponent(query)}&per_page=${MAX_RESULTS}`)
  if (!res.ok) return []
  const results = await res.json()
  return results.slice(0, MAX_RESULTS)
}

async function callGroq(env, messages, opts) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.GROQ_API_KEY || ''}`,
    },
    body: JSON.stringify({ model: GROQ_MODEL, messages, ...opts }),
  })
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content.trim()
    : ''
}

// WordPress's core search endpoint matches best on a handful of concrete
// keywords - long natural-language questions (with "which", "is", "for",
// filler words, punctuation) often return zero results even when highly
// relevant content exists. Use a fast Groq call to distill the question
// into a short keyword query before searching, rather than searching on
// the raw question text. The full conversation history (not just the
// latest message) is passed in so short reactive follow-ups ("그래?",
// "really?", "what about that one") can be resolved in context instead of
// being misread as a standalone, contentless message.
async function extractSearchQuery(env, history) {
  const latest = history[history.length - 1].content
  try {
    const keywords = await callGroq(env, [
      {
        role: 'system',
        content: 'You are analyzing a conversation between a user and an assistant on a Pokémon TCG price and data-analysis website. Judge only the LATEST user message (the final message below), using the earlier messages as context to resolve anything it refers to. If the latest message is a greeting, small talk, thanks, or a short reaction/acknowledgment that is NOT actually asking for new information from the website (e.g. "really?", "ok", "thanks", "그래?"), respond with exactly NONE (nothing else). Otherwise, extract 2-5 concise search keywords (nouns/topics only, no filler words, no punctuation, no explanation) that would find relevant content for the latest message. The site\'s content is written in English, so ALWAYS translate the keywords into English regardless of what language the message is in. Respond with ONLY the English keywords, space-separated, or exactly NONE.',
      },
      ...history,
    ], { temperature: 0, max_tokens: 30 })
    return keywords || latest
  } catch (e) {
    return latest
  }
}

async function fetchContent(result) {
  const selfLink = result._links && result._links.self && result._links.self[0] && result._links.self[0].href
  if (!selfLink) return null
  const res = await fetch(`${selfLink}?_fields=title,content`)
  if (!res.ok) return null
  const data = await res.json()
  const title = data.title && data.title.rendered ? data.title.rendered : result.title
  const text = data.content && data.content.rendered ? stripHtml(data.content.rendered) : ''
  return { title, url: result.url, text: text.slice(0, MAX_CONTENT_CHARS) }
}

// How many prior turns to carry into Groq calls. Bounds token usage while
// still giving the model enough context to resolve short follow-ups.
const MAX_HISTORY_MESSAGES = 12

async function handleChat(request, env) {
  let body
  try {
    body = await request.json()
  } catch (e) {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: CORS_HEADERS })
  }

  const rawMessages = Array.isArray(body.messages) ? body.messages : (body.message ? [{ role: 'user', content: body.message }] : [])
  const history = rawMessages
    .filter(m => m && typeof m.content === 'string' && m.content.trim() && (m.role === 'user' || m.role === 'assistant'))
    .slice(-MAX_HISTORY_MESSAGES)

  if (!history.length || history[history.length - 1].role !== 'user') {
    return Response.json({ error: 'Missing message' }, { status: 400, headers: CORS_HEADERS })
  }

  const message = history[history.length - 1].content
  const hasPriorTurns = history.length > 1
  const replyLanguage = detectLanguage(message)

  const searchQuery = await extractSearchQuery(env, history)
  const isCasual = searchQuery.trim().toUpperCase() === 'NONE'
  const searchResults = isCasual ? [] : await searchSite(searchQuery)
  const pages = (await Promise.all(searchResults.map(fetchContent))).filter(Boolean)

  let systemPrompt
  if (isCasual) {
    systemPrompt = `You are a friendly assistant embedded on Hyeonalytics (hyeonalytics.com), a Pokemon TCG price database and data analysis website. The user's latest message is casual conversation (a greeting, thanks, small talk, a short reaction/acknowledgment, etc.), not a new question about the site's content.

${hasPriorTurns
  ? 'This is not the first message in the conversation - the messages above are the real prior exchange. Respond naturally and IN CONTEXT of that conversation (e.g. if they are reacting to your last answer, react back appropriately). Do NOT reset to a generic greeting like "Hi" when there is already a conversation underway.'
  : 'This is the first message in the conversation, so greet the user naturally and briefly, and you can mention you\'re happy to answer questions about Pokemon TCG prices, education, or investment topics on the site.'}

Do not invent or reference any specific page content beyond what is already in the conversation above.

The user's latest message is written in ${replyLanguage}. You MUST write your entire reply in ${replyLanguage} - do not use English unless ${replyLanguage} is English.`
  } else {
    const context = pages.length
      ? pages.map(p => `### ${p.title} (${p.url})\n${p.text}`).join('\n\n')
      : 'No matching pages were found on the site for this question.'

    systemPrompt = `You are a helpful assistant embedded on Hyeonalytics (hyeonalytics.com), a Pokemon TCG price database and data analysis website. Answer the user's question using ONLY the reference material below, which was retrieved live from the site's own pages. If the answer isn't in the material, say you don't have that information on the site rather than guessing.

You MUST format your reply using EXACTLY this template, with a real line break (newline character) between each part - never merge them into one paragraph:

From: <page title>
<one direct sentence answering the question>

<1-3 sentences of supporting explanation>

Example of the exact shape required (do not copy the content, only the layout):
From: Example Page Title
The direct answer goes here in one sentence.

More detail and context goes in this second paragraph, separated by a blank line from the answer above.

The user's message is written in ${replyLanguage}. You MUST write your entire reply in ${replyLanguage} - do not use English unless ${replyLanguage} is English. The reference material below is in English regardless - translate the explanation into ${replyLanguage} as needed.

IMPORTANT: keep the page title in the "From:" line exactly as written in English in the reference material below - do NOT translate or transliterate it into ${replyLanguage} (this avoids inconsistent mixed-script output). Only the answer and explanation sentences should be in ${replyLanguage}; never mix Chinese/Japanese characters into a Korean reply or vice versa.

Reference material:
${context}`
  }

  let reply
  try {
    reply = await callGroq(env, [
      { role: 'system', content: systemPrompt },
      ...history,
    ], { temperature: 0.3, max_tokens: 500 })
  } catch (e) {
    return Response.json({ error: 'Upstream chat error', detail: String(e) }, { status: 502, headers: CORS_HEADERS })
  }

  return Response.json({
    reply: reply || "Sorry, I couldn't generate a response.",
    sources: pages.map(p => ({ title: p.title, url: p.url })),
  }, { headers: CORS_HEADERS })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/chat') {
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: CORS_HEADERS })
      }
      if (request.method === 'POST') {
        return handleChat(request, env)
      }
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS })
    }

    return env.ASSETS.fetch(request)
  },
}
