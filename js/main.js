(function () {
    'use strict';

    // === Tab Switching ===
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tab;
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            tabContents.forEach(c => c.classList.remove('active'));
            const targetEl = document.getElementById('tab-' + target);
            if (targetEl) targetEl.classList.add('active');
        });
    });

    // === Download Form (AJAX) ===
    const form = document.getElementById('downloadForm');
    const input = document.getElementById('urlInput');
    const submitBtn = form ? form.querySelector('.btn-primary') : null;
    const resultContainer = document.getElementById('result');

    if (form) {
        form.addEventListener('submit', async function (e) {
            const url = input.value.trim();
            if (!url) return;
            e.preventDefault();

            // Remove previous results
            const oldResult = resultContainer.querySelector('.result');
            if (oldResult) oldResult.remove();

            showLoading();
            submitBtn.disabled = true;
            submitBtn.classList.add('loading');
            submitBtn.innerHTML = '<i class="fas fa-spinner"></i> Processing...';

            try {
                const resp = await fetch('/api/fetch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url }),
                });

                const json = await resp.json();
                removeLoading();

                if (json.success) {
                    renderResult(json.data, url);
                } else {
                    renderError(json.error || 'Failed to fetch video.');
                }
            } catch (err) {
                removeLoading();
                renderError('Network error. Please try again.');
            } finally {
                submitBtn.disabled = false;
                submitBtn.classList.remove('loading');
                submitBtn.innerHTML = '<i class="fas fa-download"></i> Download';
            }
        });
    }

    function showLoading() {
        const el = document.createElement('div');
        el.className = 'result loading-indicator';
        el.innerHTML = '<div class="spinner"></div><p>Fetching video...</p>';
        resultContainer.appendChild(el);
    }

    function removeLoading() {
        const el = resultContainer.querySelector('.loading-indicator');
        if (el) el.remove();
    }

    function renderError(msg) {
        const el = document.createElement('div');
        el.className = 'result error';
        el.innerHTML = '<i class="fas fa-exclamation-circle"></i><p>' + escapeHtml(msg) + '</p>';
        resultContainer.appendChild(el);
    }

    function renderResult(data, originalUrl) {
        const el = document.createElement('div');
        el.className = 'result success';

        const formats = data.formats || [];
        const hasValidFormats = formats.length > 0;
        const platform = (data.platform || '').toLowerCase();
        const isYoutube = platform === 'youtube';
        let formatsHtml = '';

        if (hasValidFormats) {
            formatsHtml = formats.filter(f => {
                const ext = (f.format || '').toLowerCase();
                return ext === 'mp4' || ext === 'mp3';
            }).map(f => {
                if (!f.url) return '';
                const icon = f.type === 'audio' ? 'fa-music' : 'fa-video';
                const needsProxy = ['tiktok', 'facebook', 'instagram'].includes(platform);
                let href, extraClass, extraAttrs;
                if (isYoutube) {
                    href = '/api/download?url=' + encodeURIComponent(f.url) + '&platform=youtube' +
                        (originalUrl ? '&v=' + encodeURIComponent(originalUrl) + '&fmt=' + encodeURIComponent(f.label) : '');
                    extraClass = ' youtube-dl-btn';
                    extraAttrs = ' data-video-label="' + escapeHtml(f.label) + '"';
                } else if (needsProxy) {
                    href = '/api/download?url=' + encodeURIComponent(f.url) + '&platform=' + escapeHtml(platform);
                    extraClass = '';
                    extraAttrs = '';
                } else {
                    href = f.url;
                    extraClass = '';
                    extraAttrs = ' target="_blank"';
                }
                return '<a href="' + href + '" class="download-btn' + extraClass + '"' + extraAttrs + ' rel="noopener">' +
                    '<i class="fas ' + icon + '"></i>' +
                    '<span class="quality">' + escapeHtml(f.label || 'Download') + '</span>' +
                    '<span class="format">' + escapeHtml(f.format || '') + '</span>' +
                    '</a>';
            }).filter(Boolean).join('');
        }

        if (!formatsHtml) {
            formatsHtml = '<p class="no-video-msg"><i class="fas fa-image"></i> This post does not contain a downloadable video.</p>';
        } else if (isYoutube) {
            formatsHtml += '<p class="youtube-hint"><i class="fas fa-info-circle"></i> Use 360p MP4 for best compatibility. Higher qualities may fail due to server limitations.</p>';
        }

        const desc = data.description ? '<p class="description">' + escapeHtml(data.description.substring(0, 300)) + '</p>' : '';
        el.innerHTML =
            '<div class="video-preview">' +
            (data.thumbnail ? '<div class="thumbnail-wrapper"><img src="' + escapeHtml(data.thumbnail) + '" alt="Thumbnail" loading="lazy" onerror="this.parentElement.style.display=\'none\'"></div>' : '') +
            '<div class="video-info">' +
            '<h3>' + escapeHtml(data.title || 'Video') + '</h3>' +
            '<p class="meta">' +
            '<span><i class="fas fa-globe"></i> ' + escapeHtml(data.platform || 'unknown') + '</span>' +
            (data.duration ? '<span><i class="fas fa-clock"></i> ' + escapeHtml(data.duration) + '</span>' : '') +
            '</p>' +
            desc +
            '<div class="download-options">' + formatsHtml + '</div>' +
            '</div>' +
            '</div>';

        resultContainer.appendChild(el);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // === YouTube force-download: fetch follows 302 to CDN, pipe to blob ===
    document.addEventListener('click', async function (e) {
        const btn = e.target.closest('.youtube-dl-btn');
        if (btn) {
            e.preventDefault();
            const href = btn.getAttribute('href');
            const label = btn.getAttribute('data-video-label') || 'video';
            const filename = 'youtube-' + label.replace(/[^a-zA-Z0-9]/g, '_') + '.mp4';
            btn.classList.add('loading');
            const origHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner"></i> Downloading...';
            try {
                const resp = await fetch(href);
                if (resp.ok) {
                    const blob = await resp.blob();
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(a.href);
                    btn.innerHTML = '<i class="fas fa-check"></i> Downloaded';
                    setTimeout(() => { btn.innerHTML = origHtml; btn.classList.remove('loading'); }, 3000);
                    return;
                }
            } catch {}
            btn.innerHTML = origHtml;
            btn.classList.remove('loading');
            window.open(href, '_blank');
        }
    });

    // === FAQ Accordion (delegated) ===
    document.addEventListener('click', function (e) {
        const question = e.target.closest('.faq-question');
        if (question) {
            question.parentElement.classList.toggle('open');
        }
    });

    // === Contact Form ===
    const contactForm = document.getElementById('contactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', function (e) {
            e.preventDefault();
            const btn = this.querySelector('.btn-primary');
            const orig = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i> Message Sent!';
            btn.disabled = true;
            setTimeout(() => {
                btn.innerHTML = orig;
                btn.disabled = false;
                this.reset();
            }, 3000);
        });
    }
})();
