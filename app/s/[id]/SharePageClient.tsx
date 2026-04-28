"use client";

// Public-facing testimonial page for prospects. Designed to look "produced",
// not like an admin tool — video forward, clean typography, no app chrome.

interface Asset {
  id: string;
  headline: string | null;
  pull_quote: string | null;
  description: string | null;
  video_url: string | null;
  thumbnail: string | null;
  client_name: string | null;
  company: string | null;
  vertical: string | null;
}

function extractVimeoId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m ? m[1] : null;
}

function extractYouTubeId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?#]+)/
  );
  return m ? m[1] : null;
}

export default function SharePageClient({ asset }: { asset: Asset }) {
  const vimeoId = extractVimeoId(asset.video_url);
  const youtubeId = extractYouTubeId(asset.video_url);
  const headline = asset.headline || "Customer story";
  const subline = [asset.client_name, asset.company].filter(Boolean).join(" · ");

  return (
    <>
      <style>{css}</style>
      <div className="sp-wrap">
        <div className="sp-content">
          <div className="sp-eyebrow">{asset.vertical || "Customer story"}</div>
          <h1 className="sp-headline">{headline}</h1>
          {subline && <div className="sp-subline">{subline}</div>}

          {/* Video — Vimeo or YouTube embed */}
          <div className="sp-video">
            {vimeoId ? (
              <iframe
                src={`https://player.vimeo.com/video/${vimeoId}?title=0&byline=0&portrait=0`}
                frameBorder="0"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
              />
            ) : youtubeId ? (
              <iframe
                src={`https://www.youtube.com/embed/${youtubeId}`}
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : asset.thumbnail ? (
              <img src={asset.thumbnail} alt={headline} />
            ) : (
              <div className="sp-no-video">Video unavailable</div>
            )}
          </div>

          {asset.pull_quote && (
            <blockquote className="sp-quote">
              <p>&ldquo;{asset.pull_quote}&rdquo;</p>
              {asset.client_name && (
                <footer>
                  <strong>{asset.client_name}</strong>
                  {asset.company && <span> · {asset.company}</span>}
                </footer>
              )}
            </blockquote>
          )}

          {asset.description && (
            <div className="sp-description">
              {asset.description.split(/\n\n+/).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          )}

          <div className="sp-footer">
            Shared via{" "}
            <span className="sp-brand">StoryMatch</span>
          </div>
        </div>
      </div>
    </>
  );
}

const css = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500&display=swap');
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#fafafa;color:#111118;-webkit-font-smoothing:antialiased;}

.sp-wrap{
  min-height:100vh;
  background:#fafafa;
  font-family:'Instrument Sans',system-ui,sans-serif;
  padding:48px 24px 64px;
}
.sp-content{
  max-width:780px;
  margin:0 auto;
}
.sp-eyebrow{
  font-size:11px;
  font-weight:700;
  letter-spacing:1.2px;
  text-transform:uppercase;
  color:#6d28d9;
  margin-bottom:14px;
}
.sp-headline{
  font-family:'Newsreader',Georgia,serif;
  font-size:42px;
  font-weight:500;
  line-height:1.15;
  letter-spacing:-0.5px;
  color:#111118;
  margin-bottom:8px;
}
.sp-subline{
  font-size:15px;
  color:#55556a;
  margin-bottom:32px;
}
.sp-video{
  position:relative;
  width:100%;
  aspect-ratio:16/9;
  border-radius:14px;
  overflow:hidden;
  background:#1a1a1f;
  margin-bottom:36px;
  box-shadow:0 12px 40px rgba(0,0,0,.12);
}
.sp-video iframe,.sp-video img{
  width:100%;
  height:100%;
  border:none;
  object-fit:cover;
}
.sp-no-video{
  color:#aaaabb;
  display:grid;
  place-items:center;
  height:100%;
  font-size:14px;
}
.sp-quote{
  border-left:3px solid #6d28d9;
  padding:8px 0 8px 22px;
  margin-bottom:32px;
}
.sp-quote p{
  font-family:'Newsreader',Georgia,serif;
  font-size:24px;
  line-height:1.4;
  font-style:italic;
  color:#1a1a1f;
  margin-bottom:12px;
}
.sp-quote footer{
  font-size:13px;
  color:#55556a;
}
.sp-quote footer strong{color:#111118;font-weight:600;}
.sp-description{
  font-size:16px;
  line-height:1.65;
  color:#333344;
}
.sp-description p{margin-bottom:14px;}
.sp-description p:last-child{margin-bottom:0;}
.sp-footer{
  margin-top:64px;
  padding-top:24px;
  border-top:1px solid #e2e2e6;
  text-align:center;
  font-size:12px;
  color:#8888a0;
}
.sp-brand{
  font-family:'Newsreader',Georgia,serif;
  font-weight:500;
  color:#6d28d9;
  letter-spacing:-0.2px;
}

@media (max-width:640px){
  .sp-wrap{padding:28px 18px 48px;}
  .sp-headline{font-size:30px;}
  .sp-quote p{font-size:19px;}
}
`;
