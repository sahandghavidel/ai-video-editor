# YouTube cookies.txt files

Drop your exported `cookies-*.txt` files here. The app picks the
**freshest** (most recently modified) `.txt` file automatically.

## How to export cookies from Chrome

1. Install the **"Get cookies.txt LOCALLY"** extension
   (https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
2. Open https://youtube.com and make sure you're signed in
3. Click the extension icon → **Export cookies for youtube.com**
4. Save the file here as `cookies-YYYY-MM-DD.txt`

## How to export cookies from Firefox

1. Install the **"cookies.txt"** extension
   (https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/)
2. Open https://youtube.com and make sure you're signed in
3. Click the extension icon → **Export cookies for current site**
4. Save the file here as `cookies-YYYY-MM-DD.txt`

## Refresh cadence

Re-export weekly, or whenever yt-dlp starts failing with auth errors
like "Sign in to confirm you're not a bot".

## Format

The file must be in **Netscape cookies.txt format** (the default
output of both extensions above). It should look like:

```
# Netscape HTTP Cookie File
# https://curl.haxx.se/rfc/cookie-spec.html
# This is a generated file! Do not edit.

.youtube.com	TRUE	/	TRUE	0	VISITOR_INFO1_LIVE	abc123
.youtube.com	TRUE	/	FALSE	1782960000	SID	xyz789
...
```

## Why this approach?

Reading cookies directly from Chrome (`--cookies-from-browser chrome`)
has two problems:

1. **Lock contention** — Chrome locks its cookie DB while running.
   yt-dlp may fail or read stale data.
2. **Rate-limit amplification** — your Chrome session and yt-dlp
   share the same IP quota. Browsing YouTube while yt-dlp runs
   doubles the request rate.

A manually-exported cookies.txt file is read-only, never locks, and
decouples your browsing from yt-dlp's activity.
