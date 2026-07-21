<?php
require_once __DIR__ . '/scrapers/loader.php';
$platforms = [
    'youtube'  => ['YouTube', 'fab fa-youtube', '#FF0000'],
    'facebook' => ['Facebook', 'fab fa-facebook', '#1877F2'],
    'instagram'=> ['Instagram', 'fab fa-instagram', '#E4405F'],
    'twitter'  => ['Twitter / X', 'fab fa-twitter', '#1DA1F2'],
    'tiktok'   => ['TikTok', 'fab fa-tiktok', '#000000'],
    'vimeo'    => ['Vimeo', 'fab fa-vimeo-v', '#1AB7EA'],
    'dailymotion' => ['Dailymotion', 'fab fa-dailymotion', '#0066DC'],
];
$videoData = null;
$error = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST' && !empty($_POST['url'])) {
    $url = trim($_POST['url']);
    try {
        $loader = new PlatformLoader();
        $videoData = $loader->process($url);
    } catch (Exception $e) {
        $error = $e->getMessage();
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SocialSave Pro - Download Videos from Social Media</title>
    <meta name="description" content="Download videos from YouTube, Facebook, Instagram, Twitter, TikTok and more for free. No registration required.">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    <header class="header">
        <div class="container">
            <div class="logo">
                <i class="fas fa-download"></i>
                <h1>Social<span>Save</span></h1>
            </div>
            <p class="tagline">Download videos from any social platform — free & fast</p>
        </div>
    </header>

    <nav class="tabs-nav">
        <div class="container">
            <button class="tab-btn active" data-tab="downloader"><i class="fas fa-download"></i> Downloader</button>
            <button class="tab-btn" data-tab="howto"><i class="fas fa-question-circle"></i> How to Use</button>
            <button class="tab-btn" data-tab="faq"><i class="fas fa-info-circle"></i> FAQ</button>
            <button class="tab-btn" data-tab="contact"><i class="fas fa-envelope"></i> Contact</button>
        </div>
    </nav>

    <div class="page-layout">
    <main class="container main-content">
        <section id="tab-downloader" class="tab-content active">
            <div class="ad-banner-centered" id="ad-banner-top"></div>

            <div class="hero">
                <div class="input-area">
                    <form id="downloadForm" method="POST" action="">
                        <div class="input-group">
                            <i class="fas fa-link input-icon"></i>
                            <input type="url" name="url" id="urlInput" placeholder="Paste video link here..." required autofocus>
                            <button type="submit" class="btn-primary">
                                <i class="fas fa-download"></i> Download
                            </button>
                        </div>
                    </form>
                    <div class="supported">
                        <span>Supported:</span>
                        <?php foreach ($platforms as $key => $p): ?>
                            <span class="platform-badge" style="--platform-color: <?= $p[2] ?>">
                                <i class="<?= $p[1] ?>"></i> <?= $p[0] ?>
                            </span>
                        <?php endforeach; ?>
                    </div>
                </div>

                <div class="features">
                    <div class="feature"><i class="fas fa-infinity"></i> No limits</div>
                    <div class="feature"><i class="fas fa-user-slash"></i> No sign-up</div>
                    <div class="feature"><i class="fas fa-bolt"></i> HD quality</div>
                    <div class="feature"><i class="fas fa-shield-alt"></i> Safe & free</div>
                </div>
            </div>

            <?php if ($error): ?>
                <div class="result error">
                    <i class="fas fa-exclamation-circle"></i>
                    <p><?= htmlspecialchars($error) ?></p>
                </div>
            <?php elseif ($videoData): ?>
                <div class="result success" id="result">
                    <div class="video-preview">
                        <?php if ($videoData['thumbnail']): ?>
                        <div class="thumbnail-wrapper">
                            <img src="<?= htmlspecialchars($videoData['thumbnail']) ?>" alt="Thumbnail" loading="lazy">
                        </div>
                        <?php endif; ?>
                        <div class="video-info">
                            <h3><?= htmlspecialchars($videoData['title']) ?></h3>
                            <p class="meta">
                                <span><i class="fas fa-globe"></i> <?= ucfirst(htmlspecialchars($videoData['platform'])) ?></span>
                                <span><i class="fas fa-clock"></i> <?= htmlspecialchars($videoData['duration'] ?? 'N/A') ?></span>
                            </p>
                            <div class="download-options">
                                <?php $needsProxy = in_array($videoData['platform'] ?? '', ['tiktok', 'facebook', 'instagram']); ?>
                                <?php $allowedFormats = array_filter($videoData['formats'] ?? [], fn($f) => in_array(strtolower($f['format'] ?? ''), ['mp4', 'mp3'])); ?>
                                <?php if ($allowedFormats): ?>
                                    <?php foreach ($allowedFormats as $fmt): ?>
                                        <?php $href = $needsProxy ? ('proxy.php?url=' . urlencode(base64_encode($fmt['url']))) : htmlspecialchars($fmt['url']); ?>
                                        <a href="<?= $href ?>" class="download-btn" <?= $needsProxy ? '' : 'target="_blank"' ?> rel="noopener">
                                            <i class="fas fa-<?= $fmt['type'] === 'audio' ? 'music' : 'video' ?>"></i>
                                            <span class="quality"><?= htmlspecialchars($fmt['label']) ?></span>
                                            <span class="format"><?= strtoupper(htmlspecialchars($fmt['format'])) ?></span>
                                        </a>
                                    <?php endforeach; ?>
                                <?php else: ?>
                                    <p class="no-video-msg"><i class="fas fa-image"></i> This post does not contain a downloadable video.</p>
                                <?php endif; ?>
                            </div>
                        </div>
                    </div>
                </div>
            <?php endif; ?>

            <div class="ad-banner-centered" id="ad-banner-bottom"></div>
        </section>

        <section id="tab-howto" class="tab-content">
            <div class="info-section">
                <h2><i class="fas fa-question-circle"></i> How to Use SocialSave</h2>
                <div class="steps">
                    <div class="step">
                        <div class="step-num">1</div>
                        <i class="fas fa-copy"></i>
                        <p>Copy the video URL from any supported platform</p>
                    </div>
                    <div class="step">
                        <div class="step-num">2</div>
                        <i class="fas fa-paste"></i>
                        <p>Paste the link in the input field above</p>
                    </div>
                    <div class="step">
                        <div class="step-num">3</div>
                        <i class="fas fa-check-circle"></i>
                        <p>Click download and save your video in MP4 or MP3</p>
                    </div>
                </div>
                <div class="tips">
                    <h3>Tips for best results:</h3>
                    <ul>
                        <li><i class="fas fa-check"></i> Use the full video URL (including https://)</li>
                        <li><i class="fas fa-check"></i> For private/age-restricted videos, make sure they are publicly accessible</li>
                        <li><i class="fas fa-check"></i> Instagram Reels and TikTok videos download in the highest available quality</li>
                        <li><i class="fas fa-check"></i> YouTube videos support up to 4K resolution in MP4 format</li>
                    </ul>
                </div>
            </div>
        </section>

        <section id="tab-faq" class="tab-content">
            <div class="info-section">
                <h2><i class="fas fa-info-circle"></i> Frequently Asked Questions</h2>
                <div class="faq-list">
                    <div class="faq-item">
                        <div class="faq-question">Is this free to use?</div>
                        <div class="faq-answer">Yes, 100% free. No registration or payment required. No limits on downloads.</div>
                    </div>
                    <div class="faq-item">
                        <div class="faq-question">Which platforms are supported?</div>
                        <div class="faq-answer">YouTube, Facebook, Instagram, Twitter/X, TikTok, Vimeo, Dailymotion and more being added regularly.</div>
                    </div>
                    <div class="faq-item">
                        <div class="faq-question">What video quality is available?</div>
                        <div class="faq-answer">Depends on the source — up to 4K for YouTube and other platforms that offer it. We always serve the highest available quality.</div>
                    </div>
                    <div class="faq-item">
                        <div class="faq-question">Why is only MP4/MP3 shown?</div>
                        <div class="faq-answer">We filter to show only the most compatible formats — MP4 for video and MP3 for audio — so you get the best experience on any device.</div>
                    </div>
                    <div class="faq-item">
                        <div class="faq-question">Is there a download limit?</div>
                        <div class="faq-answer">No limits at all. Download as many videos as you want, anytime.</div>
                    </div>
                </div>
            </div>
        </section>

        <section id="tab-contact" class="tab-content">
            <div class="info-section">
                <h2><i class="fas fa-envelope"></i> Contact Us</h2>
                <p class="contact-desc">Have a question, suggestion, or need help? Reach out to us.</p>
                <form id="contactForm" class="contact-form">
                    <div class="form-group">
                        <input type="text" placeholder="Your Name" required>
                    </div>
                    <div class="form-group">
                        <input type="email" placeholder="Your Email" required>
                    </div>
                    <div class="form-group">
                        <textarea rows="5" placeholder="Your Message" required></textarea>
                    </div>
                    <button type="submit" class="btn-primary"><i class="fas fa-paper-plane"></i> Send Message</button>
                </form>
                <div class="contact-info">
                    <p><i class="fas fa-envelope"></i> support@socialsave.pro</p>
                    <p><i class="fas fa-globe"></i> Developed by <strong>Jerusha'Tech</strong></p>
                </div>
            </div>
        </section>
    </main>
    </div>

    <!-- RIGHT SIDEBAR VIDEO AD -->
    <aside class="ad-sidebar-right">
        <script>
        (function(anl){
        var d = document,
            s = d.createElement('script'),
            l = d.scripts[d.scripts.length - 1];
        s.settings = anl || {};
        s.src = "\/\/relieved-understanding.com\/bsXhVgs.dOGxlg0GYeWtcl\/Te\/mN9QuVZLUMlykEPITlcIyQMdjJcw3\/OfDKEdtkNfz\/I\/yINBz\/cv4kN_Q-";
        s.async = true;
        s.referrerPolicy = 'no-referrer-when-downgrade';
        l.parentNode.insertBefore(s, l);
        })({})
        </script>
    </aside>

    <footer class="footer">
        <div class="container">
            <p>&copy; 2026 <strong>Jerusha'Tech</strong>. All rights reserved. Made with <i class="fas fa-heart" style="color: #ef4444;"></i></p>
        </div>
    </footer>

    <script src="js/main.js"></script>
</body>
</html>
