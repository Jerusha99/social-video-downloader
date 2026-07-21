(function () {
    'use strict';

    // === Tab Switching ===
    var tabBtns = document.querySelectorAll('.tab-btn');
    var tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
            var target = btn.dataset.tab;
            tabBtns.forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            tabContents.forEach(function (c) { c.classList.remove('active'); });
            var targetEl = document.getElementById('tab-' + target);
            if (targetEl) targetEl.classList.add('active');
        });
    });

    // === Download Form ===
    var form = document.getElementById('downloadForm');
    var input = document.getElementById('urlInput');
    var submitBtn = form ? form.querySelector('.btn-primary') : null;
    var resultContainer = document.getElementById('result');

    function showCountdown(seconds, onDone) {
        var el = document.createElement('div');
        el.className = 'result rewarded-gate';
        el.innerHTML =
            '<div class="rewarded-inner">' +
            '<div class="rewarded-spinner"></div>' +
            '<p class="rewarded-text">Preparing your download...</p>' +
            '<div class="rewarded-bar"><div class="rewarded-bar-fill" id="rewardedBarFill"></div></div>' +
            '<p class="rewarded-timer" id="rewardedTimer">' + seconds + 's</p>' +
            '</div>';
        resultContainer.appendChild(el);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });

        var remaining = seconds;
        var fill = document.getElementById('rewardedBarFill');
        var timer = document.getElementById('rewardedTimer');
        var interval = setInterval(function () {
            remaining--;
            if (timer) timer.textContent = remaining + 's';
            if (fill) fill.style.width = ((seconds - remaining) / seconds * 100) + '%';
            if (remaining <= 0) {
                clearInterval(interval);
                el.remove();
                onDone();
            }
        }, 1000);
    }

    if (form) {
        form.addEventListener('submit', async function (e) {
            var url = input.value.trim();
            if (!url) return;
            e.preventDefault();

            var oldResult = resultContainer.querySelector('.result');
            if (oldResult) oldResult.remove();

            submitBtn.disabled = true;
            submitBtn.classList.add('loading');
            submitBtn.innerHTML = '<i class="fas fa-spinner"></i> Processing...';

            showCountdown(5, async function () {
                try {
                    var resp = await fetch('/api/fetch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: url }),
                    });

                    var json = await resp.json();

                    if (json.success) {
                        renderResult(json.data, url);
                    } else {
                        renderError(json.error || 'Failed to fetch video.');
                    }
                } catch (err) {
                    renderError('Network error. Please try again.');
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.classList.remove('loading');
                    submitBtn.innerHTML = '<i class="fas fa-download"></i> Download';
                }
            });
        });
    }

    function renderError(msg) {
        var el = document.createElement('div');
        el.className = 'result error';
        el.innerHTML = '<i class="fas fa-exclamation-circle"></i><p>' + escapeHtml(msg) + '</p>';
        resultContainer.appendChild(el);
    }

    function renderResult(data, originalUrl) {
        var el = document.createElement('div');
        el.className = 'result success';

        var formats = data.formats || [];
        var hasValidFormats = formats.length > 0;
        var platform = (data.platform || '').toLowerCase();
        var isYoutube = platform === 'youtube';
        var formatsHtml = '';

        if (hasValidFormats) {
            formatsHtml = formats.filter(function (f) {
                var ext = (f.format || '').toLowerCase();
                return ext === 'mp4' || ext === 'mp3';
            }).map(function (f) {
                if (!f.url) return '';
                var icon = f.type === 'audio' ? 'fa-music' : 'fa-video';
                var needsProxy = ['tiktok', 'facebook', 'instagram'].includes(platform);
                var href, extraClass, extraAttrs;
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

        var desc = data.description ? '<p class="description">' + escapeHtml(data.description.substring(0, 300)) + '</p>' : '';
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
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // === YouTube force-download ===
    document.addEventListener('click', async function (e) {
        var btn = e.target.closest('.youtube-dl-btn');
        if (btn) {
            e.preventDefault();
            var href = btn.getAttribute('href');
            var label = btn.getAttribute('data-video-label') || 'video';
            var filename = 'youtube-' + label.replace(/[^a-zA-Z0-9]/g, '_') + '.mp4';
            btn.classList.add('loading');
            var origHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner"></i> Downloading...';
            try {
                var resp = await fetch(href);
                if (resp.ok) {
                    var blob = await resp.blob();
                    var a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(a.href);
                    btn.innerHTML = '<i class="fas fa-check"></i> Downloaded';
                    setTimeout(function () { btn.innerHTML = origHtml; btn.classList.remove('loading'); }, 3000);
                    return;
                }
            } catch (ex) {}
            btn.innerHTML = origHtml;
            btn.classList.remove('loading');
            window.open(href, '_blank');
        }
    });

    // === FAQ Accordion ===
    document.addEventListener('click', function (e) {
        var question = e.target.closest('.faq-question');
        if (question) {
            question.parentElement.classList.toggle('open');
        }
    });

    // === Contact Form ===
    var contactForm = document.getElementById('contactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', function (e) {
            e.preventDefault();
            var btn = this.querySelector('.btn-primary');
            var orig = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i> Message Sent!';
            btn.disabled = true;
            setTimeout(function () {
                btn.innerHTML = orig;
                btn.disabled = false;
                contactForm.reset();
            }, 3000);
        });
    }

    // === Monetag Service Worker (push notifications) ===
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(function () {});
    }
})();
