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

async function handleChat(request, env) {
  let body
  try {
    body = await request.json()
  } catch (e) {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: CORS_HEADERS })
  }

  const message = (body.message || '').trim()
  if (!message) {
    return Response.json({ error: 'Missing message' }, { status: 400, headers: CORS_HEADERS })
  }

  const searchResults = await searchSite(message)
  const pages = (await Promise.all(searchResults.map(fetchContent))).filter(Boolean)

  const context = pages.length
    ? pages.map(p => `### ${p.title} (${p.url})\n${p.text}`).join('\n\n')
    : 'No matching pages were found on the site for this question.'

  const systemPrompt = `You are a helpful assistant embedded on Hyeonalytics (hyeonalytics.com), a Pokémon TCG price database and data analysis website. Answer the user's question using ONLY the reference material below, which was retrieved live from the site's own pages. If the answer isn't in the material, say you don't have that information on the site rather than guessing. Keep answers concise and friendly. Mention the page title when relevant.\n\nReference material:\n${context}`

  const groqRes = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.GROQ_API_KEY || ''}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      temperature: 0.3,
      max_tokens: 500,
    }),
  })

  if (!groqRes.ok) {
    const errText = await groqRes.text()
    return Response.json({ error: 'Upstream chat error', detail: errText }, { status: 502, headers: CORS_HEADERS })
  }

  const groqData = await groqRes.json()
  const reply = groqData.choices && groqData.choices[0] && groqData.choices[0].message
    ? groqData.choices[0].message.content
    : "Sorry, I couldn't generate a response."

  return Response.json({
    reply,
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
