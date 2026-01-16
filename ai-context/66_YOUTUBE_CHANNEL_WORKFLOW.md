# YouTube channel allowlist workflow (Visuals CMS)

## When to use

- A YouTube channel is blocked by the **autoplay-video** particle template.
- We need to allow a new channel for YouTube videos in Visuals CMS.

## Where the allowlist lives

- `telegraph/visuals-cms/src/pages/Particles/templates/autoplay-video/v0.0.5/template.js`
- Look for the `channelId` validation in `loadYoutubeVideo`.

## How to get a channel ID

Preferred: YouTube Data API `channels.list` with `forHandle`.

Example (handle `@TelegraphRecommended`):

```
https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=TelegraphRecommended&key=API_KEY
```

Notes:
- A usable API key exists in `telegraph/visuals-cms/src/utils/youtube.js` (if needed).
- The response `items[0].id` is the channel ID for allowlisting.

## Apply the change

- Add the new channel ID to the allowed list in `loadYoutubeVideo`.
- Keep the list minimal and explicit to avoid unapproved channels.

## Verification

- In Visuals CMS, enter a YouTube video ID from the allowed channel.
- The template should accept it (no “not allowed” error).
