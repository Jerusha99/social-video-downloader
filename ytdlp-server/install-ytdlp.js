const { execSync } = require('child_process');
try {
    console.log('Installing yt-dlp...');
    execSync('pip install yt-dlp 2>&1 || pip3 install yt-dlp 2>&1', { stdio: 'inherit', timeout: 60000 });
    console.log('yt-dlp installed successfully');
    const version = execSync('yt-dlp --version 2>&1', { encoding: 'utf-8', timeout: 10000 }).trim();
    console.log('Version:', version);
} catch (e) {
    console.error('Installation failed:', e.message);
    process.exit(1);
}
