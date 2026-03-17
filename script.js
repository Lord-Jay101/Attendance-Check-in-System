(function () {
  const input = document.getElementById('name');
  const suggestionsEl = document.getElementById('suggestions');
  const resultEl = document.getElementById('result');
  let debounceTimer;
  let currentGuests = [];

  if (!input || !suggestionsEl) return;

  function hideSuggestions() {
    suggestionsEl.classList.remove('visible');
    suggestionsEl.innerHTML = '';
    currentGuests = [];
  }

  function showSuggestions(guests) {
    currentGuests = guests;
    if (!guests.length) {
      hideSuggestions();
      return;
    }
    suggestionsEl.innerHTML = guests.map((g, i) =>
      `<div class="suggestion" data-index="${i}" role="option">${escapeHtml(g.name)}</div>`
    ).join('');
    suggestionsEl.classList.add('visible');

    suggestionsEl.querySelectorAll('.suggestion').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const idx = parseInt(el.dataset.index, 10);
        if (currentGuests[idx]) {
          input.value = currentGuests[idx].name;
          hideSuggestions();
          input.focus();
        }
      });
    });
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  async function fetchSuggestions(q) {
    if (!q.trim()) {
      hideSuggestions();
      return;
    }
    try {
      const res = await fetch('/api/search?q=' + encodeURIComponent(q));
      const data = await res.json();
      showSuggestions(data.guests || []);
    } catch {
      hideSuggestions();
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    resultEl.className = '';
    resultEl.textContent = '';
    if (q.length < 2) {
      hideSuggestions();
      return;
    }
    debounceTimer = setTimeout(() => fetchSuggestions(q), 200);
  });

  input.addEventListener('focus', () => {
    if (currentGuests.length) suggestionsEl.classList.add('visible');
  });

  input.addEventListener('blur', () => {
    setTimeout(hideSuggestions, 150);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideSuggestions();
  });

  window.findTable = async function () {
    const name = (input && input.value || '').trim();

    resultEl.className = '';
    resultEl.textContent = '';
    hideSuggestions();

    if (!name) {
      resultEl.className = 'error';
      resultEl.textContent = 'Please enter your name.';
      return;
    }

    try {
      const res = await fetch('/find-table', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();

      if (data.table != null) {
        const params = new URLSearchParams({
          name: data.name,
          table: data.table,
          id: data.id || '',
          seated: data.seated ? '1' : '0'
        });
        window.location.href = 'result.html?' + params.toString();
      } else {
        resultEl.className = 'error';
        resultEl.textContent = data.error || 'Name not found. Please check your spelling or ask a host.';
      }
    } catch (err) {
      resultEl.className = 'error';
      resultEl.textContent = 'Unable to reach the server. Please try again.';
    }
  };
})();
