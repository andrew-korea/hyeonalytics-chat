(function() {
  var BASE = 'https://hyeonalytics-chat.jhc5829.workers.dev';

  var style = document.createElement('style');
  style.textContent =
    '#hyeo-chat-btn{position:fixed;bottom:32px;right:92px;width:48px;height:48px;border-radius:50%;background-color:#000000;color:#ffffff;display:flex;align-items:center;justify-content:center;text-decoration:none;font-size:22px;line-height:1;z-index:9999;box-shadow:0 2px 10px rgba(0,0,0,0.35);border:none;cursor:pointer;}' +
    '#hyeo-chat-btn:hover{background-color:#1a1a1a;}' +
    '@media (max-width: 782px){#hyeo-chat-btn{display:none;}}' +
    '#hyeo-chat-panel{position:fixed;bottom:92px;right:32px;width:320px;max-width:calc(100vw - 48px);height:440px;max-height:calc(100vh - 140px);background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.25);display:none;flex-direction:column;overflow:hidden;z-index:9999;font-family:sans-serif;}' +
    '#hyeo-chat-panel.open{display:flex;}' +
    '#hyeo-chat-header{background:#000;color:#fff;padding:12px 16px;font-size:14px;font-weight:bold;display:flex;justify-content:space-between;align-items:center;}' +
    '#hyeo-chat-close{background:none;border:none;color:#fff;font-size:18px;cursor:pointer;line-height:1;}' +
    '#hyeo-chat-messages{flex:1;overflow-y:auto;padding:12px 16px;font-size:13px;color:#333;}' +
    '.hyeo-msg{margin-bottom:10px;line-height:1.4;}' +
    '.hyeo-msg.user{text-align:right;}' +
    '.hyeo-msg .bubble{display:inline-block;padding:8px 12px;border-radius:10px;max-width:85%;text-align:left;white-space:pre-wrap;}' +
    '.hyeo-msg.user .bubble{background:#000;color:#fff;}' +
    '.hyeo-msg.assistant .bubble{background:#f0f0f0;color:#333;}' +
    '.hyeo-msg.assistant .sources{margin-top:4px;font-size:11px;color:#999;}' +
    '.hyeo-msg.assistant .sources a{color:#999;}' +
    '#hyeo-chat-input-row{display:flex;border-top:1px solid #eee;padding:8px;gap:6px;}' +
    '#hyeo-chat-input{flex:1;border:1px solid #ccc;border-radius:6px;padding:8px 10px;font-size:13px;resize:none;font-family:inherit;}' +
    '#hyeo-chat-send{background:#000;color:#fff;border:none;border-radius:6px;padding:0 14px;cursor:pointer;font-size:13px;}' +
    '#hyeo-chat-send:disabled{opacity:.5;cursor:default;}';
  document.head.appendChild(style);

  var btn = document.createElement('button');
  btn.id = 'hyeo-chat-btn';
  btn.setAttribute('aria-label', 'Chat with site assistant');
  btn.textContent = '💬';
  document.body.appendChild(btn);

  var panel = document.createElement('div');
  panel.id = 'hyeo-chat-panel';
  panel.innerHTML =
    '<div id="hyeo-chat-header"><span>Ask Hyeonalytics</span><button id="hyeo-chat-close" aria-label="Close chat">×</button></div>' +
    '<div id="hyeo-chat-messages"></div>' +
    '<div id="hyeo-chat-input-row">' +
    '<textarea id="hyeo-chat-input" rows="1" placeholder="Ask about a page or article..."></textarea>' +
    '<button id="hyeo-chat-send">Send</button>' +
    '</div>';
  document.body.appendChild(panel);

  var messagesEl = document.getElementById('hyeo-chat-messages');
  var inputEl = document.getElementById('hyeo-chat-input');
  var sendBtn = document.getElementById('hyeo-chat-send');
  var opened = false;
  var history = [];

  function toggle() {
    opened = !opened;
    panel.className = opened ? 'open' : '';
    if (opened && !messagesEl.childElementCount) {
      addMessage('assistant', 'Hi! Ask me anything about Hyeonalytics — Pokémon TCG prices, education comparisons, investing, or anything else on the site.');
    }
    if (opened) inputEl.focus();
  }

  function addMessage(role, text, sources) {
    var row = document.createElement('div');
    row.className = 'hyeo-msg ' + role;
    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    row.appendChild(bubble);
    if (sources && sources.length) {
      var srcDiv = document.createElement('div');
      srcDiv.className = 'sources';
      srcDiv.textContent = 'Sources: ';
      sources.forEach(function(s, i) {
        var a = document.createElement('a');
        a.href = s.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = s.title;
        srcDiv.appendChild(a);
        if (i < sources.length - 1) srcDiv.appendChild(document.createTextNode(', '));
      });
      row.appendChild(srcDiv);
    }
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return row;
  }

  function send() {
    var text = inputEl.value.trim();
    if (!text) return;
    addMessage('user', text);
    history.push({ role: 'user', content: text });
    inputEl.value = '';
    sendBtn.disabled = true;

    var loadingRow = addMessage('assistant', 'Thinking...');

    fetch(BASE + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history }),
    })
      .then(function(res) { return res.json().then(function(data) { return { res: res, data: data }; }); })
      .then(function(r) {
        loadingRow.remove();
        if (!r.res.ok) {
          addMessage('assistant', 'Sorry, something went wrong. Please try again.');
          return;
        }
        addMessage('assistant', r.data.reply, r.data.sources);
        history.push({ role: 'assistant', content: r.data.reply });
      })
      .catch(function() {
        loadingRow.remove();
        addMessage('assistant', 'Sorry, something went wrong. Please try again.');
      })
      .then(function() { sendBtn.disabled = false; });
  }

  btn.addEventListener('click', toggle);
  document.getElementById('hyeo-chat-close').addEventListener('click', toggle);
  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
})();
