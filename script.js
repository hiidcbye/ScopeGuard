async function analyze() {
    const scope = document.getElementById('scope').value.trim();
    const request = document.getElementById('request').value.trim();
    const rate = parseFloat(document.getElementById('rate').value);
    const btn = document.getElementById('analyzeBtn');
    const errorMsg = document.getElementById('errorMsg');
    const results = document.getElementById('results');

    errorMsg.classList.add('hidden');
    results.classList.add('hidden');

    if (!scope) return showError('Please enter your original project scope.');
    if (!request) return showError("Please enter the client's new request.");
    if (!rate || rate <= 0) return showError('Please enter a valid hourly rate.');

    btn.disabled = true;
    btn.textContent = 'Calculating Financial Risk...';

    try {
        const res = await fetch('/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scope, request, rate })
        });

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Server error');
        }

        const data = await res.json();
        renderResult(data);

    } catch (err) {
        showError(err.message || 'Something went wrong. Please try again.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Analyze Risk →';
    }
}

function renderResult(data) {
    const verdict = data.verdict || 'Unknown';
    const hours = Math.round(data.estimatedHours || 0);
    const risk = Math.round(data.revenueRisk || 0);

    const cls = verdict === 'In Scope' ? 'in'
        : verdict === 'Partially Out of Scope' ? 'partial'
            : 'out';

    const banner = document.getElementById('riskBanner');
    banner.className = 'risk-banner ' + cls;

    document.getElementById('riskAmount').textContent =
        risk > 0 ? '₹' + risk.toLocaleString('en-IN') : 'Clear!';
    document.getElementById('riskSub').textContent =
        risk > 0 ? 'Revenue at risk — unpaid work' : 'Request is within scope';
    document.getElementById('verdictPill').textContent = verdict;
    document.getElementById('hoursNum').textContent = hours + ' hrs';

    const list = document.getElementById('evidenceList');
    list.innerHTML = '';
    (data.evidence || []).forEach(ev => {
        const li = document.createElement('li');
        li.textContent = ev;
        list.appendChild(li);
    });

    document.getElementById('emailDraft').value = data.emailDraft || '';
    document.getElementById('results').classList.remove('hidden');
}

function copyEmail() {
    const text = document.getElementById('emailDraft').value;
    const btn = document.querySelector('.copy-btn');
    navigator.clipboard.writeText(text).then(() => {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => {
            btn.textContent = 'Copy Email';
            btn.classList.remove('copied');
        }, 2000);
    });
}

function showError(msg) {
    const el = document.getElementById('errorMsg');
    el.textContent = msg;
    el.classList.remove('hidden');
}