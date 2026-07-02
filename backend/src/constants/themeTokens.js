// Stripe-inspired SNSW CFO dashboard theme, ported verbatim from
// src/snsw_cfo_dashboard/cfo_stripe_theme.py (STRIPE_CFO_CSS :root variables).
// Local-only ethos: no external font/CDN references anywhere in this CSS.

const THEME_NAME = "stripe-cfo";
const THEME_CSS_FILENAME = "stripe-cfo-theme.css";

const THEME_TOKENS = {
  bg: "#f6f9fc",
  surface: "#ffffff",
  surface2: "#f8fbff",
  heading: "#061b31",
  text: "#273951",
  muted: "#64748d",
  line: "#e5edf5",
  purple: "#533afd",
  purpleHover: "#4434d4",
  purpleSoft: "#f0efff",
  green: "#15be53",
  greenText: "#108c3d",
  ruby: "#ea2261",
  rubySoft: "#fff1f5",
  amber: "#9b6829",
  amberSoft: "#fff7e6",
};

const STRIPE_CFO_CSS = `
/* Stripe-inspired SNSW CFO dashboard theme.
   Design target: calm financial command centre; white/pale surface, deep navy text,
   restrained purple accents, tabular numbers, deliberate risk colours. */
:root{
  --stripe-bg:#f6f9fc;
  --stripe-surface:#ffffff;
  --stripe-surface-2:#f8fbff;
  --stripe-heading:#061b31;
  --stripe-text:#273951;
  --stripe-muted:#64748d;
  --stripe-line:#e5edf5;
  --stripe-purple:#533afd;
  --stripe-purple-hover:#4434d4;
  --stripe-purple-soft:#f0efff;
  --stripe-green:#15be53;
  --stripe-green-text:#108c3d;
  --stripe-ruby:#ea2261;
  --stripe-ruby-soft:#fff1f5;
  --stripe-amber:#9b6829;
  --stripe-amber-soft:#fff7e6;
  --stripe-shadow:rgba(50,50,93,.25) 0 30px 45px -30px, rgba(0,0,0,.10) 0 18px 36px -18px;
  --stripe-shadow-soft:rgba(23,23,23,.08) 0 15px 35px 0;
}
*{box-sizing:border-box}
html{background:var(--stripe-bg)}
body.stripe-cfo,
body{
  margin:0!important;
  color:var(--stripe-text)!important;
  background:
    radial-gradient(circle at 8% -10%, rgba(83,58,253,.06), transparent 30%),
    radial-gradient(circle at 96% 0%, rgba(249,107,238,.045), transparent 26%),
    linear-gradient(180deg,#ffffff 0%,#f8fbff 42%,#f3f7fc 100%)!important;
  font-family:'Source Sans 3',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif!important;
  font-feature-settings:"ss01";
  font-weight:300;
}
a{color:var(--stripe-purple)!important;text-decoration:none;font-weight:500!important}
a:hover{color:var(--stripe-purple-hover)!important;text-decoration:underline;text-underline-offset:3px}
.wrap{max-width:1480px!important;margin:0 auto!important;padding:34px 28px 44px!important}
h1{
  color:var(--stripe-heading)!important;
  font-size:48px!important;
  line-height:1.06!important;
  letter-spacing:-.96px!important;
  font-weight:300!important;
  margin:0 0 8px!important;
}
h2{
  color:var(--stripe-heading)!important;
  font-size:26px!important;
  line-height:1.12!important;
  letter-spacing:-.26px!important;
  font-weight:300!important;
}
h3{
  color:var(--stripe-heading)!important;
  font-size:22px!important;
  line-height:1.1!important;
  letter-spacing:-.22px!important;
  font-weight:300!important;
}
.sub,.small,.mini,.note{color:var(--stripe-muted)!important;font-size:14px!important;line-height:1.45!important;font-weight:300!important}
.grid{display:grid!important;grid-template-columns:repeat(12,minmax(0,1fr))!important;gap:18px!important}
.span3{grid-column:span 3!important}.span4{grid-column:span 4!important}.span5{grid-column:span 5!important}.span6{grid-column:span 6!important}.span7{grid-column:span 7!important}.span8{grid-column:span 8!important}.span12{grid-column:span 12!important}
.card,.dept,.modal-card{
  background:rgba(255,255,255,.94)!important;
  border:1px solid var(--stripe-line)!important;
  border-radius:8px!important;
  color:var(--stripe-text)!important;
  box-shadow:var(--stripe-shadow)!important;
  backdrop-filter:blur(14px);
}
.card{padding:20px!important}
.dept{transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease!important}
.dept:hover{transform:translateY(-2px)!important;border-color:#b9b9f9!important;box-shadow:rgba(50,50,93,.30) 0 34px 50px -32px,rgba(0,0,0,.12) 0 20px 40px -20px!important}
.label{
  color:var(--stripe-muted)!important;
  font-size:12px!important;
  letter-spacing:.08em!important;
  text-transform:uppercase!important;
  font-weight:500!important;
}
.value{
  color:var(--stripe-heading)!important;
  font-size:38px!important;
  font-weight:300!important;
  letter-spacing:-.7px!important;
  font-variant-numeric:tabular-nums!important;
}
.value.good,.good{color:var(--stripe-green-text)!important}
.value.bad,.bad{color:var(--stripe-ruby)!important}
.value.warn,.warn,.amber{color:var(--stripe-amber)!important}
.header-meta{display:flex!important;gap:8px!important;flex-wrap:wrap!important;justify-content:flex-end!important;align-items:flex-start!important}
.pill,.badge{
  display:inline-flex!important;
  align-items:center!important;
  gap:6px!important;
  border-radius:4px!important;
  border:1px solid var(--stripe-line)!important;
  background:#fff!important;
  color:var(--stripe-heading)!important;
  padding:6px 9px!important;
  font-size:12px!important;
  font-weight:400!important;
  box-shadow:rgba(23,23,23,.04) 0 2px 8px!important;
}
.pill.good{background:rgba(21,190,83,.12)!important;border-color:rgba(21,190,83,.35)!important;color:var(--stripe-green-text)!important}
.pill.bad{background:var(--stripe-ruby-soft)!important;border-color:rgba(234,34,97,.22)!important;color:var(--stripe-ruby)!important}
.pill.warn,.pill.amber{background:var(--stripe-amber-soft)!important;border-color:rgba(155,104,41,.24)!important;color:var(--stripe-amber)!important}
.metrics div,.nums div{
  background:var(--stripe-surface-2)!important;
  border:1px solid var(--stripe-line)!important;
  border-radius:6px!important;
}
.metrics b,.nums b,td,th{
  font-variant-numeric:tabular-nums!important;
}
.metrics b,.nums b{color:var(--stripe-heading)!important;font-weight:400!important}
.metrics span,.nums small{color:var(--stripe-muted)!important;font-weight:300!important}
.bar{background:#e6edf7!important;border-radius:999px!important}
.bar i,.bar .spent{background:linear-gradient(90deg,#533afd,#7c6bff,#f96bee)!important}
.bar .budget{background:#d6dff0!important}
table{
  width:100%;
  border-collapse:separate!important;
  border-spacing:0!important;
  color:var(--stripe-text)!important;
  font-size:14px!important;
}
th{
  position:sticky;top:0;
  background:#f8fbff!important;
  color:var(--stripe-muted)!important;
  text-transform:uppercase;
  letter-spacing:.07em;
  font-size:11px!important;
  font-weight:500!important;
  border-bottom:1px solid var(--stripe-line)!important;
}
td{border-bottom:1px solid var(--stripe-line)!important;color:var(--stripe-text)!important;font-weight:300!important}
tr:hover td{background:#fbfdff!important}
input,select,textarea,.search,.proj{
  background:#fff!important;
  color:var(--stripe-heading)!important;
  border:1px solid var(--stripe-line)!important;
  border-radius:6px!important;
  box-shadow:rgba(23,23,23,.04) 0 2px 8px!important;
  font-family:'Source Sans 3',system-ui,sans-serif!important;
}
input:focus,select:focus,textarea:focus,.search:focus{outline:2px solid rgba(83,58,253,.22)!important;border-color:var(--stripe-purple)!important}
button,.btn,.close{
  background:var(--stripe-purple)!important;
  color:#fff!important;
  border:1px solid var(--stripe-purple)!important;
  border-radius:4px!important;
  padding:8px 14px!important;
  font-weight:400!important;
  box-shadow:rgba(50,50,93,.25) 0 12px 24px -12px!important;
}
button:hover,.btn:hover,.close:hover{background:var(--stripe-purple-hover)!important}
button:disabled,.btn:disabled,button[disabled]{
  background:#eef2f7!important;
  color:#718098!important;
  border-color:#d9e2ee!important;
  box-shadow:none!important;
  cursor:not-allowed!important;
}
.notice{
  border-left:3px solid var(--stripe-purple)!important;
  background:linear-gradient(90deg,var(--stripe-purple-soft),#fff)!important;
}
.src,code,pre,.log,.sources{
  font-family:'Source Code Pro',ui-monospace,SFMono-Regular,Menlo,monospace!important;
  font-size:12px!important;
  color:#334155!important;
}
.log,.sources,pre{background:#f8fbff!important;border:1px solid var(--stripe-line)!important;border-radius:6px!important;padding:12px!important;box-shadow:rgba(23,23,23,.04) 0 2px 8px!important;white-space:pre-wrap!important}
.card[style]{background:rgba(255,255,255,.94)!important}
canvas{background:linear-gradient(180deg,#fff,#f8fbff)!important;border-radius:6px!important}
hr{border:0!important;border-bottom:1px solid var(--stripe-line)!important}
.modal{background:rgba(6,27,49,.38)!important;backdrop-filter:blur(8px)}
.modal-card{border-radius:8px!important}
.scenario{display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:12px!important;align-items:end!important}
.bigrec{color:var(--stripe-heading)!important;font-size:24px!important;line-height:1.16!important;letter-spacing:-.24px!important;font-weight:300!important}
/* Command-centre iframes are often tablet-width after the left rail is removed.
   Keep multi-column KPI layouts alive there; only collapse to one column on truly
   narrow mobile widths. */
@media(max-width:620px){
  .wrap{padding:24px 16px!important}
  h1{font-size:34px!important;letter-spacing:-.6px!important}
  .hero{display:block!important}
  .span3,.span4,.span5,.span6,.span7,.span8{grid-column:span 12!important}
  .dept-grid,.scenario{grid-template-columns:1fr!important}
}
`;

module.exports = { THEME_NAME, THEME_CSS_FILENAME, THEME_TOKENS, STRIPE_CFO_CSS };
