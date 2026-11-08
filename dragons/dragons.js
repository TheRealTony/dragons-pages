"use strict";
// Dragons (Ligue de hockey LHAI St-Constant) – horaire, classement, statistiques, alignements.
// Data: the league site's Shark "Router.php" feed (same system as the Dek Rive-Sud page), read through
// the dragons-relay Cloudflare worker because the league site does not let other pages read it directly.
// When the league cannot be read, the page falls back on the saved copy embedded in index.html (#snapshot),
// rewritten by tools/maj-dragons.ps1.

// ---------- Config ----------
const SITE = "https://hockeylhai-stconstant.com";
const PROXY_URL = "https://dragons-relay.tony-browne2010.workers.dev/?url=";
const FIRST_YEAR = 2021;                 // season menu goes back to 2021-2022 (or as far as the league keeps)
const LS_PREFIX = "dragons_";
const GAME_MINUTES = 60;                 // used for the calendar export
const DRAGONS_NO = "615";                // team opened by default
const DRAGONS_COLOUR = "#FDB714";        // the league lists the Dragons in white: use the club's gold instead
const DRAGONS_LOGO = "Dragons_logo.jpg"; // the league has no logo for the Dragons

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const dec = (n, d = 2) => n == null ? "–" : n.toFixed(d).replace(".", EN ? "." : ",");

// ---------- Language (French by default; English when chosen with the FR | EN switch or ?lang=en) ----------
const LANG = (() => {
    const q = new URLSearchParams(location.search).get("lang");
    try {
        if (q === "en" || q === "fr") { localStorage.setItem(LS_PREFIX + "lang", JSON.stringify(q)); return q; }
        return JSON.parse(localStorage.getItem(LS_PREFIX + "lang")) === "en" ? "en" : "fr";
    } catch { return q === "en" ? "en" : "fr"; }
})();
const EN = LANG === "en";
const T = (fr, en) => EN ? en : fr;
const LOC = EN ? "en-CA" : "fr-CA";
const plural = (n, fr, en) => `${n} ${T(fr, en)}${n > 1 ? "s" : ""}`;
document.documentElement.lang = LANG;

const fmtDayShort = new Intl.DateTimeFormat(LOC, { weekday: "short", day: "numeric", month: "short" });
const fmtTime = new Intl.DateTimeFormat(LOC, { hour: "numeric", minute: "2-digit" });
const fmtDayLong = new Intl.DateTimeFormat(LOC, { weekday: "long", day: "numeric", month: "long" });
const fmtDate = new Intl.DateTimeFormat(LOC, { day: "numeric", month: "short", year: "numeric" });
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const ordinal = (n) => EN ? `${n}${[, "st", "nd", "rd"][(n % 100 >> 3 ^ 1 && n % 10)] || "th"}` : n === 1 ? "1ᵉʳ" : `${n}ᵉ`;
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;

// League names are French only (the feed's English fields are empty): translate the usual words
const WORDS_EN = [
    [/(?<!\p{L})s[eé]ries(?!\p{L})/giu, "Playoffs"], [/\bautomne\b/gi, "Fall"], [/\bhiver\b/gi, "Winter"], [/(?<!\p{L})[eé]t[eé](?!\p{L})/giu, "Summer"], [/\bprintemps\b/gi, "Spring"],
    [/\blundi\b/gi, "Monday"], [/\bmardi\b/gi, "Tuesday"], [/\bmercredi\b/gi, "Wednesday"], [/\bjeudi\b/gi, "Thursday"], [/\bvendredi\b/gi, "Friday"],
    [/\bsamedi\b/gi, "Saturday"], [/\bdimanche\b/gi, "Sunday"], [/(?<!\p{L})[eé]quipes inactives(?!\p{L})/giu, "Inactive teams"], [/\bglace\b/gi, "Rink"],
];
const leagueText = (s) => EN ? WORDS_EN.reduce((t, [re, w]) => t.replace(re, w), String(s || "")) : String(s || "");
// "SERIES ETE 2026" -> "Séries été 2026" / "Summer 2026 Playoffs"; names typed in mixed case by the league are kept as typed
function seasonLabel(name, dropSeries = false) {
    let s = String(name || "").trim().replace(/\s+/g, " ");
    if (s === s.toUpperCase()) s = s.toLowerCase();
    s = s.replace(/(?<!\p{L})[eé]t[eé](?!\p{L})/giu, "été").replace(/(?<!\p{L})s[eé]ries(?!\p{L})/giu, "séries");
    const series = /^séries\s+/i.test(s);
    if (dropSeries || EN) s = s.replace(/^séries\s+/i, "");
    if (EN) { s = cap(leagueText(s)); return series && !dropSeries ? `${s} Playoffs` : s; }
    return cap(s);
}
// Penalty names (and suspension reasons) in English when they are one of the usual infractions
const PEN_EN = [
    ["DOUBLE ECHEC", "Cross-checking"], ["DOUBLE-ECHEC", "Cross-checking"], ["DOUBLE MINEURE", "Double minor"], ["RETENIR LE BATON", "Holding the stick"], ["RETENIR", "Holding"],
    ["ACCROCHER", "Hooking"], ["FAIRE TREBUCHER", "Tripping"], ["TREBUCHER", "Tripping"], ["CINGLER", "Slashing"], ["DARDER", "Spearing"], ["RUDESSE", "Roughing"],
    ["BATON ELEVE", "High-sticking"], ["OBSTRUCTION", "Interference"], ["MISE EN ECHEC PAR DERRIERE", "Checking from behind"], ["MISE EN ECHEC A LA TETE", "Check to the head"],
    ["CONTACT A LA TETE", "Head contact"], ["MISE EN ECHEC CONTRE LA BANDE", "Boarding"], ["PLAQUAGE", "Boarding"], ["MISE EN ECHEC", "Body checking"], ["ASSAUT", "Charging"],
    ["COUP DE COUDE", "Elbowing"], ["COUP DE GENOU", "Kneeing"], ["COUP DE PIED", "Kicking"], ["COUP DE TETE", "Head-butting"], ["DONNER DE LA TETE", "Head-butting"],
    ["CONDUITE ANTISPORTIVE", "Unsportsmanlike conduct"], ["TROP DE JOUEURS", "Too many players"], ["RETARDER", "Delay of game"], ["BAGARRE", "Fighting"],
    ["GROSSIERE INCONDUITE", "Gross misconduct"], ["INCONDUITE DE PARTIE", "Game misconduct"], ["INCONDUITE DE MATCH", "Match misconduct"], ["INCONDUITE", "Misconduct"],
    ["SIMULATION", "Diving"], ["PLONGEON", "Diving"], ["ABUS", "Abuse of officials"], ["EQUIPEMENT ILLEGAL", "Illegal equipment"], ["LANCER LE BATON", "Throwing the stick"],
    ["BATON BRISE", "Broken stick"], ["GARDIEN", "Goalkeeper interference"], ["MAJEURE", "Major"], ["MINEURE", "Minor"], ["PUNITION DE BANC", "Bench minor"],
];
const penaltyText = (s) => {
    if (!EN || !s) return s || "";
    const n = norm(s).replace(/-/g, " ");
    const hit = PEN_EN.find(([fr]) => n.startsWith(fr.replace(/-/g, " ")));
    return hit ? hit[1] + (/\bMAJ/.test(n) && hit[1] !== "Major" ? " (major)" : "") : s;
};

const LS = {
    get(k, fallback = null) { try { const v = localStorage.getItem(LS_PREFIX + k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(LS_PREFIX + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
    del(k) { try { localStorage.removeItem(LS_PREFIX + k); } catch { /* ignore */ } },
};

// Team colours: the league gives two per team; keep one that reads on white and on dark backgrounds
function luminance(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return null;
    const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255)
        .map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
    return .2126 * r + .7152 * g + .0722 * b;
}
const DEFAULT_ACCENT = DRAGONS_COLOUR;
function teamColour(c1, c2) {
    for (const c of [c1, c2]) {
        const l = luminance(c);
        if (l != null && l > .03 && l < .75) return `#${c.replace("#", "")}`;
    }
    return DEFAULT_ACCENT;
}
const inkFor = (hex) => (luminance(hex) ?? 0) > .42 ? "#141922" : "#ffffff";

// ---------- League feed ----------
function flatParams(prefix, v, out) {
    if (v && typeof v === "object") {
        (Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v)).forEach(([k, x]) => flatParams(`${prefix}[${k}]`, x, out));
    } else out.push([prefix, v == null ? "" : String(v)]);
}
const cols = (spec) => spec.split(",").map(c => { const [name, type] = c.split(":"); return { columnData: [{ name, type }] }; });

function routerUrl(module, params = {}, path = "", configSection = "") {
    const q = [["type", "data"], ["path", path], ["module", module], ["lang", "fr"], ["lang_link_prefix", ""]];
    if (configSection) q.push(["configSection", configSection]);
    flatParams("params", params, q);
    return `${SITE}/shark_modules/modules/Router.php?` + q.map(([k, v]) => `${encodeURIComponent(k).replace(/%5B/g, "[").replace(/%5D/g, "]")}=${encodeURIComponent(v)}`).join("&");
}

let route = 0;        // 0 = through the relay, 1 = league site directly (only works if the league ever allows it)
const memo = new Map();
async function fetchJSON(url) {
    const routes = [PROXY_URL + encodeURIComponent(url), url];
    let lastErr;
    for (let i = route; i < routes.length; i++) {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const resp = await fetch(routes[i], { cache: "no-store" });
                if (resp.ok) { route = i; return await resp.json(); }
                lastErr = new Error(`HTTP ${resp.status}`);
                if (resp.status < 500) break;
            } catch (e) { lastErr = e; }
            await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
        }
    }
    throw lastErr;
}
// Saved copy of the league data (index.html #snapshot, written by tools/maj-dragons.ps1): answers stored by module
// and main parameters. Used only when the league cannot be read; once that happens, the page stays on the saved copy
// until the refresh button is pressed.
const SNAP = (() => { try { const v = JSON.parse(document.getElementById("snapshot")?.textContent || "null"); return v?.answers ? v : null; } catch { return null; } })();
const snapKey = (module, p) => [module, ...["year", "seasonNo", "classNo", "teamNo", "minTeamGoalerGamesPercentage"].map(k => p?.[k] ?? "")].join("|");
const offline = { on: false, used: false };
function fromSnapshot(module, params) {
    const k = !Array.isArray(params) && SNAP && snapKey(module, params);
    if (!k || !(k in SNAP.answers)) return undefined;
    offline.used = true;
    return SNAP.answers[k];
}

// fresh = skip the in-memory copy (refresh button, live games)
function api(module, params, path = "", configSection = "", fresh = false) {
    const url = routerUrl(module, params, path, configSection);
    if (!fresh && memo.has(url)) return memo.get(url);
    const saved = () => fromSnapshot(module, params);
    const p = offline.on
        ? (saved() !== undefined ? Promise.resolve(saved()) : Promise.reject(new Error("Hors ligne")))
        : fetchJSON(url).catch(e => {
            const v = saved();
            if (v !== undefined) { offline.on = true; return v; }
            memo.delete(url); throw e;
        });
    memo.set(url, p);
    return p;
}
const soft = (p) => p.catch(e => { console.warn("Lecture impossible", e); return null; });

const CAL_COLS = cols("GameNo:GameNoText,GameDate:DatedddDMMMYYYY,TeamLogoCityNameAwayCalendar:TeamImageNameCity,CalendarResult:CalendarResult,TeamLogoCityNameLocalCalendar:TeamImageNameCity,TimeStatus:TimeStatus,PlaceLink:Link");
const PLAYER_COLS = cols("Rank:Text,TeamRosterPlayerNumber:Text,PlayerLogoNameWithPosition:ImageNameCityRookie,TeamPlayerPJ:Text,TeamB:Text,TeamA:Text,TeamPlayerPTS:Text,PUN:Text,BAN:Text,BDN:Text,BG:Text");
const GOALIE_COLS = cols("Rank:Text,PlayerLogoNameWithPosition:ImageNameCityRookie,TeamGoalerPJ:Text,TeamGoalerV:Text,TeamGoalerDR:Text,TeamGoalerDP:Text,TeamGoalerDF:Text,TeamGoalerN:Text,TeamGoalerBL:Text,TeamGoalerTR:Text,TeamGoalerBC:Text,TeamEFF:Text,TeamMOY:Number_Two_Precision");
const ROSTER_COLS = cols("TeamRosterPlayerNumber:Text,TeamRosterPlayer:ImageNameLink,TeamRosterPosition:Text");
const SUSP_COLS = cols("SuspensionDate:DateYYYYMMDD,SuspensionPlayerImageName:ImageNameLink,SuspensionTeam:Text,SuspensionMotif:Text,SuspensionPartsNb:SuspensionNbParties,SuspensionEndDate:DateAndTime");
const GAME_STATS_COLS = cols("GameExtraTeamAbbr:DynamicText,GameExtraFinal:Text,GameExtraShots:Text,GameExtraPP:Text,GameExtraPun:Text");
const CAREER_PLAYER_COLS = cols("CareerSeason:SeasonTeam,CareerPJ:Text,CareerB:Text,CareerA:Text,CareerPTS:Text,CareerPUN:Text");
const CAREER_GOALIE_COLS = cols("CareerSeason:SeasonTeam,CareerGoalerPJ:Text,CareerGoalerV:Text,CareerGoalerDR:Text,CareerGoalerDP:Text,CareerGoalerDF:Text,CareerGoalerN:Text,CareerGoalerBL:Text,CareerGoalerTR:Text,CareerGoalerBC:Text,TeamEFF:Text,TeamMOY:Number_Two_Precision");

// Asking for resized pictures makes the feed answer with full picture addresses (otherwise they are broken relative paths)
const RC = [{ width: 96, height: 96 }];
const Q = {
    years: () => api("AvailableYears", {}, "Utilities/"),
    seasons: (year) => api("AvailableSeason", { year }, "Utilities/"),
    classes: (s) => api("AvailableSeasonClasses", { seasonNo: s }, "Utilities/"),
    classTeams: (s, sc) => api("AvailableSeasonClassTeams", { seasonNo: s, classNo: sc }, "Utilities/"),
    team: (s, t, fresh) => api("Team", { seasonNo: s, teamNo: t, resizer_cache: RC }, "", "", fresh),
    calendar: (s, t, fresh) => api("TeamCalendar", { columns: CAL_COLS, teamNo: t, seasonNo: s, resizer_cache: RC }, "", "", fresh),
    players: (s, t, fresh) => api("TeamPlayerStats", { columns: PLAYER_COLS, teamNo: t, seasonNo: s, resizer_cache: RC }, "", "", fresh),
    goalies: (s, t, min, fresh) => api("TeamGoalieStats", { columns: GOALIE_COLS, teamNo: t, seasonNo: s, minTeamGoalerGamesPercentage: min ? 1 : 0, resizer_cache: RC }, "", "", fresh),
    roster: (s, t) => api("TeamRoster", { columns: ROSTER_COLS, teamNo: t, seasonNo: s, resizer_cache: RC }),
    standing: (s, sc, fresh) => api("Standing", { seasonNo: s, classNo: sc, resizer_cache: RC }, "", "StandingConfig", fresh),
    susp: (s, fresh) => api("Suspension", { columns: SUSP_COLS, seasonNo: s, classNo: "", resizer_cache: RC }, "", "", fresh),
    playerInfo: (p) => api("PlayerInfo", { playerNo: p, playNo: "", resizer_cache: RC }),
    // Game summary (Sommaire du match)
    board: (g, fresh) => api("GameBoard", { gameNo: g, resizer_cache: RC }, "", "", fresh),
    gameStats: (g, fresh) => api("GameExtraInfo", { columns: GAME_STATS_COLS, gameNo: g }, "", "", fresh),
    goals: (g, fresh) => api("GameSummaryGoals", [
        { columns: [{ header: "Period", colspan: 2, columnData: [{ name: "GameGoalsAbbr", type: "TextNoTranslate" }, { name: "GameGoalsInfo", type: "GameGoals" }] }], noData: "", resizer_cache: RC, gameNo: g },
        { columns: cols("Rank:Text,SOTeamAbbr:Text,SOResult:SOResult,SOPlayer:PlayerName"), noData: "", resizer_cache: RC, gameNo: g },
    ], "GameSummary/", "", fresh),
    penalties: (g, fresh) => api("GameSummaryPenalties", { columns: [{ header: "Period", colspan: 3, columnData: [{ name: "GamePenalityAbbr", type: "TextNoTranslate" }, { name: "GamePenalityTime", type: "Text" }, { name: "GamePenalityInfo", type: "GamePenality" }] }], noData: "", resizer_cache: RC, gameNo: g }, "GameSummary/", "", fresh),
    career: (p, goalie) => api("PlayerStats", { columns: goalie ? CAREER_GOALIE_COLS : CAREER_PLAYER_COLS, playerNo: p, playNo: "", position: goalie ? "goalie" : "player", type: "career" }, "Stats/"),
};

// ---------- Parsing (the feed answers with display tables: rows of named cells) ----------
const tableRows = (t) => Array.isArray(t?.data)
    ? t.data.map(r => Object.fromEntries((r.columns || []).map(c => [c.name, c.value || []])))
    : null;

// Team logos live on the league management server, not on the public site
const IMG_HOST = "https://admin.gestionsharkhockey.com";
const logoUrl = (p) => !p || /no_img|\/\d+x\d+-$/.test(p) ? "" : /^(https?|data):/.test(p) || !p.includes("/") ? p : `${IMG_HOST}${p.startsWith("/") ? "" : "/"}${p}`;
// The Dragons get the club's gold and logo wherever they appear
const brand = (t) => t && t.no === DRAGONS_NO ? { ...t, colour: DRAGONS_COLOUR, logo: t.logo || DRAGONS_LOGO } : t;
// The management server resizes any picture on request (…/resizer_cache/data/…/96x96-<file>): player photos come
// at full size (often 100 kB+), so lists ask for small square copies.
function sized(p, w = 96, h = w) {
    const u = logoUrl(p);
    const m = u.match(/^(https:\/\/admin\.gestionsharkhockey\.com)\/(?:resizer_cache\/)?(data\/.*\/)(?:\d+x\d+-)?([^/]+)$/);
    return m ? `${m[1]}/resizer_cache/${m[2]}${w}x${h}-${m[3]}` : u;
}
const initials = (name) => { const w = String(name || "").trim().split(/\s+/).filter(Boolean); return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : (w[0] || "").slice(0, 2)).toUpperCase(); };
// Player photo; the initials show through when there is no photo or it fails to load
const avatar = (url, name, cls = "") => `<span class="av${cls ? " " + cls : ""}" aria-hidden="true"><i>${esc(initials(name))}</i>${url ? `<img src="${esc(sized(url))}" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>`;
// Team logo; teams without one get their abbreviation on their colour
const teamMark = (t, cls = "") => `<span class="tlogo${cls ? " " + cls : ""}" style="--dot:${esc(t?.colour || "var(--border)")};--dot-ink:${esc(inkFor(t?.colour || "#888888"))}" aria-hidden="true">
    <b>${esc((t?.abbr || initials(t?.name) || "?").slice(0, 4))}</b>${t?.logo ? `<img src="${esc(sized(t.logo))}" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>`;

function parseGames(t) {
    // Team cell: [logo, ?, ?, ?, colour 1, colour 2, abbreviation, season, team no, name, ?]
    const side = (v = []) => brand({ no: v[8] || "", name: (v[9] || "").trim(), abbr: v[6] || "", logo: logoUrl(v[0]), colour: teamColour(v[4], v[5]) });
    return (tableRows(t) || []).map(c => {
        const date = c.GameDate?.[0], ts = c.TimeStatus || [];
        const status = ts[0] || "", time = ts[1] || "", note = ts[4] || "";
        const [a, h] = (c.CalendarResult?.[0] || "").split("-").map(int);
        const start = date ? new Date(`${date}T${time || "00:00:00"}`) : null;
        return {
            no: c.GameNo?.[1] || "",
            start: start && !isNaN(start) ? start : null,
            hasTime: !!time,
            status,                         // "" (not started), "END", "FORFAIT", or a live status
            period: ts[2] || "",
            shootout: /fusil/i.test(note),
            away: side(c.TeamLogoCityNameAwayCalendar),
            home: side(c.TeamLogoCityNameLocalCalendar),
            score: status ? { a, h } : null,    // "0 - 0" is sent for games not started yet
            surface: c.PlaceLink?.[1] || "",
        };
    }).filter(g => g.start);
}

function parseStanding(t) {
    const rows = tableRows(t);
    return rows && rows.map(c => {
        const id = c.TeamLogoCityName || [];
        const v = int(c.TeamV?.[0]), dr = int(c.TeamDR?.[0]), dp = int(c.TeamDP?.[0]), df = int(c.TeamDF?.[0]), pj = int(c.TeamPJ?.[0]), n = int(c.TeamN?.[0]);
        return brand({
            rank: int(c.Rank?.[0]) || null, no: id[8] || "", name: (id[1] || "").trim(), abbr: id[6] || "", logo: logoUrl(id[0]),
            colour: teamColour(id[4], id[5]),
            pj, v, dr, dp, df, n, losses: dr + dp + df,
            pts: int(c.TeamPTS?.[0]), bp: int(c.TeamBP?.[0]), bc: int(c.TeamBC?.[0]), diff: int(c.TeamDIFF?.[0]),
        });
    });
}

function parsePlayers(t) {
    const rows = tableRows(t);
    return rows && rows.map(c => ({
        id: c.PlayerLogoNameWithPosition?.[4] || "", img: c.PlayerLogoNameWithPosition?.[0] || "",
        num: c.TeamRosterPlayerNumber?.[0] || "", name: (c.PlayerLogoNameWithPosition?.[1] || "").trim(),
        pj: int(c.TeamPlayerPJ?.[0]), b: int(c.TeamB?.[0]), a: int(c.TeamA?.[0]), pts: int(c.TeamPlayerPTS?.[0]), pun: int(c.PUN?.[0]),
        ban: int(c.BAN?.[0]), bdn: int(c.BDN?.[0]), bg: int(c.BG?.[0]),
    }));
}

function parseGoalies(...tables) {
    const seen = new Set(), out = [];
    tables.forEach(t => (tableRows(t) || []).forEach(c => {
        const id = c.PlayerLogoNameWithPosition?.[4] || "", name = (c.PlayerLogoNameWithPosition?.[1] || "").trim();
        if (seen.has(id || name)) return;
        seen.add(id || name);
        out.push({
            id, name, img: c.PlayerLogoNameWithPosition?.[0] || "", pj: int(c.TeamGoalerPJ?.[0]), v: int(c.TeamGoalerV?.[0]),
            d: int(c.TeamGoalerDR?.[0]) + int(c.TeamGoalerDP?.[0]) + int(c.TeamGoalerDF?.[0]), n: int(c.TeamGoalerN?.[0]),
            bl: int(c.TeamGoalerBL?.[0]), tr: int(c.TeamGoalerTR?.[0]), bc: int(c.TeamGoalerBC?.[0]),
            eff: num(c.TeamEFF?.[0]), moy: num(c.TeamMOY?.[0]),
        });
    }));
    return tables.every(t => !t) ? null : out.sort((a, b) => b.pj - a.pj || b.v - a.v);
}

const POS = { attaquant: "A", defenseur: "D", gardien: "G" };
function parseRoster(t) {
    const rows = tableRows(t);
    return rows && rows.map(c => ({
        id: c.TeamRosterPlayer?.[2] || "",
        num: c.TeamRosterPlayerNumber?.[0] || "",
        name: (c.TeamRosterPlayer?.[1] || "").trim(),
        pos: POS[norm(c.TeamRosterPosition?.[0]).toLowerCase()] || "",
    })).filter(p => p.id);
}

function parseSusp(t) {
    const rows = tableRows(t);
    return rows && rows.map(c => {
        const end = c.SuspensionEndDate || [];
        const endDate = end[0] && !end[0].startsWith("0000") ? new Date(`${end[0]}T${end[1] || "23:59:00"}`) : null;
        const date = c.SuspensionDate?.[0] ? new Date(`${c.SuspensionDate[0]}T00:00:00`) : null;
        const parts = c.SuspensionPartsNb || [];
        return {
            date: date && !isNaN(date) ? date : null,
            id: c.SuspensionPlayerImageName?.[2] || "", img: c.SuspensionPlayerImageName?.[0] || "",
            name: (c.SuspensionPlayerImageName?.[1] || "").trim(),
            abbr: c.SuspensionTeam?.[0] || "",
            reason: c.SuspensionMotif?.[0] || "",
            served: int(parts[0]), games: int(parts[1] ?? parts[0]),
            end: endDate && !isNaN(endDate) ? endDate : null,
        };
    });
}
const isActiveSusp = (x) => x.end ? x.end.getTime() >= Date.now() : x.games > 0 && x.served < x.games;

function parseCareer(t, goalie) {
    return (tableRows(t) || []).map(c => {
        const s = c.CareerSeason || [];
        const row = { season: s[0] || "", team: (s[1] || "").trim(), div: s[2] || "", seasonNo: s[4] || "", teamNo: s[5] || "" };
        row.series = /^SERIES/.test(norm(row.season));
        if (goalie) Object.assign(row, {
            pj: int(c.CareerGoalerPJ?.[0]), v: int(c.CareerGoalerV?.[0]),
            d: int(c.CareerGoalerDR?.[0]) + int(c.CareerGoalerDP?.[0]) + int(c.CareerGoalerDF?.[0]), n: int(c.CareerGoalerN?.[0]),
            tr: int(c.CareerGoalerTR?.[0]), bc: int(c.CareerGoalerBC?.[0]), eff: num(c.TeamEFF?.[0]), moy: num(c.TeamMOY?.[0]),
        });
        else Object.assign(row, {
            pj: int(c.CareerPJ?.[0]), b: int(c.CareerB?.[0]), a: int(c.CareerA?.[0]), pts: int(c.CareerPTS?.[0]),
            pun: int(String(c.CareerPUN?.[0] || "0").split(":")[0]),
        });
        return row;
    }).filter(r => r.season);
}

// ---------- Game status ----------
const LONG_AGO = () => Date.now() - 3 * 3600 * 1000;
const isFinal = (g) => g.status === "END" || g.status === "FORFAIT" || (!!g.status && g.start.getTime() < LONG_AGO());
const isLive = (g) => !!g.status && !isFinal(g);
// Finished = final, or started more than 3 h ago (score not entered yet)
const isPlayed = (g) => isFinal(g) || (!g.status && g.start.getTime() < LONG_AGO());
const RESULT_LABEL = EN ? { win: "Win", loss: "Loss", tie: "Tie" } : { win: "Victoire", loss: "Défaite", tie: "Nulle" };

function resultOf(g, teamNo) {
    if (!g.score || !isFinal(g)) return null;
    const home = g.home.no === teamNo;
    const mine = home ? g.score.h : g.score.a, theirs = home ? g.score.a : g.score.h;
    return mine > theirs ? "win" : mine < theirs ? "loss" : "tie";
}
const oppOf = (g, teamNo) => g.home.no === teamNo ? g.away : g.home;
const scoreFor = (g, teamNo) => g.home.no === teamNo ? `${g.score.h}-${g.score.a}` : `${g.score.a}-${g.score.h}`;

// ---------- State ----------
const state = {
    loading: false,
    error: null,
    years: [],          // [{ no, name, start }]
    seasons: [],        // every season of every year: { no, name, yearNo, yearName, kind: "regular" | "series" | "challenge", isDefault }
    seasonNo: null,     // regular season chosen in the menu
    playoffs: false,    // the current season always opens first, regular season unless the league is in its playoffs
    classes: [],        // divisions of the season shown: { classNo, scNo, name }
    classNo: null,      // stable division id (class_no)
    teams: [],          // teams of the division: { no, name }
    teamNo: null,
    team: null,         // Team module answer
    missing: false,     // the chosen team did not play the season shown
    games: [], standing: null, players: null, goalies: null, susp: null,
    view: LS.get("view", "games"),     // "games" | "standings" | "stats" | "susp"
    tab: null,          // "upcoming" | "results"
    opp: "",            // Résultats filter: opponent team no
};

const seriesOf = (regular) => regular && state.seasons.find(s => s.kind === "series" && s.yearNo === regular.yearNo && norm(s.name).replace(/^SERIES /, "") === norm(regular.name));
const regularSeason = () => state.seasons.find(s => s.no === state.seasonNo) || null;
const shownSeason = () => { const r = regularSeason(); return state.playoffs ? seriesOf(r) || r : r; };
const shownSeasonNo = () => shownSeason()?.no || null;
const currentClass = () => state.classes.find(c => c.classNo === state.classNo) || null;
const standRow = (no) => state.standing?.find(r => r.no === no) || null;
const seasonStarted = () => !!state.standing && state.standing.some(r => r.pj > 0);
const myTeamName = () => state.team?.st_equip_name || state.teams.find(t => t.no === state.teamNo)?.name || T("Équipe", "Team");

function recordText(no) {
    const r = standRow(no);
    if (!r || !seasonStarted()) return "";
    return `${r.v}-${r.losses}-${r.n}${r.rank ? ` · ${ordinal(r.rank)}` : ""}`;
}

function applyTeamColour() {
    const t = state.team;
    const c = !t || String(t.st_equip_no) === DRAGONS_NO ? DRAGONS_COLOUR : teamColour(t.st_equip_color_1, t.st_equip_color_2);
    document.documentElement.style.setProperty("--accent", c);
    document.documentElement.style.setProperty("--accent-ink", inkFor(c));
    document.documentElement.style.setProperty("--team", c);
}

// ---------- Loading ----------
let loadToken = 0;
const progress = (on) => {
    $("#refreshBtn").classList.toggle("spinning", on);
    const bar = $("#progressBar");
    bar.style.opacity = on ? "1" : "0";
    bar.style.width = on ? "60%" : "100%";
};

async function loadSeasons() {
    const years = (await Q.years()) || [];
    state.years = years.map(y => ({ no: String(y.sy_no), name: y.sy_name, start: int(y.sy_name), isDefault: !!y.default }))
        .filter(y => y.start >= FIRST_YEAR).sort((a, b) => b.start - a.start);
    const lists = await Promise.all(state.years.map(y => soft(Q.seasons(y.no))));
    state.seasons = [];
    lists.forEach((list, i) => (list || []).forEach(s => {
        const n = norm(s.sais_name);
        state.seasons.push({
            no: String(s.sais_no), name: s.sais_name, yearNo: state.years[i].no, yearName: state.years[i].name,
            kind: /^SERIES/.test(n) ? "series" : /AUTOMNE|ETE|HIVER|PRINTEMPS/.test(n) && !/CHALLENGE/.test(n) ? "regular" : "challenge",
            isDefault: !!s.default && state.years[i].isDefault,
        });
    }));
}

function pickDefaultSeason() {
    const def = state.seasons.find(s => s.isDefault);
    if (def?.kind === "regular") return def.no;
    if (def?.kind === "series") {
        const reg = state.seasons.find(s => s.kind === "regular" && s.yearNo === def.yearNo && norm(def.name).replace(/^SERIES /, "") === norm(s.name));
        if (reg) { state.playoffs = true; return reg.no; }
    }
    return state.seasons.find(s => s.kind === "regular")?.no || null;
}

// Loads the divisions of the season shown, then the chosen team (kept across seasons by its team number)
async function loadSeason() {
    const token = ++loadToken;
    const s = shownSeasonNo();
    Object.assign(state, { loading: true, error: null, missing: false, games: [], standing: null, team: null });
    progress(true); renderAll();
    try {
        const classes = await Q.classes(s);
        if (token !== loadToken) return;
        state.classes = (classes || []).filter(c => !/^(LOCATIONS|EQUIPES INACTIVES)$/.test(norm(c.class_desc_fr)))
            .map(c => ({ classNo: String(c.class_no), scNo: String(c.sc_no), name: c.class_desc_fr }));

        // The team decides the division when it played this season
        let team = null;
        if (state.teamNo) {
            team = await soft(Q.team(s, state.teamNo));
            if (token !== loadToken) return;
            const sc = team && team.st_sc_no && String(team.st_sc_no);
            const cls = sc && state.classes.find(c => c.scNo === sc);
            if (cls) state.classNo = cls.classNo;
            else { team = null; state.missing = true; }
        }
        if (!state.classes.some(c => c.classNo === state.classNo)) {
            const saved = LS.get("default_class");
            state.classNo = state.classes.some(c => c.classNo === saved) ? saved : state.classes[0]?.classNo || null;
        }
        await loadDivision(token, team);
    } catch (e) {
        console.warn(e);
        if (token !== loadToken) return;
        Object.assign(state, { loading: false, error: T("Impossible de lire les données de la ligue.", "Could not read the league data.") });
        progress(false); renderAll();
    }
}

async function loadDivision(token = ++loadToken, team = null) {
    const s = shownSeasonNo(), cls = currentClass();
    Object.assign(state, { loading: true, error: null, games: [] });
    progress(true); renderAll();
    const [teams, standing] = cls ? await Promise.all([soft(Q.classTeams(s, cls.scNo)), soft(Q.standing(s, cls.scNo))]) : [null, null];
    if (token !== loadToken) return;
    state.standing = parseStanding(standing);
    const list = new Map();
    (teams || []).forEach(t => list.set(String(t.st_equip_no), (t.st_equip_name || "").trim()));
    (state.standing || []).forEach(r => { if (r.no && !list.has(r.no)) list.set(r.no, r.name); });
    state.teams = [...list].map(([no, name]) => ({ no, name })).sort((a, b) => a.name.localeCompare(b.name, "fr"));

    if (!state.missing && !state.teams.some(t => t.no === state.teamNo)) {
        const saved = LS.get("default_team");
        state.teamNo = state.teams.some(t => t.no === saved) ? saved : state.teams[0]?.no || null;
        team = null;
    }
    if (state.missing || !state.teamNo) {
        Object.assign(state, { loading: false, team: null, games: [], players: null, goalies: null, susp: null });
        applyTeamColour(); progress(false); renderAll();
        return;
    }
    await loadTeam(token, team);
}

async function loadTeam(token = ++loadToken, team = null, fresh = false) {
    const s = shownSeasonNo(), t = state.teamNo;
    Object.assign(state, { loading: true, error: null });
    progress(true);
    if (!fresh) { state.games = []; renderAll(); }
    const [tm, cal, pl, g1, g2, susp] = await Promise.all([
        team ? Promise.resolve(team) : soft(Q.team(s, t, fresh)),
        soft(Q.calendar(s, t, fresh)), soft(Q.players(s, t, fresh)),
        soft(Q.goalies(s, t, true, fresh)), soft(Q.goalies(s, t, false, fresh)), loadSusp(s, fresh),
    ]);
    if (token !== loadToken) return;
    if (!cal) {
        Object.assign(state, { loading: false, error: T("Impossible de lire l'horaire de l'équipe.", "Could not read the team schedule.") });
        progress(false); renderAll();
        return;
    }
    Object.assign(state, {
        loading: false, team: tm && tm.st_equip_no ? tm : null,
        games: parseGames(cal), players: parsePlayers(pl), goalies: parseGoalies(g1, g2), susp,
    });
    if (!fresh) state.tab = null;
    applyTeamColour();
    updateUrl();
    progress(false); renderAll();
}

// Suspensions of the season shown. In Séries mode, suspensions from the regular season that are not
// finished yet carry over to the playoffs, so they are added (tagged) to the Séries list.
async function loadSusp(s, fresh) {
    const reg = regularSeason();
    const carry = state.playoffs && reg && reg.no !== s;
    const [cur, prev] = await Promise.all([soft(Q.susp(s, fresh)), carry ? soft(Q.susp(reg.no, fresh)) : null]);
    const list = parseSusp(cur);
    if (!carry || !prev) return list;
    const key = (x) => [x.id || norm(x.name), x.date?.getTime() || "", norm(x.reason)].join("|");
    const seen = new Set((list || []).map(key));
    const carried = (parseSusp(prev) || []).filter(x => isActiveSusp(x) && !seen.has(key(x))).map(x => ({ ...x, carried: true }));
    return [...(list || []), ...carried];
}

async function refreshAll() {
    memo.clear();
    Object.assign(offline, { on: false, used: false });
    await loadSeason();
}

function updateUrl() {
    try {
        const u = new URL(location.href);
        u.searchParams.set("equipe", state.teamNo);
        u.searchParams.set("saison", shownSeasonNo());
        history.replaceState(null, "", u);
    } catch { /* file:// pages */ }
}

// Live games: re-read the team's calendar every minute while a game is on (or about to start)
setInterval(() => {
    if (state.loading || !state.games.length || document.hidden) return;
    const now = Date.now();
    const hot = state.games.some(g => isLive(g) || (!isPlayed(g) && g.start.getTime() - now < 10 * 60000 && g.start.getTime() - now > -3 * 3600000));
    if (hot) loadTeam(++loadToken, state.team, true);
}, 60000);
// Countdown text on the next-game card
setInterval(() => { const el = document.querySelector("[data-countdown]"); if (el && !state.loading) renderTeam(); }, 60000);

// ---------- Rendering helpers ----------
const ICON_CHEVRON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
const ICON_STAR = `<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>`;
const ICON_CAL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;
const LEAGUE_SITE = () => T("Site de la ligue", "League website");
const ext = (href, label) => `<a class="ext" target="_blank" rel="noopener" href="${esc(href)}">${label} ↗</a>`;
const skeletons = (n, slim = false) => `<div class="cards">${`<div class="skeleton${slim ? " slim" : ""}"></div>`.repeat(n)}</div>`;
// All games are played at the same complex: only the rink name is shown
const surfaceLabel = (s) => leagueText(String(s || "").trim()) || T("Glace à déterminer", "Rink to be announced");
const ICON_PIN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`;
const teamLink = (t, label = t.name) => t.no ? `<button type="button" class="link-btn" data-opp="${esc(t.no)}">${esc(label || T("À déterminer", "TBD"))}</button>` : esc(label || T("À déterminer", "TBD"));
const playerLink = (p) => p.id ? `<button type="button" class="link-btn" data-player="${esc(p.id)}">${esc(p.name)}</button>` : esc(p.name);
const select = (id, label, options, value, disabled = false) => `<div class="select-wrap">
    <select id="${id}" aria-label="${esc(label)}"${disabled ? " disabled" : ""}>${options}</select>${ICON_CHEVRON}</div>`;

function teamRow(team, side, pts, lead, rec, myNo) {
    const cls = ["row"];
    const mine = team.no === myNo;
    if (mine) cls.push("is-r");
    if (lead && lead !== "tie") cls.push(lead === side ? "lead" : "trail");
    return `<div class="${cls.join(" ")}" style="--dot:${esc(team.colour || "var(--border)")}">
        ${teamMark(team)}
        <span class="name" title="${esc(team.name)}">${mine ? esc(team.name) : teamLink(team)}</span>
        ${rec ? `<span class="rec" title="${T("Fiche V-D-N et rang", "W-L-T record and rank")}">${esc(rec)}</span>` : ""}
        <span class="side">${side === "home" ? T("Local", "Home") : T("Visiteur", "Away")}</span>
        ${rec ? "" : `<span class="pts">${pts ?? ""}</span>`}
    </div>`;
}

function gameCard(g, myNo = state.teamNo, withLineup = true) {
    const sc = g.score, live = isLive(g), result = resultOf(g, myNo);
    const lead = sc ? (sc.h > sc.a ? "home" : sc.a > sc.h ? "away" : "tie") : null;
    const when = `${fmtDayShort.format(g.start)}${g.hasTime ? ` · ${fmtTime.format(g.start)}` : ""}`;
    const badges = [];
    if (live) badges.push(`<span class="badge live">${T("En direct", "Live")}${g.period ? ` · ${esc(g.period)}` : ""}</span>`);
    if (result) badges.push(`<span class="badge ${result}">${RESULT_LABEL[result]}</span>`);
    if (g.status === "FORFAIT") badges.push(`<span class="badge">${T("Forfait", "Forfeit")}</span>`);
    if (g.shootout && isFinal(g)) badges.push(`<span class="badge">${T("Fusillade", "Shootout")}</span>`);
    if (isPlayed(g) && !g.status) badges.push(`<span class="badge" title="${T("La ligue n'a pas encore inscrit le pointage", "The league has not entered the score yet")}">${T("Résultat non saisi", "No result entered")}</span>`);
    if (g.no) badges.push(`<span class="badge">#${esc(g.no)}</span>`);

    const upcoming = !sc && !isPlayed(g);
    const awayRec = upcoming && g.away.no !== myNo ? recordText(g.away.no) : "";
    const homeRec = upcoming && g.home.no !== myNo ? recordText(g.home.no) : "";
    const hasLineup = withLineup && !!readLineup(g.no, myNo);
    const lineupBtn = withLineup && myNo === state.teamNo
        ? `<button type="button" class="lu-btn${hasLineup ? " has" : ""}" data-lineup="${esc(g.no)}">${isPlayed(g) ? (hasLineup ? T("Alignement utilisé", "Lineup used") : T("+ Alignement", "+ Lineup")) : T("Alignement", "Lineup")}</button>` : "";
    // Everything stays on this page: the summary opens in the side sheet, like the Roussillon and Chambly pages
    const opp = oppOf(g, myNo);
    const links = g.no ? `<div class="links">
        ${lineupBtn}
        ${opp.no ? `<button type="button" class="lu-btn" data-opp="${esc(opp.no)}">${T("Adversaire", "Opponent")}</button>` : ""}
        ${isFinal(g) ? `<button type="button" class="lu-btn sum" data-summary="${esc(g.no)}">${T("Sommaire", "Summary")}</button>` : ""}
    </div>` : "";

    return `<article class="game${g.home.no === myNo ? " home" : ""}"${result ? ` data-result="${result}"` : ""}>
        <div class="game-top">
            <div class="when">${esc(when)}</div>
            <div class="badges">${badges.join("")}</div>
        </div>
        ${teamRow(g.away, "away", sc?.a, lead, awayRec, myNo)}
        ${teamRow(g.home, "home", sc?.h, lead, homeRec, myNo)}
        <div class="game-foot"><div class="venue">${ICON_PIN}<span>${esc(surfaceLabel(g.surface))}</span></div>${links}</div>
    </article>`;
}

// ---------- Picker ----------
function renderPicker() {
    const el = $("#picker");
    if (!state.seasons.length) { el.innerHTML = state.error ? "" : `<div style="margin-top:16px">${skeletons(1, true)}</div>`; return; }
    const reg = regularSeason(), series = seriesOf(reg);
    const groups = state.years.map(y => {
        const list = state.seasons.filter(s => s.yearNo === y.no && s.kind === "regular");
        return list.length ? `<optgroup label="${esc(y.name)}">${list.map(s =>
            `<option value="${esc(s.no)}"${s.no === state.seasonNo ? " selected" : ""}>${esc(seasonLabel(s.name))}</option>`).join("")}</optgroup>` : "";
    }).join("");
    const classOpts = state.classes.map(c => `<option value="${esc(c.classNo)}"${c.classNo === state.classNo ? " selected" : ""}>${esc(leagueText(c.name))}</option>`).join("");
    const teamOpts = (state.missing && state.teamNo ? `<option value="" selected>${T("Choisir une équipe…", "Choose a team…")}</option>` : "")
        + state.teams.map(t => `<option value="${esc(t.no)}"${t.no === state.teamNo && !state.missing ? " selected" : ""}>${esc(t.name)}</option>`).join("");
    const isDefault = state.teamNo && LS.get("default_team") === state.teamNo;

    el.innerHTML = `<div class="picker">
        <div>
            <span class="field-label">${T("Saison", "Season")}</span>
            <div class="field-row">
                ${select("seasonSelect", T("Saison", "Season"), groups, state.seasonNo)}
                <div class="seg" role="tablist" aria-label="${T("Saison ou séries", "Season or playoffs")}">
                    <button type="button" data-playoffs="0" aria-selected="${!state.playoffs || !series}">${T("Saison", "Season")}</button>
                    <button type="button" data-playoffs="1" aria-selected="${state.playoffs && !!series}"${series ? "" : ` disabled title="${T("Pas de séries pour cette saison", "No playoffs this season")}"`}>${T("Séries", "Playoffs")}</button>
                </div>
            </div>
        </div>
        <div>
            <span class="field-label">${T("Division et équipe", "Division and team")}</span>
            <div class="field-row two">
                ${select("classSelect", "Division", classOpts, state.classNo, !state.classes.length)}
                ${select("teamSelect", T("Équipe", "Team"), teamOpts, state.teamNo, !state.teams.length)}
                <button type="button" class="star-btn" id="starBtn" aria-pressed="${!!isDefault}" title="${T("Ouvrir cette équipe par défaut", "Open this team by default")}"${state.teamNo && !state.missing ? "" : " disabled"}>${ICON_STAR}<span>${T("Par défaut", "Default")}</span></button>
            </div>
        </div>
    </div>`;
}

// ---------- Next game (hero) ----------
function countdown(g) {
    if (isLive(g)) return T("En direct", "Live");
    const now = new Date();
    const mins = Math.round((g.start - now) / 60000);
    const days = Math.round((startOfDay(g.start) - startOfDay(now)) / 86400000);
    if (mins <= 0) return T("Début imminent", "Starting soon");
    if (mins < 60) return T(`Dans ${mins} min`, `In ${mins} min`);
    if (days === 0) return T(`Aujourd'hui · dans ${Math.round(mins / 60)} h`, `Today · in ${Math.round(mins / 60)} h`);
    if (days === 1) return T("Demain", "Tomorrow");
    return T(`Dans ${days} jours`, `In ${days} days`);
}

function nextGameCard() {
    const g = state.games.filter(x => !isPlayed(x)).sort((a, b) => a.start - b.start)[0];
    if (!g) return "";
    const isHome = g.home.no === state.teamNo;
    const me = isHome ? g.home : g.away, opp = isHome ? g.away : g.home;
    const oppRec = recordText(opp.no);
    const day = fmtDayLong.format(g.start);
    const firstGame = !state.games.some(isPlayed);
    return `<article class="next">
        <div class="next-top">
            <span class="next-label">${firstGame ? T("La saison commence", "Season opener") : T("Prochain match", "Next game")}</span>
            <span class="badge ${isLive(g) ? "live" : "duel"}" data-countdown>${esc(countdown(g))}</span>
        </div>
        <div class="next-when">${esc(cap(day))}${g.hasTime ? ` · ${esc(fmtTime.format(g.start))}` : ""}</div>
        <div class="next-match">
            <strong>${esc(me.name || myTeamName())}</strong>
            <span class="vs">${isHome ? T("reçoit", "vs") : T("visite", "at")}</span>
            <strong>${teamLink(opp)}</strong>
            ${oppRec ? `<span class="rec">(${esc(oppRec)})</span>` : ""}
        </div>
        <div class="next-foot">
            <div class="next-venue"><div><b>${esc(surfaceLabel(g.surface))}</b>${isHome ? T("Local", "Home") : T("Visiteur", "Away")} · ${T("partie", "game")} #${esc(g.no)}</div></div>
            <div class="next-btns">
                ${opp.no ? `<button type="button" class="btn ghost" data-opp="${esc(opp.no)}">${T("Adversaire", "Opponent")}</button>` : ""}
                <button type="button" class="btn" data-lineup="${esc(g.no)}">${T("Alignement", "Lineup")}</button>
            </div>
        </div>
    </article>`;
}

// ---------- Horaire ----------
function formStrip(games, teamNo) {
    const last = games.filter(g => isPlayed(g) && resultOf(g, teamNo)).sort((a, b) => b.start - a.start).slice(0, 5).reverse();
    if (!last.length) return "";
    return `<span class="form" aria-label="${T("Cinq dernières parties", "Last five games")}">${last.map(g => {
        const r = resultOf(g, teamNo), opp = oppOf(g, teamNo);
        return `<i class="${r}" title="${esc(`${fmtDayShort.format(g.start)} · ${opp.name} · ${scoreFor(g, teamNo)}`)}">${RESULT_LABEL[r][0]}</i>`;
    }).join("")}</span>`;
}

function mySusp() {
    if (!state.susp) return null;
    const myAbbr = state.team?.st_equip_abbr || standRow(state.teamNo)?.abbr || "";
    const divAbbrs = new Set((state.standing || []).map(r => r.abbr).filter(Boolean));
    return {
        mine: state.susp.filter(x => myAbbr && x.abbr === myAbbr),
        others: state.susp.filter(x => x.abbr !== myAbbr && divAbbrs.has(x.abbr)),
    };
}

function teamHead() {
    const row = standRow(state.teamNo);
    const played = state.games.filter(isPlayed);
    const rec = { win: 0, loss: 0, tie: 0 };
    played.forEach(g => { const r = resultOf(g, state.teamNo); if (r) rec[r]++; });
    if (row && seasonStarted()) Object.assign(rec, { win: row.v, loss: row.losses, tie: row.n });
    const rank = row && seasonStarted() && row.rank
        ? `<span class="rank-badge" title="${T("Rang dans la division", "Rank in the division")}">${ordinal(row.rank)} ${T("sur", "of")} ${state.standing.length} · ${row.pts} pts</span>` : "";
    const nSusp = (mySusp()?.mine || []).filter(isActiveSusp).length;
    const susp = nSusp ? `<button type="button" class="badge loss" data-view="susp">🚫 ${plural(nSusp, "suspension", "suspension")}</button>` : "";
    const img = state.team?.st_equip_img ? sized(state.team.st_equip_img, 160) : state.teamNo === DRAGONS_NO ? DRAGONS_LOGO : "";
    const logo = img ? `<img class="team-logo" src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()">` : "";
    return `<div class="team-head">
        <div class="team-id">
            <span class="team-bar"></span>${logo}
            <div>
                <h3>${esc(myTeamName())}</h3>
                <div class="team-meta">
                    <span class="record" aria-label="${T("Fiche", "Record")}"><span class="w">${rec.win} ${T("V", "W")}</span><span class="l">${rec.loss} ${T("D", "L")}</span><span class="t">${rec.tie} ${T("N", "T")}</span></span>
                    ${rank}${formStrip(state.games, state.teamNo)}${susp}
                </div>
            </div>
        </div>
        <div class="ics-wrap">
            <button type="button" class="ics-btn" id="icsBtn" title="${T("Télécharger l'horaire dans mon calendrier", "Download the schedule to my calendar")}">${ICON_CAL}<span>.ics</span></button>
            <span class="ics-hint" id="icsHint">${T("⬅ Ajouter à mon calendrier", "⬅ Add to my calendar")}</span>
        </div>
    </div>`;
}

function scheduleView() {
    const played = state.games.filter(isPlayed).sort((a, b) => b.start - a.start);
    const upcoming = state.games.filter(g => !isPlayed(g)).sort((a, b) => a.start - b.start);
    const tab = state.tab || (upcoming.length ? "upcoming" : "results");

    const opps = new Map();
    played.forEach(g => { const o = oppOf(g, state.teamNo); if (o.no) opps.set(o.no, { name: o.name, n: (opps.get(o.no)?.n || 0) + 1 }); });
    if (!opps.has(state.opp)) state.opp = "";
    const filter = tab === "results" && opps.size > 1 ? `<div class="opp-pick">${select("oppSelect", T("Filtrer par adversaire", "Filter by opponent"),
        `<option value="">${T("Tous les adversaires", "All opponents")} (${played.length})</option>` + [...opps].sort((a, b) => a[1].name.localeCompare(b[1].name, LOC))
            .map(([no, o]) => `<option value="${esc(no)}"${no === state.opp ? " selected" : ""}>${esc(o.name)} (${o.n})</option>`).join(""))}</div>` : "";
    const list = tab === "upcoming" ? upcoming : played.filter(g => !state.opp || oppOf(g, state.teamNo).no === state.opp);
    const emptyMsg = tab === "upcoming" ? T("Aucune partie à venir.", "No upcoming games.") : T("Aucun résultat pour l'instant.", "No results yet.");

    return `<div class="team">
        <div class="seg sub-tabs" role="tablist">
            <button type="button" role="tab" data-tab="upcoming" aria-selected="${tab === "upcoming"}">${T("À venir", "Upcoming")} <span class="count">${upcoming.length}</span></button>
            <button type="button" role="tab" data-tab="results" aria-selected="${tab === "results"}">${T("Résultats", "Results")} <span class="count">${played.length}</span></button>
        </div>
        ${filter}
        ${list.some(g => g.home.no === state.teamNo) ? `<div class="legend"><i></i>${T("Parties comme équipe locale", "Home games")}</div>` : ""}
        <div class="cards">${list.length ? list.map(g => gameCard(g)).join("") : `<div class="empty">${emptyMsg}</div>`}</div>
    </div>`;
}

// ---------- Classement ----------
function standingsView() {
    const link = ext(`${SITE}/classement/`, LEAGUE_SITE());
    if (!state.standing) return `<div class="notice error" style="margin-top:14px">${T("Classement indisponible pour le moment.", "Standings unavailable right now.")}<br>${link}</div>`;
    if (!state.standing.length) return `<div class="empty" style="margin-top:14px">${T("Aucun classement pour cette saison.", "No standings for this season.")}</div>`;
    const started = seasonStarted();
    const rows = state.standing.slice().sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || a.name.localeCompare(b.name, "fr"));
    const body = rows.map(r => {
        const mine = r.no === state.teamNo, diff = r.diff > 0 ? `+${r.diff}` : r.diff;
        return `<tr class="${mine ? "is-r me" : ""}" style="--dot:${esc(r.colour)}">
            <td class="c-rank">${started && r.rank ? r.rank : "–"}</td>
            <td class="c-team" title="${esc(r.name)}"><span class="cell-id">${teamMark(r, "sm")}${mine ? `<span class="nm">${esc(r.name)}</span>` : teamLink(r)}</span></td>
            <td>${r.pj}</td><td>${r.v}</td><td>${r.dr + r.df}</td><td>${r.dp}</td><td>${r.n}</td>
            <td class="wide">${r.bp}</td><td class="wide">${r.bc}</td><td class="wide">${diff}</td>
            <td class="c-pts">${r.pts}</td>
        </tr>`;
    }).join("");
    return `<div class="panel">
        <div class="panel-title">${esc(leagueText(currentClass()?.name || ""))} · ${esc(seasonLabel(shownSeason()?.name || ""))}</div>
        <div class="table-scroll"><table class="standings">
            <thead><tr>
                <th class="c-rank">#</th><th class="c-team">${T("Équipe", "Team")}</th>
                <th title="${T("Parties jouées", "Games played")}">${T("PJ", "GP")}</th><th title="${T("Victoires", "Wins")}">${T("V", "W")}</th><th title="${T("Défaites (incluant forfaits)", "Losses (including forfeits)")}">${T("D", "L")}</th><th title="${T("Défaites en prolongation ou en fusillade", "Overtime or shootout losses")}">${T("DP", "OTL")}</th><th title="${T("Nulles", "Ties")}">${T("N", "T")}</th>
                <th class="wide" title="${T("Buts pour", "Goals for")}">${T("BP", "GF")}</th><th class="wide" title="${T("Buts contre", "Goals against")}">${T("BC", "GA")}</th><th class="wide" title="${T("Différentiel", "Goal differential")}">+/-</th>
                <th class="c-pts" title="Points">Pts</th>
            </tr></thead>
            <tbody>${body}</tbody>
        </table></div>
        <div class="panel-foot"><span>${started ? T("Classement officiel · touchez une équipe pour sa fiche", "Official standings · tap a team for its card") : T("La saison n'a pas encore commencé.", "The season hasn't started yet.")}</span>${link}</div>
    </div>`;
}

// ---------- Statistiques ----------
// Season totals of the team shown (Team module): power play, penalty kill, penalties, home and away records
function seasonTeamStats(t = state.team) {
    if (!t || t.st_stats_pj == null) return null;
    const ppo = int(t.st_stats_av), ppg = int(t.st_stats_av_goal), pko = int(t.st_stats_desav), pkga = int(t.st_stats_desav_goal);
    return { pj: int(t.st_stats_pj), ppo, ppg, pko, pkga, pk: pko - pkga, pim: int(t.st_stats_pun), pens: int(t.st_stats_nb_pun_min) + int(t.st_stats_nb_pun_maj),
        home: String(t.st_stats_fiche_local || "").replace(/\s+/g, ""), away: String(t.st_stats_fiche_visit || "").replace(/\s+/g, "") };
}
const pctText = (a, b) => b ? `${dec(100 * a / b, 1).replace(/[.,]0$/, "")}${T(" %", "%")}` : "–";
function teamStats() {
    const x = seasonTeamStats();
    if (!x || !x.pj) return "";
    const tile = (label, value, sub = "") => `<div class="gs-box"><div class="gs-label">${label}</div><div class="ts-val"><b>${value}</b>${sub ? `<small>${sub}</small>` : ""}</div></div>`;
    return `<div class="panel ts-panel"><div class="panel-title">${T("Équipe", "Team")} · ${plural(x.pj, "partie", "game")}</div><div class="gs-grid ts-grid">
        ${tile(T("Avantage num.", "Power play"), `${x.ppg}/${x.ppo}`, pctText(x.ppg, x.ppo))}
        ${tile(T("Désavantage num.", "Penalty kill"), `${x.pk}/${x.pko}`, pctText(x.pk, x.pko))}
        ${tile(T("Minutes de punition", "Penalty minutes"), x.pim, T(`${x.pens} pun. · ${dec(x.pim / x.pj, 1)} par match`, `${x.pens} pen. · ${dec(x.pim / x.pj, 1)} per game`))}
        <div class="gs-box"><div class="gs-label">${T("Fiche V-D-N", "W-L-T record")}</div><div class="ts-rec"><span><b>${esc(x.home || "–")}</b> ${T("dom.", "home")}</span><span><b>${esc(x.away || "–")}</b> ${T("vis.", "away")}</span></div></div>
    </div></div>`;
}
function statsView() {
    const link = ext(`${SITE}/equipes/?seasonNo=${encodeURIComponent(shownSeasonNo())}&teamNo=${encodeURIComponent(state.teamNo)}`, LEAGUE_SITE());
    const excel = `<div class="stats-actions"><button type="button" class="btn" id="xlsxBtn">⬇ ${T("Fichier Excel", "Excel file")}</button><span class="hint">${T("Équipe, matchs, joueurs et gardiens de la saison affichée", "Team, games, players and goalies for the season shown")}</span></div>`;
    let players;
    if (!state.players) players = `<div class="notice error">${T("Statistiques des joueurs indisponibles.", "Player stats unavailable.")}<br>${link}</div>`;
    else if (!state.players.length) players = `<div class="empty">${T("Aucune statistique de joueur pour l'instant.", "No player stats yet.")}</div>`;
    else {
        const top = Math.max(...state.players.map(p => p.pts));
        players = `<div class="panel"><div class="panel-title">${T("Joueurs", "Players")}</div><div class="table-scroll"><table class="standings stats">
            <thead><tr><th class="c-num">#</th><th class="c-team">${T("Joueur", "Player")}</th><th title="${T("Parties jouées", "Games played")}">${T("PJ", "GP")}</th><th title="${T("Buts", "Goals")}">${T("B", "G")}</th><th title="${T("Passes", "Assists")}">A</th><th class="c-pts" title="Points">Pts</th>
                <th title="${T("Minutes de punition", "Penalty minutes")}">${T("Pun", "PIM")}</th><th title="${T("Buts en avantage numérique", "Power-play goals")}">${T("BAN", "PPG")}</th><th title="${T("Buts en désavantage numérique", "Shorthanded goals")}">${T("BDN", "SHG")}</th><th title="${T("Buts gagnants", "Game-winning goals")}">${T("BG", "GWG")}</th></tr></thead>
            <tbody>${state.players.map(p => `<tr class="${top > 0 && p.pts === top ? "top" : ""}">
                <td class="c-num">${p.num && p.num !== "0" ? `#${esc(p.num)}` : ""}</td>
                <td class="c-team" title="${esc(p.name)}"><span class="cell-id">${avatar(p.img, p.name)}${playerLink(p)}</span></td>
                <td>${p.pj}</td><td>${p.b}</td><td>${p.a}</td><td class="c-pts">${p.pts}</td><td>${p.pun}</td><td>${p.ban}</td><td>${p.bdn}</td><td>${p.bg}</td>
            </tr>`).join("")}</tbody>
        </table></div></div>`;
    }
    let goalies = "";
    if (state.goalies?.length) {
        goalies = `<div class="panel"><div class="panel-title">${T("Gardiens", "Goalies")}</div><div class="table-scroll"><table class="standings stats">
            <thead><tr><th class="c-team">${T("Gardien", "Goalie")}</th><th title="${T("Parties jouées", "Games played")}">${T("PJ", "GP")}</th><th title="${T("Victoires", "Wins")}">${T("V", "W")}</th><th title="${T("Défaites", "Losses")}">${T("D", "L")}</th><th title="${T("Nulles", "Ties")}">${T("N", "T")}</th>
                <th title="${T("Buts contre", "Goals against")}">${T("BC", "GA")}</th><th title="${T("Moyenne de buts alloués par partie", "Goals-against average")}">${T("Moy", "GAA")}</th><th title="${T("Blanchissages", "Shutouts")}">${T("BL", "SO")}</th></tr></thead>
            <tbody>${state.goalies.map(g => `<tr>
                <td class="c-team" title="${esc(g.name)}"><span class="cell-id">${avatar(g.img, g.name)}${playerLink(g)}</span></td>
                <td>${g.pj}</td><td>${g.v}</td><td>${g.d}</td><td>${g.n}</td><td>${g.bc}</td><td>${dec(g.moy)}</td><td>${g.bl}</td>
            </tr>`).join("")}</tbody>
        </table></div></div>`;
    }
    return `<div class="stats-view">${excel}${teamStats()}${players}${goalies}
        <div class="view-foot"><span>${T("Statistiques officielles · touchez un joueur pour son historique", "Official stats · tap a player for their history")}</span>${link}</div></div>`;
}

// ---------- Suspensions ----------
function suspItem(x, mine) {
    const active = isActiveSusp(x);
    const badge = active
        ? `<span class="badge loss">${x.end ? `${T("Jusqu'au", "Until")} ${esc(fmtDate.format(x.end))}` : x.games ? `${x.served}/${x.games} ${T(`purgée${x.served > 1 ? "s" : ""}`, "served")}` : T("En cours", "Active")}</span>`
        : `<span class="badge win">${T("Terminée", "Over")}</span>`;
    const meta = [x.abbr, x.date ? fmtDate.format(x.date) : "", x.games ? plural(x.games, "partie", "game") : "", x.carried ? T("Saison régulière", "Regular season") : ""].filter(Boolean).join(" · ");
    return `<div class="susp${mine ? " is-r" : ""}${active ? "" : " done"}">
        ${avatar(x.img, x.name, "lg")}
        <div class="susp-main">
            <div class="susp-name">${x.id ? playerLink(x) : esc(x.name || "—")}</div>
            <div class="susp-meta">${esc(meta)}</div>
            ${x.reason ? `<div class="susp-reason">${esc(penaltyText(x.reason))}</div>` : ""}
        </div>
        ${badge}
    </div>`;
}

function suspensionsView() {
    const link = ext(`${SITE}/suspensions/`, LEAGUE_SITE());
    const lists = mySusp();
    const body = !lists ? `<div class="notice error">${T("Suspensions indisponibles pour le moment.", "Suspensions unavailable right now.")}</div>`
        : (lists.mine.length ? lists.mine.map(x => suspItem(x, true)).join("") : `<div class="empty">${T("Aucune suspension pour", "No suspensions for")} ${esc(myTeamName())}.</div>`)
          + (lists.others.length ? `<details class="others"><summary>${T("Autres équipes de la division", "Other teams in the division")} (${lists.others.length})</summary>${lists.others.map(x => suspItem(x, false)).join("")}</details>` : "");
    return `<div class="susp-group">${body}<div class="view-foot"><span>${T("Suspensions officielles", "Official suspensions")}</span>${link}</div></div>`;
}

// ---------- Team view ----------
function missingView() {
    const reg = regularSeason();
    const prev = state.seasons.filter(s => s.kind === "regular");
    const i = prev.findIndex(s => s.no === state.seasonNo);
    const before = i >= 0 ? prev[i + 1] : null;
    return `<div class="notice" style="margin-top:16px">
        ${T("Cette équipe n'a pas joué en", "This team did not play in")} ${esc(seasonLabel(shownSeason()?.name || reg?.name || T("cette saison", "this season")))}.<br>${T("Choisissez une équipe ci-dessus", "Choose a team above")}${before ? ` ${T("ou revenez à la saison précédente.", "or go back to the previous season.")}<br><button type="button" data-season="${esc(before.no)}">${esc(seasonLabel(before.name))}</button>` : "."}
    </div>`;
}

function emptySeasonView() {
    const regs = state.seasons.filter(s => s.kind === "regular");
    const i = regs.findIndex(s => s.no === state.seasonNo);
    const before = i >= 0 ? regs[i + 1] : null;
    return `<div class="notice" style="margin-top:16px">
        ${T("La saison commence bientôt : l'horaire n'est pas encore publié.", "The season starts soon: the schedule isn't published yet.")}
        ${before ? `<br><button type="button" data-season="${esc(before.no)}">${T("Voir", "See")} ${esc(seasonLabel(before.name))}</button>` : ""}
    </div>`;
}

function renderTeam() {
    const view = $("#teamView");
    if (state.loading && !state.games.length) {
        view.innerHTML = `<div style="margin-top:16px">${skeletons(1)}</div><div style="margin-top:14px">${skeletons(4)}</div>`;
        return;
    }
    if (state.error) {
        view.innerHTML = `<div class="notice error" style="margin-top:16px">${esc(state.error)}<br><button type="button" data-action="retry">${T("Réessayer", "Try again")}</button></div>`;
        return;
    }
    if (state.missing) { view.innerHTML = missingView(); return; }
    if (!state.teamNo) { view.innerHTML = `<div class="empty" style="margin-top:16px">${T("Aucune équipe dans cette division.", "No teams in this division.")}</div>`; return; }
    if (!state.games.length) { view.innerHTML = teamHead() + emptySeasonView(); return; }

    const nSusp = (mySusp()?.mine || []).filter(isActiveSusp).length;
    const tab = (id, label) => `<button type="button" role="tab" data-view="${id}" aria-selected="${state.view === id}">${label}</button>`;
    const tabs = `<div class="seg view-tabs" role="tablist">
        ${tab("games", T("Horaire", "Schedule"))}${tab("standings", T("Classement", "Standings"))}${tab("stats", "Stats")}
        ${tab("susp", `Susp.${nSusp ? ` <span class="count alert">${nSusp}</span>` : ""}`)}
    </div>`;
    const body = state.view === "standings" ? standingsView()
        : state.view === "stats" ? statsView()
        : state.view === "susp" ? suspensionsView()
        : scheduleView();
    view.innerHTML = nextGameCard() + teamHead() + tabs + body;
}

const fmtStamp = new Intl.DateTimeFormat(LOC, { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
function renderControls() {
    const saved = SNAP?.fetchedAt ? new Date(SNAP.fetchedAt) : null;
    $("#notice").innerHTML = offline.used && !state.loading ? `<div class="stale">
        <span>${T("Site de la ligue injoignable : données enregistrées", "League site unreachable: data saved")}${saved && !isNaN(saved) ? ` ${T("le", "on")} <b>${esc(fmtStamp.format(saved))}</b>` : ""}.</span>
        <button type="button" class="btn ghost" data-action="retry">${T("Réessayer", "Try again")}</button>
    </div>` : "";
    const s = shownSeason();
    $("#subtitle").textContent = [state.teamNo && !state.missing ? myTeamName() : "", s ? seasonLabel(s.name) : ""].filter(Boolean).join(" · ") || T("Horaire et statistiques", "Schedule and stats");
    document.title = `${state.teamNo && !state.missing ? myTeamName() + " – " : ""}Dragons – ${T("Horaire et statistiques", "Schedule and stats")}`;
}

function renderAll() {
    renderControls();
    renderPicker();
    renderTeam();
}

// ---------- Slide-up sheet ----------
let sheetToken = 0;
function openSheet(title, html) {
    $("#sheetTitle").innerHTML = title;
    $("#sheetBody").innerHTML = html;
    $("#sheet").hidden = false; $("#sheetBack").hidden = false;
    document.body.classList.add("no-scroll");
    $("#sheetBody").scrollTop = 0;
}
function closeSheet() {
    sheetToken++;
    $("#sheet").hidden = true; $("#sheetBack").hidden = true;
    document.body.classList.remove("no-scroll");
}

// Opponent card: record, last five, head-to-head, common opponents, top scorers, all their results (selected season)
async function openOpponent(no) {
    const token = ++sheetToken;
    const s = shownSeasonNo();
    const name = state.standing?.find(r => r.no === no)?.name
        || state.games.map(g => [g.home, g.away]).flat().find(t => t.no === no)?.name || T("Adversaire", "Opponent");
    openSheet(esc(name), skeletons(3, true));
    const [team, cal, pl] = await Promise.all([soft(Q.team(s, no)), soft(Q.calendar(s, no)), soft(Q.players(s, no))]);
    if (token !== sheetToken) return;
    const games = parseGames(cal);
    const players = parsePlayers(pl) || [];
    const played = games.filter(isPlayed).sort((a, b) => b.start - a.start);
    const div = leagueText(state.classes.find(c => c.scNo === String(team?.st_sc_no || ""))?.name || "");
    const row = standRow(no);
    const colour = no === DRAGONS_NO ? DRAGONS_COLOUR : team ? teamColour(team.st_equip_color_1, team.st_equip_color_2) : "var(--border)";

    const rec = { win: 0, loss: 0, tie: 0, bp: 0, bc: 0 };
    played.forEach(g => {
        const r = resultOf(g, no); if (r) rec[r]++;
        if (g.score && isFinal(g)) { const home = g.home.no === no; rec.bp += home ? g.score.h : g.score.a; rec.bc += home ? g.score.a : g.score.h; }
    });
    const h2h = state.games.filter(g => isPlayed(g) && (g.home.no === no || g.away.no === no) && g.score).sort((a, b) => b.start - a.start);
    // Next time the team shown plays them (and the dates after that)
    const [nextVs, ...laterVs] = state.games.filter(g => !isPlayed(g) && (g.home.no === no || g.away.no === no)).sort((a, b) => a.start - b.start);
    const h2hRec = { win: 0, loss: 0, tie: 0 };
    h2h.forEach(g => { const r = resultOf(g, state.teamNo); if (r) h2hRec[r]++; });

    // Common opponents: teams both have played this season
    const mine = new Map(), theirs = new Map();
    state.games.filter(isPlayed).forEach(g => { const o = oppOf(g, state.teamNo); if (o.no && o.no !== no) (mine.get(o.no) || mine.set(o.no, []).get(o.no)).push(g); });
    played.forEach(g => { const o = oppOf(g, no); if (o.no && o.no !== state.teamNo) (theirs.get(o.no) || theirs.set(o.no, []).get(o.no)).push(g); });
    const common = [...mine.keys()].filter(k => theirs.has(k));
    const resText = (list, t) => list.filter(g => resultOf(g, t)).map(g => `<i class="${resultOf(g, t)}" title="${esc(scoreFor(g, t))}">${RESULT_LABEL[resultOf(g, t)][0]}</i>`).join("");

    const top = players.slice().sort((a, b) => b.pts - a.pts || b.b - a.b).slice(0, 5);
    const html = `
        <div class="opp-head" style="--dot:${esc(colour)}">
            ${teamMark(brand({ no, name, abbr: team?.st_equip_abbr, colour, logo: logoUrl(team?.st_equip_img) }), "xl")}
            <div>
                <div class="opp-sub">${esc([div, shownSeason()?.name ? seasonLabel(shownSeason().name) : ""].filter(Boolean).join(" · "))}</div>
                <div class="record big"><span class="w">${row && seasonStarted() ? row.v : rec.win} ${T("V", "W")}</span><span class="l">${row && seasonStarted() ? row.losses : rec.loss} ${T("D", "L")}</span><span class="t">${row && seasonStarted() ? row.n : rec.tie} ${T("N", "T")}</span></div>
                <div class="opp-sub">${row?.rank && seasonStarted() ? `${ordinal(row.rank)} ${T("de la division", "in the division")} · ${row.pts} pts · ` : ""}${rec.bp} ${T("BP", "GF")} · ${rec.bc} ${T("BC", "GA")}${row && seasonStarted() ? "" : T(" · compté à partir de leurs matchs", " · counted from their games")}</div>
            </div>
        </div>
        <h4>${T("Prochain match contre eux", "Next time we play them")}</h4>
        ${nextVs ? `<div class="next-vs">
            <div class="next-vs-top"><b>${esc(cap(fmtDayLong.format(nextVs.start)))}${nextVs.hasTime ? ` · ${esc(fmtTime.format(nextVs.start))}` : ""}</b><span class="badge ${isLive(nextVs) ? "live" : "duel"}">${esc(countdown(nextVs))}</span></div>
            <div class="next-vs-sub">${esc(myTeamName())} ${nextVs.home.no === state.teamNo ? T("reçoit", "hosts") : T("visite", "visits")} ${esc(name)} · ${esc(surfaceLabel(nextVs.surface))}${nextVs.no ? ` · #${esc(nextVs.no)}` : ""}</div>
            ${laterVs.length ? `<div class="next-vs-more">${T("Ensuite :", "After that:")} ${laterVs.map(g => esc(fmtDayShort.format(g.start))).join(", ")}</div>` : ""}
        </div>` : `<div class="hint">${T("Aucun autre match prévu contre eux cette saison.", "No other game against them this season.")}</div>`}
        ${formStrip(games, no) ? `<h4>${T("5 derniers matchs", "Last 5 games")}</h4><div class="form big">${formStrip(games, no).replace(/^<span[^>]*>|<\/span>$/g, "")}</div>` : ""}
        <h4>${T("Face à face", "Head to head")}${h2h.length ? ` · ${esc(myTeamName())} ${h2hRec.win}-${h2hRec.loss}-${h2hRec.tie}` : ""}</h4>
        ${h2h.length ? `<div class="mini-list">${h2h.map(g => miniGame(g, state.teamNo)).join("")}</div>` : `<div class="hint">${T("Aucun match joué entre les deux équipes cette saison.", "The two teams have not played each other this season.")}</div>`}
        ${common.length ? `<h4>${T("Adversaires communs", "Common opponents")}</h4><table class="standings mini"><thead><tr><th class="c-team">${T("Adversaire", "Opponent")}</th><th>${esc(myTeamName())}</th><th>${esc(name)}</th></tr></thead><tbody>
            ${common.map(k => `<tr><td class="c-team">${esc(oppOf(mine.get(k)[0], state.teamNo).name)}</td><td><span class="form">${resText(mine.get(k), state.teamNo)}</span></td><td><span class="form">${resText(theirs.get(k), no)}</span></td></tr>`).join("")}
        </tbody></table>` : ""}
        <h4>${T("Meilleurs pointeurs", "Top scorers")}</h4>
        ${top.length ? `<table class="standings mini"><thead><tr><th class="c-num">#</th><th class="c-team">${T("Joueur", "Player")}</th><th>${T("PJ", "GP")}</th><th>${T("B", "G")}</th><th>A</th><th class="c-pts">Pts</th></tr></thead><tbody>
            ${top.map(p => `<tr><td class="c-num">${p.num && p.num !== "0" ? `#${esc(p.num)}` : ""}</td><td class="c-team"><span class="cell-id">${avatar(p.img, p.name)}${playerLink(p)}</span></td><td>${p.pj}</td><td>${p.b}</td><td>${p.a}</td><td class="c-pts">${p.pts}</td></tr>`).join("")}
        </tbody></table>` : `<div class="hint">${T("Aucune statistique pour l'instant.", "No stats yet.")}</div>`}
        <h4>${T("Tous leurs résultats", "All their results")} (${played.length})</h4>
        ${played.length ? `<div class="mini-list">${played.map(g => miniGame(g, no)).join("")}</div>` : `<div class="hint">${T("Aucun match joué.", "No games played.")}</div>`}
        <div class="view-foot">${ext(`${SITE}/equipes/?seasonNo=${encodeURIComponent(s)}&teamNo=${encodeURIComponent(no)}`, T("Fiche sur le site de la ligue", "Team page on the league website"))}</div>`;
    openSheet(esc(team?.st_equip_name || name), html);
}

function miniGame(g, teamNo) {
    const r = resultOf(g, teamNo), opp = oppOf(g, teamNo), home = g.home.no === teamNo;
    return `<div class="mini-game">
        <span class="mini-date">${esc(fmtDayShort.format(g.start))}</span>
        ${teamMark(opp, "sm")}<span class="mini-opp">${home ? "vs" : "@"} ${esc(opp.name)}</span>
        ${r ? `<span class="badge ${r}">${RESULT_LABEL[r][0]} ${esc(scoreFor(g, teamNo))}${g.shootout ? T(" FU", " SO") : ""}</span>` : `<span class="badge">${g.score && isFinal(g) ? esc(scoreFor(g, teamNo)) : "—"}</span>`}
    </div>`;
}

// ---------- Sommaire du match (in-page summary, like the Roussillon and Chambly pages) ----------
// Feed answers: GameBoard (teams, logos, score), GameExtraInfo (shots, power plays, penalty minutes per team),
// GameSummaryGoals (goals by period + shootout), GameSummaryPenalties (penalties by period).
// Goal cell: [photo, scorer, assist 1, assist 2, clock, home abbr, away abbr, situation (AN…), home score, away score,
//             scorer's goals, assists 1, assists 2, "true" = home team goal, ids ×3, ?, ?, numbers ×3]
// Penalty cell: [player, ?, ?, clock, minutes, infraction, home abbr, away abbr, home min, away min, photo, "true" = home team, id, ?, number]
const clock = (t) => String(t || "").trim().replace(/^0:/, "").replace(/^0(\d:)/, "$1");
const secs = (t) => clock(t).split(":").reduce((a, x) => a * 60 + int(x), 0);
function periodName(text, i) {
    const n = norm(text);
    if (/PROL/.test(n)) return EN ? { short: "OT", long: "Overtime" } : { short: "Prol.", long: "Prolongation" };
    const d = n.match(/^(\d+)/)?.[1] || String(i + 1);
    if (EN) { const o = ordinal(int(d)); return { short: o, long: `${o} period` }; }
    return { short: d === "1" ? "1re" : `${d}e`, long: `${d === "1" ? "1re" : `${d}e`} période` };
}
const tablesOf = (x) => (Array.isArray(x) ? x : []).filter(t => t && typeof t === "object");

function parseSummary(board, stats, goalsAns, pensAns) {
    const b = board || {};
    const side = (k) => brand({
        no: b[`${k}TeamNo`] || "", name: (b[`${k}TeamNameFull`] || b[`${k}TeamName`] || "").trim(), abbr: b[`${k}TeamAbbr`] || "",
        logo: logoUrl(b[`${k}TeamImage`]), colour: teamColour(b[`${k}Color1`], b[`${k}Color2`]), fiche: b[`${k}Fiche`] || "",
        score: int(b[`${k}Score`]),
    });
    const s = { away: side("away"), home: side("local"), status: b.game_status || "", shootout: /fusil/i.test(b.game_end_ge_code || ""),
        start: b.gameDate ? new Date(`${b.gameDate}T${b.gameTime || "00:00:00"}`) : null, className: b.className || "", periods: [], goals: [], pens: [], so: [] };
    const g0 = Array.isArray(goalsAns) ? goalsAns[0] : goalsAns;
    const info = g0?.gameInfo || pensAns?.gameInfo || {};
    s.fj = { home: info.game_pts_fj_1, away: info.game_pts_fj_2 };
    const addPeriod = (text, i) => { const p = periodName(text, i); if (!s.periods.some(x => x.short === p.short)) s.periods.push(p); return p.short; };

    tablesOf(g0?.goals).forEach((t, i) => {
        const p = addPeriod(t.header?.[0]?.text, i);
        (tableRows(t) || []).forEach(c => {
            const v = c.GameGoalsInfo || [];
            const who = (k) => v[1 + k] ? { name: v[1 + k].trim(), id: v[14 + k] || "", num: v[19 + k] || "", n: v[10 + k] || "" } : null;
            s.goals.push({ p, t: clock(v[4]), home: v[13] === "true", sit: (v[7] || "").trim(), img: v[0] || "",
                scorer: who(0), assists: [who(1), who(2)].filter(Boolean), score: { h: int(v[8]), a: int(v[9]) } });
        });
    });
    const soT = Array.isArray(goalsAns) ? goalsAns[1] : null;
    (tableRows(soT) || []).forEach(c => {
        const pl = c.SOPlayer || [];
        const abbr = c.SOTeamAbbr?.[0] || "";
        s.so.push({ n: int(c.Rank?.[0]), home: norm(abbr) === norm(s.home.abbr) && norm(abbr) !== norm(s.away.abbr), abbr,
            scored: c.SOResult?.[0] === "1", name: (pl[0] || "").trim(), id: pl[1] || "", num: pl[3] || "" });
    });
    tablesOf(pensAns?.penalties).forEach((t, i) => {
        const p = addPeriod(t.header?.[0]?.text, i);
        (tableRows(t) || []).forEach(c => {
            const v = c.GamePenalityInfo || [];
            s.pens.push({ p, t: clock(v[3] || c.GamePenalityTime?.[0]), home: v[11] === "true", name: (v[0] || "").trim(), id: v[12] || "",
                num: v[14] || "", img: v[10] || "", min: num(v[4]), what: (v[5] || "").trim() });
        });
    });
    // Team rows of the stats table, matched by abbreviation (visitor first when the abbreviations do not help)
    const rows = tableRows(stats) || [];
    const pick = (t, i) => rows.find(r => norm(r.GameExtraTeamAbbr?.[0]) === norm(t.abbr)) || rows[i];
    [["away", 0], ["home", 1]].forEach(([k, i]) => {
        const r = pick(s[k], i);
        const pp = String(r?.GameExtraPP?.[0] || "").match(/(\d+)\s*EN\s*(\d+)/i);
        s[k].stats = r ? { shots: r.GameExtraShots?.[0] ?? "", pim: int(r.GameExtraPun?.[0]), ppg: pp ? int(pp[1]) : null, ppo: pp ? int(pp[2]) : null } : null;
    });
    if (!s.periods.length) ["1", "2", "3"].forEach((x, i) => addPeriod(x, i));
    // League rule: a tie goes to a shootout. Shooters are usually not entered and the shootout goal is not on the
    // scoresheet, only in the final score: listed goals tied, final score one apart = decided in a shootout.
    const listed = (home) => s.goals.filter(x => x.home === home).length;
    const done = s.status === "END" || (s.start && s.start.getTime() < LONG_AGO() && s.status !== "FORFAIT" && (s.away.score || s.home.score));
    if (done && s.status !== "FORFAIT" && listed(true) === listed(false) && Math.abs(s.home.score - s.away.score) === 1
        && listed(true) + listed(false) === s.home.score + s.away.score - 1) s.shootout = true;
    s.soWinner = s.shootout ? (s.home.score > s.away.score ? "home" : "away") : "";
    // Game-winning goal: the winner's goal that put them ahead for good (their goal n° loser's score + 1)
    const order = (x) => s.periods.findIndex(p => p.short === x.p) * 1e5 + secs(x.t);
    if (!s.shootout && s.home.score !== s.away.score) {
        const homeWon = s.home.score > s.away.score, loser = homeWon ? s.away.score : s.home.score;
        const theirs = s.goals.filter(x => x.home === homeWon).sort((a, b) => order(a) - order(b));
        if (theirs.length === (homeWon ? s.home.score : s.away.score)) s.gwg = theirs[loser] || null;
    }
    return s;
}

async function openSummary(gameNo) {
    const token = ++sheetToken;
    openSheet(T("Sommaire du match", "Game summary"), skeletons(3, true));
    const g = state.games.find(x => x.no === gameNo);
    const fresh = g ? isLive(g) : false;
    const [board, stats, goals, pens] = await Promise.all([soft(Q.board(gameNo, fresh)), soft(Q.gameStats(gameNo, fresh)), soft(Q.goals(gameNo, fresh)), soft(Q.penalties(gameNo, fresh))]);
    if (token !== sheetToken) return;
    if (!board || !board.gameNo) { openSheet(T("Sommaire du match", "Game summary"), `<div class="notice error" style="margin-top:16px">${T("Sommaire indisponible pour le moment.", "Summary not available right now.")}</div>`); return; }
    const s = parseSummary(board, stats, goals, pens);
    const A = s.away, H = s.home;
    const sideOf = (home) => home ? H : A;
    const persp = [A.no, H.no].includes(state.teamNo) ? state.teamNo : "";
    const res = g && persp ? resultOf(g, persp) : null;

    // Head: both teams, logos and final score
    const head = `<div class="sum-head">
        <div class="sum-team">${teamMark(A, "xl")}<b>${A.no && A.no !== state.teamNo ? teamLink(A) : esc(A.name)}</b><small>${T("Visiteur", "Visitor")}${A.fiche ? ` · ${esc(A.fiche)}` : ""}</small></div>
        <div class="sum-score"><span>${A.score}</span><i>–</i><span>${H.score}</span>
            <small>${s.status === "FORFAIT" ? T("Forfait", "Forfeit") : s.shootout ? T("Fusillade", "Shootout") : s.status === "END" ? "Final" : s.status ? T("En cours", "In progress") : ""}</small>
            ${res ? `<span class="badge ${res}">${RESULT_LABEL[res]}</span>` : ""}</div>
        <div class="sum-team">${teamMark(H, "xl")}<b>${H.no && H.no !== state.teamNo ? teamLink(H) : esc(H.name)}</b><small>${T("Local", "Home")}${H.fiche ? ` · ${esc(H.fiche)}` : ""}</small></div>
    </div>
    <div class="sum-meta">${esc([s.start ? cap(fmtDayLong.format(s.start)) : "", s.start ? fmtTime.format(s.start) : "", s.className].filter(Boolean).join(" · "))} · <a class="ext" target="_blank" rel="noopener" href="${esc(`${SITE}/sommaire/?gameNo=${encodeURIComponent(gameNo)}`)}" title="${T("Sommaire sur le site de la ligue", "Summary on the league website")}">#${esc(gameNo)} ↗</a></div>`;

    // Score by period (+ shootout)
    const pcols = s.periods.map(p => p.short);
    const soWin = s.soWinner, soTeam = soWin === "home" ? H : A;
    const line = (t, home) => `<tr${t.no === state.teamNo ? ` class="me"` : ""}><td class="c-team"><span class="cell-id">${teamMark(t, "sm")}<span class="nm">${esc(t.name)}</span></span></td>
        ${pcols.map(p => `<td>${s.goals.filter(x => x.p === p && x.home === home).length}</td>`).join("")}
        ${s.shootout ? `<td>${soWin === (home ? "home" : "away") ? 1 : 0}</td>` : ""}
        <td class="c-pts">${t.score}</td></tr>`;
    const board_ = `<div class="panel tight"><div class="table-scroll"><table class="standings scoreboard">
        <thead><tr><th class="c-team">${T("Équipe", "Team")}</th>${pcols.map(p => `<th>${esc(p)}</th>`).join("")}${s.shootout ? `<th title="${T("Fusillade", "Shootout")}">${T("TB", "SO")}</th>` : ""}<th class="c-pts">T</th></tr></thead>
        <tbody>${line(A, false)}${line(H, true)}</tbody></table></div></div>`;

    // Official statistics, visitor on the left and home team on the right (same four boxes as the Spordle pages)
    const pct = pctText;
    const val = (v) => v ?? "–";
    const pk = (t, o) => o.stats?.ppo != null && o.stats?.ppg != null ? { k: o.stats.ppo - o.stats.ppg, n: o.stats.ppo } : null;
    const pkA = pk(A, H), pkH = pk(H, A);
    const pname = (p) => p ? `${p.num && p.num !== "0" ? `#${esc(p.num)} ` : ""}${p.id ? `<button type="button" class="link-btn" data-player="${esc(p.id)}">${esc(p.name)}</button>` : esc(p.name)}` : "";
    // Game-winning goal: team logo, number and name of the scorer
    const gwgBox = () => {
        let body;
        if (s.shootout) body = `${teamMark(soTeam, "sm")}<span class="gwg-who"><b>${T("Fusillade", "Shootout")}</b><small>${T("Tireur non inscrit", "Shooter not entered")}</small></span>`;
        else if (s.gwg) {
            const t = sideOf(s.gwg.home), p = s.gwg.scorer;
            body = `${teamMark(t, "sm")}<span class="gwg-who"><b>${p ? pname(p) : esc(t.name)}</b><small>${esc(s.periods.find(x => x.short === s.gwg.p)?.long || s.gwg.p)} · ${esc(s.gwg.t)}</small></span>`;
        } else body = `<span class="gwg-who"><b>${A.score === H.score && (s.status === "END") ? T("Match nul", "Tie game") : "–"}</b></span>`;
        return `<div class="gs-box"><div class="gs-label">${T("But gagnant", "Game-winning goal")}</div><div class="gwg">${body}</div></div>`;
    };
    const nPen = (home) => s.pens.filter(x => x.home === home).length;
    const box = (label, a, h, aSub = "", hSub = "") => `<div class="gs-box">
        <div class="gs-label">${label}</div>
        <div class="gs-vals">
            <div class="gs-side">${teamMark(A, "sm")}<span><b>${a}</b>${aSub ? `<small>${aSub}</small>` : ""}</span></div>
            <div class="gs-side home"><span><b>${h}</b>${hSub ? `<small>${hSub}</small>` : ""}</span>${teamMark(H, "sm")}</div>
        </div>
    </div>`;
    const boxes = A.stats && H.stats ? `<h4>${T("Statistiques du match", "Game stats")}</h4><div class="gs-grid">
        ${box(T("Avantage num.", "Power play"), `${val(A.stats.ppg)}/${val(A.stats.ppo)}`, `${val(H.stats.ppg)}/${val(H.stats.ppo)}`, pct(A.stats.ppg, A.stats.ppo), pct(H.stats.ppg, H.stats.ppo))}
        ${box(T("Désavantage num.", "Penalty kill"), pkA ? `${pkA.k}/${pkA.n}` : "–", pkH ? `${pkH.k}/${pkH.n}` : "–", pkA ? pct(pkA.k, pkA.n) : "", pkH ? pct(pkH.k, pkH.n) : "")}
        ${box(T("Minutes de punition", "Penalty minutes"), A.stats.pim, H.stats.pim, `${nPen(false)} ${T("pun.", "pen.")}`, `${nPen(true)} ${T("pun.", "pen.")}`)}
        ${gwgBox()}
    </div>` : "";

    // Goals and penalties by period, in game-clock order, with the player's photo
    const byPeriod = (list, render) => {
        if (!list.length) return `<div class="empty">${T("Aucun.", "None.")}</div>`;
        return s.periods.filter(p => list.some(x => x.p === p.short)).map(p =>
            `<p class="sum-period">${esc(p.long)}</p><div class="sum-list">${list.filter(x => x.p === p.short).sort((a, b) => secs(a.t) - secs(b.t)).map(render).join("")}</div>`).join("");
    };
    const goalItem = (x) => {
        const t = sideOf(x.home);
        return `<div class="sum-item${t.no === state.teamNo ? " mine" : ""}">
            <span class="d">${esc(x.t)}</span>${teamMark(t, "sm")}${avatar(x.img, x.scorer?.name)}
            <span class="o"><span class="who">${x.scorer ? pname(x.scorer) : `${T("But", "Goal")} — ${esc(t.name)}`}${x.scorer?.n ? ` <span class="sum-as">(${esc(x.scorer.n)})</span>` : ""}${x.sit ? ` <span class="flag">${esc(x.sit)}</span>` : ""}</span>
                <span class="sum-as">${x.assists.length ? `${T("Passes :", "Assists:")} ${x.assists.map(pname).join(", ")}` : T("Sans passe", "Unassisted")}</span></span>
            <span class="sum-run">${x.score.a}-${x.score.h}</span>
        </div>`;
    };
    const penItem = (x) => {
        const t = sideOf(x.home);
        return `<div class="sum-item${t.no === state.teamNo ? " mine" : ""}">
            <span class="d">${esc(x.t)}</span>${teamMark(t, "sm")}${avatar(x.img, x.name || t.name)}
            <span class="o"><span class="who">${x.name ? pname(x) : T("Punition de banc", "Bench penalty")}</span><span class="sum-as">${esc(penaltyText(x.what) || T("Punition", "Penalty"))}</span></span>
            <span class="sum-run">${x.min != null ? `${EN ? x.min : String(x.min).replace(".", ",")} min` : ""}</span>
        </div>`;
    };
    const so = s.shootout && !s.so.length ? `<h4>${T("Fusillade", "Shootout")}</h4><div class="sum-list"><div class="sum-item${soTeam.no === state.teamNo ? " mine" : ""}"><span class="d">${T("TB", "SO")}</span>${teamMark(soTeam, "sm")}
            <span class="o"><span class="who">${esc(soTeam.name)} ${T("gagne en fusillade", "wins in a shootout")}</span><span class="sum-as">${T("Tireurs non inscrits à la feuille de match", "Shooters not entered on the game sheet")}</span></span>
            <span class="sum-run">${A.score}-${H.score}</span></div></div>`
        : s.so.length ? `<h4>${T("Fusillade", "Shootout")}</h4><div class="sum-list">${s.so.sort((a, b) => a.n - b.n).map(x => {
        const t = norm(x.abbr) === norm(H.abbr) ? H : A;
        return `<div class="sum-item${t.no === state.teamNo ? " mine" : ""}"><span class="d">${x.n}</span>${teamMark(t, "sm")}<span class="o"><span class="who">${pname(x)}</span></span>
            <span class="sum-run ${x.scored ? "yes" : "no"}">${x.scored ? T("✓ But", "✓ Goal") : T("✗ Raté", "✗ Miss")}</span></div>`;
    }).join("")}</div>` : "";

    const html = head
        + (s.status === "FORFAIT" ? `<div class="notice" style="margin-top:12px">${T("Match gagné par forfait.", "Game won by forfeit.")}</div>` : "")
        + `<h4>${T("Pointage", "Score")}</h4>${board_}${boxes}
        <h4><span>${T("Buts", "Goals")}</span> <span class="count-tag">${s.goals.length}</span></h4>${byPeriod(s.goals, goalItem)}
        ${so}
        <h4><span>${T("Punitions", "Penalties")}</span> <span class="count-tag">${s.pens.length}</span></h4>${byPeriod(s.pens, penItem)}
        <div class="view-foot"><span>${T("Pointage courant à droite (visiteur-local) · (n) = buts de la saison · AN = avantage numérique", "Running score on the right (visitor-home) · (n) = season goals · AN = power play, DN = shorthanded")}</span></div>`;
    openSheet(T("Sommaire du match", "Game summary"), html);
}

// Player history: stats season by season, across every team the player has played for
async function openPlayer(id) {
    const token = ++sheetToken;
    openSheet(T("Joueur", "Player"), skeletons(3, true));
    const info = await soft(Q.playerInfo(id));
    if (token !== sheetToken) return;
    if (!info || info.error) { openSheet(T("Joueur", "Player"), `<div class="notice error">${T("Fiche du joueur indisponible.", "Player page not available.")}</div>`); return; }
    const goalie = !!info.isGoalie || !!info.isGoalieAndForward, skater = !!info.isForward || !!info.isGoalieAndForward || !goalie;
    const [cs, cg] = await Promise.all([skater ? soft(Q.career(id, false)) : null, goalie ? soft(Q.career(id, true)) : null]);
    if (token !== sheetToken) return;
    const sk = parseCareer(cs, false), gk = parseCareer(cg, true);

    const seasonCell = (r) => `<td class="c-team"><div class="cs-season">${esc(seasonLabel(r.season, true))}${r.series ? ` <span class="tag">${T("Séries", "Playoffs")}</span>` : ""}</div>
        <div class="cs-team">${r.teamNo ? `<button type="button" class="link-btn" data-goto-team="${esc(r.teamNo)}" data-goto-season="${esc(r.seasonNo)}">${esc(r.team)}</button>` : esc(r.team)}${r.div ? ` · ${esc(leagueText(r.div))}` : ""}</div></td>`;
    const sum = (list, k) => list.reduce((t, r) => t + (r[k] || 0), 0);

    let html = `<div class="opp-head">
        ${avatar(info.sp_play_img, info.sp_player_name, "xl")}
        <div>
            <div class="opp-sub">${esc(info.pos_abbr === "ATT" ? T("Attaquant", "Forward") : info.pos_abbr === "DEF" ? T("Défenseur", "Defence") : goalie && !skater ? T("Gardien", "Goalie") : "")}</div>
            <div class="opp-sub">${T("Équipe actuelle :", "Current team:")} <b>${esc(info.st_equip_name || "—")}</b></div>
        </div>
    </div>`;
    if (sk.length) {
        const reg = sk.filter(r => !r.series), ser = sk.filter(r => r.series);
        const nSeasons = new Set(reg.map(r => r.seasonNo)).size, nTeams = new Set(sk.map(r => norm(r.team))).size;
        html += `<h4>${T("Joueur", "Player")} · ${plural(nSeasons, "saison", "season")} · ${plural(nTeams, "équipe", "team")}</h4>
        <div class="table-scroll"><table class="standings mini career"><thead><tr><th class="c-team">${T("Saison · équipe", "Season · team")}</th><th>${T("PJ", "GP")}</th><th>${T("B", "G")}</th><th>A</th><th class="c-pts">Pts</th><th>${T("Pun", "PIM")}</th></tr></thead><tbody>
            ${sk.map(r => `<tr class="${r.teamNo === state.teamNo ? "me" : ""}">${seasonCell(r)}<td>${r.pj}</td><td>${r.b}</td><td>${r.a}</td><td class="c-pts">${r.pts}</td><td>${r.pun}</td></tr>`).join("")}
        </tbody><tfoot>
            <tr><td class="c-team">${T("Total saisons", "Seasons total")}</td><td>${sum(reg, "pj")}</td><td>${sum(reg, "b")}</td><td>${sum(reg, "a")}</td><td class="c-pts">${sum(reg, "pts")}</td><td>${sum(reg, "pun")}</td></tr>
            ${ser.length ? `<tr><td class="c-team">${T("Total séries", "Playoffs total")}</td><td>${sum(ser, "pj")}</td><td>${sum(ser, "b")}</td><td>${sum(ser, "a")}</td><td class="c-pts">${sum(ser, "pts")}</td><td>${sum(ser, "pun")}</td></tr>` : ""}
        </tfoot></table></div>`;
    }
    if (gk.length) {
        html += `<h4>${T("Gardien", "Goalie")}</h4>
        <div class="table-scroll"><table class="standings mini career"><thead><tr><th class="c-team">${T("Saison · équipe", "Season · team")}</th><th>${T("PJ", "GP")}</th><th>${T("V", "W")}</th><th>${T("D", "L")}</th><th>${T("N", "T")}</th><th>${T("BC", "GA")}</th><th>${T("Moy", "GAA")}</th></tr></thead><tbody>
            ${gk.map(r => `<tr class="${r.teamNo === state.teamNo ? "me" : ""}">${seasonCell(r)}<td>${r.pj}</td><td>${r.v}</td><td>${r.d}</td><td>${r.n}</td><td>${r.bc}</td><td>${dec(r.moy)}</td></tr>`).join("")}
        </tbody></table></div>`;
    }
    if (!sk.length && !gk.length) html += `<div class="hint">${T("Aucune statistique enregistrée.", "No stats recorded.")}</div>`;
    html += `<div class="view-foot"><span>${T("Pun = minutes de punition", "PIM = penalty minutes")}</span>${ext(`${SITE}/liste-des-joueurs/`, LEAGUE_SITE())}</div>`;
    openSheet(esc(info.sp_player_name || T("Joueur", "Player")), html);
}

// ---------- Calendar export (.ics) ----------
function icsDate(d) { return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
function icsText(s) { return String(s).replace(/[\\;,]/g, m => "\\" + m).replace(/\n/g, "\\n"); }
function downloadICS() {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//Dragons//Horaire//${LANG.toUpperCase()}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        `X-WR-CALNAME:${icsText(`${myTeamName()} – LHAI St-Constant`)}`];
    const stamp = icsDate(new Date());
    state.games.slice().sort((a, b) => a.start - b.start).forEach(g => {
        const home = g.home.no === state.teamNo, opp = home ? g.away : g.home;
        const end = new Date(g.start.getTime() + GAME_MINUTES * 60000);
        const score = g.score && isFinal(g) ? ` (${scoreFor(g, state.teamNo)})` : "";
        lines.push("BEGIN:VEVENT", `UID:lhai-${g.no || g.start.getTime()}-${state.teamNo}@dragons`, `DTSTAMP:${stamp}`,
            `DTSTART:${icsDate(g.start)}`, `DTEND:${icsDate(end)}`,
            `SUMMARY:${icsText(`${home ? "vs" : "@"} ${opp.name}${score}`)}`,
            `LOCATION:${icsText(surfaceLabel(g.surface))}`,
            `DESCRIPTION:${icsText(`${T("Partie", "Game")} #${g.no} · ${home ? T("Local", "Home") : T("Visiteur", "Away")}`)}`,
            "END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    saveFile(new Blob([lines.join("\r\n")], { type: "text/calendar" }), `${T("horaire", "schedule")}-${slug(myTeamName())}-${slug(seasonLabel(shownSeason()?.name || ""))}.ics`);
    const hint = $("#icsHint");
    if (hint) { hint.textContent = T("⬅ Téléchargé!", "⬅ Downloaded!"); hint.classList.add("done"); setTimeout(() => { if (hint.isConnected) { hint.textContent = T("⬅ Ajouter à mon calendrier", "⬅ Add to my calendar"); hint.classList.remove("done"); } }, 5000); }
}
const slug = (s) => norm(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function saveFile(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------- Excel file (written in the page, no library) ----------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipStore(files) {          // files: [{ name, data: string }] → stored (uncompressed) zip
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    files.forEach(f => {
        const name = enc.encode(f.name), data = typeof f.data === "string" ? enc.encode(f.data) : f.data, crc = crc32(data);
        const head = new DataView(new ArrayBuffer(30));
        head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true);
        head.setUint32(14, crc, true); head.setUint32(18, data.length, true); head.setUint32(22, data.length, true); head.setUint16(26, name.length, true);
        parts.push(head, name, data);
        const cd = new DataView(new ArrayBuffer(46));
        cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
        cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, name.length, true);
        cd.setUint32(42, offset, true);
        central.push(cd, name);
        offset += 30 + name.length + data.length;
    });
    const size = central.reduce((t, p) => t + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
const xml = (s) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// Each sheet: the Dragons logo in the top-left corner (rows 1-4), then its table; every cell centred.
const LOGO_ROWS = 5;                 // rows left free above the table (logo is 80 px ≈ 4 rows)
const colName = (i) => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
function sheetXML({ rows, head, note }, withLogo) {
    const cell = (ref, v, style) => typeof v === "number" && Number.isFinite(v) ? `<c r="${ref}" s="${style}"><v>${v}</v></c>`
        : `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    const out = withLogo ? [1, 2, 3, 4].map(r => `<row r="${r}" ht="16" customHeight="1"/>`) : [];   // 4 × 16 pt ≈ 85 px for the logo
    if (note) out.push(`<row r="${LOGO_ROWS}">${cell(`A${LOGO_ROWS}`, note, 3)}</row>`);
    const first = LOGO_ROWS + (note ? 2 : 1);
    rows.forEach((r, ri) => out.push(`<row r="${first + ri}">${r.map((v, ci) => cell(`${colName(ci)}${first + ri}`, v, ri === head ? 1 : 2)).join("")}</row>`));
    const nCols = Math.max(...rows.map(r => r.length));
    const widths = Array.from({ length: nCols }, (_, ci) => Math.min(42, Math.max(6, ...rows.map(r => String(r[ci] ?? "").length + 3))));
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
        + `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
        + `<sheetData>${out.join("")}</sheetData>${withLogo ? `<drawing r:id="rId1"/>` : ""}</worksheet>`;
}
const LOGO_PX = 76, EMU = 9525;
const drawingXML = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${LOGO_PX * EMU}" cy="${LOGO_PX * EMU}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo Dragons"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${LOGO_PX * EMU}" cy="${LOGO_PX * EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`;
const REL = (id, type, target) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
const RELS = (inner) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${inner}</Relationships>`;
function buildXLSX(sheets, logo) {         // sheets: [{ name, rows, head, note }], logo: Uint8Array (JPEG) or null
    const files = [
        { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>${logo ? `<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` : ""}`).join("")}</Types>` },
        { name: "_rels/.rels", data: RELS(REL("rId1", "officeDocument", "xl/workbook.xml")) },
        { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
        { name: "xl/_rels/workbook.xml.rels", data: RELS(sheets.map((s, i) => REL(`rId${i + 1}`, "worksheet", `worksheets/sheet${i + 1}.xml`)).join("") + REL(`rId${sheets.length + 1}`, "styles", "styles.xml")) },
        // Styles: 0 default, 1 header (bold, centred), 2 centred, 3 timestamp (italic grey, left)
        { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF687082"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="4"><xf/><xf fontId="1" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf fontId="2" applyFont="1"/></cellXfs></styleSheet>` },
        ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXML(s, !!logo) })),
    ];
    if (logo) {
        files.push({ name: "xl/media/image1.jpeg", data: logo });
        sheets.forEach((s, i) => files.push(
            { name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, data: RELS(REL("rId1", "drawing", `../drawings/drawing${i + 1}.xml`)) },
            { name: `xl/drawings/drawing${i + 1}.xml`, data: drawingXML() },
            { name: `xl/drawings/_rels/drawing${i + 1}.xml.rels`, data: RELS(REL("rId1", "image", "../media/image1.jpeg")) }));
    }
    return zipStore(files);
}
// Local calendar date (toISOString gives the UTC date, a day late for evening games)
const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
async function downloadXLSX() {
    const row = standRow(state.teamNo), me = state.teamNo;
    const ts = seasonTeamStats();
    const equipe = [EN ? ["Team", "Division", "Season", "Rank", "GP", "W", "L", "OTL", "T", "Pts", "GF", "GA", "Diff", "PPG", "PP opportunities", "PK kills", "Times shorthanded", "PIM"]
            : ["Équipe", "Division", "Saison", "Rang", "PJ", "V", "D", "DP", "N", "Pts", "BP", "BC", "Diff", "BAN", "Occasions AN", "DN réussis", "Occasions DN", "Pun (min)"],
        [myTeamName(), leagueText(currentClass()?.name || ""), seasonLabel(shownSeason()?.name || ""), row?.rank || "", row?.pj ?? "", row?.v ?? "", row ? row.dr + row.df : "", row?.dp ?? "", row?.n ?? "", row?.pts ?? "", row?.bp ?? "", row?.bc ?? "", row?.diff ?? "",
            ts?.ppg ?? "", ts?.ppo ?? "", ts?.pk ?? "", ts?.pko ?? "", ts?.pim ?? ""]];
    const matchs = [EN ? ["Date", "Time", "Game", "Home/Away", "Opponent", "For", "Against", "Result", "Note", "Surface"]
            : ["Date", "Heure", "Partie", "Dom./Vis.", "Adversaire", "Pour", "Contre", "Résultat", "Note", "Surface"],
        ...state.games.slice().sort((a, b) => a.start - b.start).map(g => {
            const home = g.home.no === me, r = resultOf(g, me), fin = g.score && isFinal(g);
            return [localDate(g.start), g.hasTime ? fmtTime.format(g.start) : "", g.no, home ? T("Dom.", "Home") : T("Vis.", "Away"), oppOf(g, me).name,
                fin ? (home ? g.score.h : g.score.a) : "", fin ? (home ? g.score.a : g.score.h) : "", r ? RESULT_LABEL[r] : "",
                [g.status === "FORFAIT" ? T("Forfait", "Forfeit") : "", g.shootout && fin ? T("Fusillade", "Shootout") : "", isPlayed(g) && !g.status ? T("Résultat non saisi", "Result not entered") : ""].filter(Boolean).join(", "), surfaceLabel(g.surface)];
        })];
    const joueurs = [EN ? ["#", "Player", "GP", "G", "A", "Pts", "PIM", "PPG", "SHG", "GWG"] : ["#", "Joueur", "PJ", "B", "A", "Pts", "Pun", "BAN", "BDN", "BG"],
        ...(state.players || []).map(p => [p.num && p.num !== "0" ? int(p.num) : "", p.name, p.pj, p.b, p.a, p.pts, p.pun, p.ban, p.bdn, p.bg])];
    const gardiens = [EN ? ["Goalie", "GP", "W", "L", "T", "GA", "GAA", "SO"] : ["Gardien", "PJ", "V", "D", "N", "BC", "Moy", "BL"],
        ...(state.goalies || []).map(g => [g.name, g.pj, g.v, g.d, g.n, g.bc, g.moy ?? "", g.bl])];
    let logo = null;
    try { const r = await fetch(DRAGONS_LOGO); if (r.ok) logo = new Uint8Array(await r.arrayBuffer()); } catch { /* file without the logo */ }
    const stamp = `${T("Fichier généré le", "File generated on")} ${new Intl.DateTimeFormat(LOC, { dateStyle: "long", timeStyle: "short" }).format(new Date())}`;
    saveFile(buildXLSX([{ name: T("Équipe", "Team"), rows: equipe, head: 0, note: stamp }, { name: T("Matchs", "Games"), rows: matchs, head: 0 }, { name: T("Joueurs", "Players"), rows: joueurs, head: 0 }, { name: T("Gardiens", "Goalies"), rows: gardiens, head: 0 }], logo),
        `${T("saison", "season")}-${slug(myTeamName())}-${slug(seasonLabel(shownSeason()?.name || ""))}.xlsx`);
}

// ---------- Lineups (5 contre 5: 3 attaquants + 2 défenseurs, plus le gardien) ----------
const FWD_LINES = 2, DEF_PAIRS = 2;
const FWD_POS = ["AG", "C", "AD"], DEF_POS = ["DG", "DD"];
const LINEUP_SLOTS = [
    ...Array.from({ length: FWD_LINES }, (_, i) => FWD_POS.map(p => [`L${i + 1}`, p])).flat(),
    ...Array.from({ length: DEF_PAIRS }, (_, i) => DEF_POS.map(p => [`D${i + 1}`, p])).flat(),
    ["G", "Partant"], ["G", "Auxiliaire"],
];
const SLOT_KEYS = LINEUP_SLOTS.map(([l, p]) => `${l}-${p}`);
const lineupKey = (gameNo, teamNo) => `lineup_${gameNo}:${teamNo}`;
function readLineup(gameNo, teamNo) {
    const v = LS.get(lineupKey(gameNo, teamNo));
    return v && typeof v === "object" ? v : null;
}
function storeLineup(gameNo, teamNo, lu) {
    lu.ts = Date.now();
    const empty = !Object.values(lu.slots || {}).some(Boolean) && !(lu.res || []).length && !(lu.abs || []).length;
    if (empty) LS.del(lineupKey(gameNo, teamNo)); else LS.set(lineupKey(gameNo, teamNo), lu);
    const idx = LS.get(`lineups_${teamNo}`, []).filter(x => x.g !== gameNo);
    if (!empty) idx.push({ g: gameNo, ts: lu.ts });
    LS.set(`lineups_${teamNo}`, idx.slice(-80));
}

const lu = { open: false, gameNo: null, game: null, roster: [], data: null, editing: false, pick: null, bench: false };

async function openLineup(gameNo) {
    const g = state.games.find(x => x.no === gameNo);
    if (!g) return;
    const saved = readLineup(gameNo, state.teamNo);
    Object.assign(lu, { open: true, gameNo, game: g, roster: [], data: saved || { slots: {}, res: [], abs: [] }, pick: null, bench: false,
        editing: !isPlayed(g) || !saved });
    $("#lineup").hidden = false;
    document.body.classList.add("no-scroll");
    renderLineup(true);
    let roster = parseRoster(await soft(Q.roster(shownSeasonNo(), state.teamNo))) || [];
    if (!roster.length && state.playoffs && regularSeason()) roster = parseRoster(await soft(Q.roster(regularSeason().no, state.teamNo))) || [];
    if (!lu.open || lu.gameNo !== gameNo) return;
    lu.roster = roster.sort((a, b) => int(a.num) - int(b.num) || a.name.localeCompare(b.name, "fr"));
    renderLineup();
}
function closeLineup() {
    Object.assign(lu, { open: false, pick: null, bench: false });
    $("#lineup").hidden = true;
    document.body.classList.remove("no-scroll");
    renderTeam();
}

const playerById = (id) => lu.roster.find(p => p.id === id) || { id, num: "", name: T("Hors liste", "Not on roster"), pos: "" };
// Box labels: the stored keys stay French (AG, C, AD, DG, DD, Partant, Auxiliaire); only what is shown changes
const POS_LABEL = EN ? { AG: "LW", C: "C", AD: "RW", DG: "LD", DD: "RD", Partant: "Starter", Auxiliaire: "Backup", L: "L", D: "D" } : {};
const posLabel = (p) => POS_LABEL[p] || p;
const tagLabel = (p) => EN ? ({ ATT: "F", DEF: "D", G: "G" }[p] || p) : p;
const placedIds = () => new Set([...Object.values(lu.data.slots).filter(Boolean), ...lu.data.res]);
const tagFor = (p) => p.pos ? `<span class="lu-tag lu-tag-${p.pos.toLowerCase()}">${tagLabel(p.pos)}</span>` : "";
const pLabel = (p) => `${p.num && p.num !== "0" ? `<b>#${esc(p.num)}</b> ` : ""}${esc(p.name)}`;

function renderLineup(loading = false) {
    const el = $("#lineup"), g = lu.game;
    if (!lu.open) return;
    if (lu.bench) { el.innerHTML = benchHTML(); return; }
    const opp = oppOf(g, state.teamNo);
    const head = `<div class="lu-head">
        <button type="button" class="icon-btn" data-lu="close" aria-label="${T("Fermer", "Close")}">✕</button>
        <div><div class="lu-title">${isPlayed(g) && !lu.editing ? T("Alignement utilisé", "Lineup used") : T("Alignement", "Lineup")}</div>
        <div class="lu-sub">${esc(fmtDayShort.format(g.start))}${g.hasTime ? ` · ${esc(fmtTime.format(g.start))}` : ""} · ${g.home.no === state.teamNo ? "vs" : "@"} ${esc(opp.name)}</div></div>
        <button type="button" class="btn" data-lu="bench">${T("Vue banc", "Bench view")}</button>
    </div>`;
    if (loading) { el.innerHTML = head + `<div class="lu-body">${skeletons(3, true)}</div>`; return; }

    const ro = !lu.editing;
    const box = (key, label) => {
        const id = lu.data.slots[key], p = id ? playerById(id) : null;
        return `<button type="button" class="lu-box${p ? " full" : ""}${lu.pick === key ? " picking" : ""}" data-slot="${key}"${ro ? " disabled" : ""}>
            <span class="lu-pos">${label}</span><span class="lu-name">${p ? pLabel(p) : "—"}</span></button>`;
    };
    const lines = (prefix, n, pos, cls) => Array.from({ length: n }, (_, i) => `<div class="lu-line ${cls} c${pos.length}"><span class="lu-lab">${prefix}${i + 1}</span>
        ${pos.map(p => box(`${prefix}${i + 1}-${p}`, posLabel(p))).join("")}</div>`).join("");
    const chips = (list, kind) => list.length ? list.map(id => `<span class="lu-chip">${pLabel(playerById(id))}</span>`).join("") : `<span class="hint">${T("Personne", "Nobody")}</span>`;
    const prev = LS.get(`lineups_${state.teamNo}`, []).filter(x => x.g !== lu.gameNo).sort((a, b) => b.ts - a.ts)[0];

    el.innerHTML = head + `<div class="lu-body">
        ${!lu.roster.length ? `<div class="notice">${T("L'alignement de l'équipe n'est pas disponible sur le site de la ligue.", "The team roster is not available on the league website.")}</div>` : ""}
        <h4>${T("Lignes d'attaque", "Forward lines")}</h4>${lines("L", FWD_LINES, FWD_POS, "fwd")}
        <h4>${T("Paires défensives", "Defence pairs")}</h4>${lines("D", DEF_PAIRS, DEF_POS, "def")}
        <h4>${T("Gardiens", "Goalies")}</h4><div class="lu-line gk">${box("G-Partant", posLabel("Partant"))}${box("G-Auxiliaire", posLabel("Auxiliaire"))}</div>
        <h4>${T("Réserves", "Spares")}</h4><button type="button" class="lu-group" data-slot="res"${ro ? " disabled" : ""}>${chips(lu.data.res)}</button>
        <h4>${T("Absents", "Absent")}</h4><button type="button" class="lu-group abs" data-slot="abs"${ro ? " disabled" : ""}>${chips(lu.data.abs)}</button>
        <div class="lu-actions">
            ${ro ? `<button type="button" class="btn" data-lu="edit">${T("Modifier", "Edit")}</button>`
                : `${prev ? `<button type="button" class="btn ghost" data-lu="copy">${T("Copier le dernier match", "Copy last game")}</button>` : ""}
                   <button type="button" class="btn ghost" data-lu="clear">${T("Tout effacer", "Clear all")}</button>`}
        </div>
        <p class="hint">${T("Enregistré sur ce téléphone seulement. Une ligne ou une paire vide n'apparaît pas dans la vue banc.", "Saved on this phone only. An empty line or pair is left out of the bench view.")}</p>
    </div>${lu.pick ? pickerHTML() : ""}`;
}

// Picker: the player already in the box first, then players still to place (by number), then placed ones, absents last
function pickerHTML() {
    const key = lu.pick, multi = key === "res" || key === "abs";
    const current = multi ? lu.data[key] : [lu.data.slots[key]].filter(Boolean);
    const placed = placedIds(), abs = new Set(lu.data.abs);
    const rank = (p) => current.includes(p.id) ? 0 : abs.has(p.id) ? 3 : placed.has(p.id) ? 2 : 1;
    const list = lu.roster.slice().sort((a, b) => rank(a) - rank(b) || int(a.num) - int(b.num));
    const title = multi ? (key === "res" ? T("Réserves", "Spares") : T("Absents", "Absent")) : key.split("-").map(posLabel).join(" · ");
    return `<div class="lu-pick-back" data-lu="pick-close"></div>
    <div class="lu-pick" role="dialog" aria-label="${T("Choisir un joueur", "Choose a player")}">
        <div class="lu-pick-head"><b>${esc(title)}</b><button type="button" class="btn" data-lu="pick-close">${multi ? "OK" : T("Fermer", "Close")}</button></div>
        ${!multi && current.length ? `<button type="button" class="lu-opt remove" data-pid="">${T("Vider la case", "Empty this box")}</button>` : ""}
        ${list.map(p => {
            const r = rank(p);
            return `<button type="button" class="lu-opt${r === 0 ? " current" : r >= 2 ? " placed" : ""}" data-pid="${esc(p.id)}">
                <span>${pLabel(p)}</span>${tagFor(p)}${r === 0 ? `<span class="lu-mark">✓</span>` : r === 3 ? `<span class="lu-mark">${T("absent", "absent")}</span>` : r === 2 ? `<span class="lu-mark">${T("placé", "placed")}</span>` : ""}</button>`;
        }).join("")}
    </div>`;
}

function pickPlayer(pid) {
    const key = lu.pick, d = lu.data;
    const removeEverywhere = (id) => {
        SLOT_KEYS.forEach(k => { if (d.slots[k] === id) d.slots[k] = null; });
        d.res = d.res.filter(x => x !== id); d.abs = d.abs.filter(x => x !== id);
    };
    if (key === "res" || key === "abs") {
        if (d[key].includes(pid)) d[key] = d[key].filter(x => x !== pid);
        else { removeEverywhere(pid); d[key].push(pid); }
    } else {
        if (pid) removeEverywhere(pid);
        d.slots[key] = pid || null;
        lu.pick = null;
    }
    storeLineup(lu.gameNo, state.teamNo, d);
}

// Vue banc: same boxes as the Roussillon / Chambly pages, white on black whatever the theme.
// 5 contre 5: three boxes per forward line, two per defence pair; empty lines and pairs are left out.
function benchHTML() {
    const d = lu.data, g = lu.game;
    const opp = oppOf(g, state.teamNo), home = g.home.no === state.teamNo;
    const cell = (id) => {
        const p = id ? playerById(id) : null;
        return `<div class="bv-cell${p ? "" : " empty"}"><span class="bv-no">${p ? esc(p.num && p.num !== "0" ? p.num : "?") : "–"}</span><span class="bv-name">${p ? esc(p.name) : ""}</span></div>`;
    };
    const group = (title, kind, rows, cols) => {
        const used = rows.filter(r => r.keys.some(k => d.slots[k]));
        if (!used.length) return "";
        const lined = rows.length > 1;
        return `<section class="bv-group bv-${kind}"><h3>${title}</h3>
            <div class="bv-row bv-cols c${cols.length}${lined ? "" : " solo"}">${lined ? "<span></span>" : ""}${cols.map(c => `<span>${c}</span>`).join("")}</div>
            ${used.map(r => `<div class="bv-row c${cols.length}${lined ? "" : " solo"}">${lined ? `<span class="bv-line">${esc(r.label)}</span>` : ""}${r.keys.map(k => cell(d.slots[k])).join("")}</div>`).join("")}
        </section>`;
    };
    const rowsOf = (prefix, n, pos) => Array.from({ length: n }, (_, i) => ({ label: `${prefix}${i + 1}`, keys: pos.map(p => `${prefix}${i + 1}-${p}`) }));
    const fwd = group(T("Attaque", "Forwards"), "a", rowsOf("L", FWD_LINES, FWD_POS), EN ? ["Left wing", "Centre", "Right wing"] : ["Ailier gauche", "Centre", "Ailier droit"]);
    const def = group(T("Défense", "Defence"), "d", rowsOf("D", DEF_PAIRS, DEF_POS), EN ? ["Left D", "Right D"] : ["Défenseur gauche", "Défenseur droit"]);
    const gk = group(T("Gardiens", "Goalies"), "g", [{ label: "G", keys: ["G-Partant", "G-Auxiliaire"] }], [posLabel("Partant"), posLabel("Auxiliaire")]);
    const res = d.res.length ? `<section class="bv-group"><h3>${T("Réserves", "Spares")}</h3><div class="bv-row extras">${d.res.map(cell).join("")}</div></section>` : "";
    const when = `${cap(fmtDayLong.format(g.start))}${g.hasTime ? ` · ${fmtTime.format(g.start)}` : ""}`;
    return `<div class="bench-view">
        <header class="bv-head">
            <div><strong>${esc(myTeamName())}</strong><span>${home ? "vs" : "@"} ${esc(opp.name)} · ${esc(when)}</span></div>
            <button type="button" class="bv-close" data-lu="bench-off" aria-label="${T("Fermer la vue banc", "Close bench view")}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </button>
        </header>
        <div class="bv-body">
            <div class="bv-groups">${fwd + def + gk + res || `<div class="bv-empty">${T("Aucun joueur placé.", "No players placed.")}</div>`}</div>
            <aside class="bv-info" aria-hidden="true">
                <div class="bv-info-team">${esc(myTeamName())}</div>
                <div class="bv-info-vs">${home ? T("reçoit", "hosts") : T("visite", "visits")}</div>
                <div class="bv-info-team opp">${esc(opp.name)}</div>
                <div class="bv-info-when">${esc(cap(fmtDayLong.format(g.start)))}</div>
                ${g.hasTime ? `<div class="bv-info-time">${esc(fmtTime.format(g.start))}</div>` : ""}
                <div class="bv-info-meta">${esc(surfaceLabel(g.surface))} · #${esc(g.no)}</div>
            </aside>
        </div>
    </div>`;
}

// ---------- Events ----------
$("#refreshBtn").addEventListener("click", refreshAll);

// FR | EN switch: remembered on this device, French unless English is picked
(function setupLanguage() {
    document.querySelectorAll("#langSwitch [data-lang]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.lang === LANG)));
    $("#refreshBtn").setAttribute("aria-label", T("Rafraîchir", "Refresh")); $("#refreshBtn").title = T("Rafraîchir", "Refresh");
    $("#logoImg")?.setAttribute("alt", T("Logo Dragons", "Dragons logo"));
    document.querySelector("[data-close-sheet]")?.setAttribute("aria-label", T("Fermer", "Close"));
    $("#langSwitch")?.addEventListener("click", (e) => {
        const want = e.target.closest("[data-lang]")?.dataset.lang;
        if (!want || want === LANG) return;
        try { localStorage.setItem(LS_PREFIX + "lang", JSON.stringify(want)); } catch { /* blocked: the address keeps it */ }
        const url = new URL(location.href);
        if (want === "en") url.searchParams.set("lang", "en"); else url.searchParams.delete("lang");
        location.replace(url);
    });
})();

$("#picker").addEventListener("change", (e) => {
    const id = e.target.id, v = e.target.value;
    if (id === "seasonSelect") { state.seasonNo = v; loadSeason(); }
    else if (id === "classSelect") { state.classNo = v; state.teamNo = null; state.missing = false; loadDivision(); }
    else if (id === "teamSelect" && v) { state.teamNo = v; state.missing = false; state.opp = ""; loadTeam(); }
});
$("#picker").addEventListener("click", (e) => {
    const po = e.target.closest("[data-playoffs]");
    if (po && !po.disabled) {
        const on = po.dataset.playoffs === "1";
        if (on !== state.playoffs) { state.playoffs = on; loadSeason(); }
        return;
    }
    if (e.target.closest("#starBtn")) {
        const isDef = LS.get("default_team") === state.teamNo;
        if (isDef) { LS.del("default_team"); LS.del("default_class"); }
        else { LS.set("default_team", state.teamNo); LS.set("default_class", state.classNo); }
        renderPicker();
    }
});

$("#teamView").addEventListener("change", (e) => {
    if (e.target.id === "oppSelect") { state.opp = e.target.value; renderTeam(); }
});

document.addEventListener("click", (e) => {
    const t = e.target;
    if (t.closest("[data-close-sheet]") || t === $("#sheetBack")) { closeSheet(); return; }
    const oppBtn = t.closest("[data-opp]");
    if (oppBtn) { openOpponent(oppBtn.dataset.opp); return; }
    const sumBtn = t.closest("[data-summary]");
    if (sumBtn) { openSummary(sumBtn.dataset.summary); return; }
    const plBtn = t.closest("[data-player]");
    if (plBtn) { openPlayer(plBtn.dataset.player); return; }
    const goto = t.closest("[data-goto-team]");
    if (goto) {
        const sNo = goto.dataset.gotoSeason, s = state.seasons.find(x => x.no === sNo);
        closeSheet();
        if (!s) return;
        const reg = s.kind === "series" ? state.seasons.find(x => x.kind === "regular" && x.yearNo === s.yearNo && norm(s.name).replace(/^SERIES /, "") === norm(x.name)) : s;
        if (!reg) return;
        Object.assign(state, { seasonNo: reg.no, playoffs: s.kind === "series", teamNo: goto.dataset.gotoTeam, view: "games" });
        window.scrollTo({ top: 0, behavior: "smooth" });
        loadSeason();
        return;
    }
    const seasonBtn = t.closest("#teamView [data-season]");
    if (seasonBtn) { state.seasonNo = seasonBtn.dataset.season; state.playoffs = false; loadSeason(); return; }
    if (t.closest(":is(#teamView, #notice) [data-action=retry]")) { refreshAll(); return; }
    if (t.closest("#icsBtn")) { downloadICS(); return; }
    if (t.closest("#xlsxBtn")) { downloadXLSX(); return; }
    const luBtn = t.closest("#teamView [data-lineup]");
    if (luBtn) { openLineup(luBtn.dataset.lineup); return; }
    const viewBtn = t.closest("#teamView [data-view]");
    if (viewBtn) { state.view = viewBtn.dataset.view; LS.set("view", state.view); renderTeam(); return; }
    const tab = t.closest("#teamView [data-tab]");
    if (tab) { state.tab = tab.dataset.tab; renderTeam(); }
});

$("#lineup").addEventListener("click", (e) => {
    const a = e.target.closest("[data-lu]")?.dataset.lu;
    const slot = e.target.closest("[data-slot]");
    const opt = e.target.closest("[data-pid]");
    if (opt) { pickPlayer(opt.dataset.pid); renderLineup(); return; }
    if (slot && !slot.disabled) { lu.pick = slot.dataset.slot; renderLineup(); return; }
    if (!a) return;
    if (a === "close") closeLineup();
    else if (a === "bench") { lu.bench = true; renderLineup(); }
    else if (a === "bench-off") { lu.bench = false; renderLineup(); }
    else if (a === "edit") { lu.editing = true; renderLineup(); }
    else if (a === "pick-close") { lu.pick = null; renderLineup(); }
    else if (a === "clear") { lu.data = { slots: {}, res: [], abs: [] }; storeLineup(lu.gameNo, state.teamNo, lu.data); renderLineup(); }
    else if (a === "copy") {
        const prev = LS.get(`lineups_${state.teamNo}`, []).filter(x => x.g !== lu.gameNo).sort((x, y) => y.ts - x.ts)[0];
        const src = prev && readLineup(prev.g, state.teamNo);
        if (src) { lu.data = { slots: { ...src.slots }, res: [...(src.res || [])], abs: [...(src.abs || [])] }; storeLineup(lu.gameNo, state.teamNo, lu.data); renderLineup(); }
    }
});

document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (lu.open) { if (lu.pick) { lu.pick = null; renderLineup(); } else if (lu.bench) { lu.bench = false; renderLineup(); } else closeLineup(); }
    else if (!$("#sheet").hidden) closeSheet();
});

// ---------- Start ----------
(async function init() {
    progress(true); renderAll();
    try {
        await loadSeasons();
    } catch (e) {
        console.warn(e);
        state.error = T("Impossible de lire les données de la ligue.", "Could not read the league data.");
        progress(false); renderAll();
        return;
    }
    const params = new URLSearchParams(location.search);
    const wantSeason = params.get("saison"), wantTeam = params.get("equipe");
    const sWanted = wantSeason && state.seasons.find(s => s.no === wantSeason);
    if (sWanted && sWanted.kind !== "challenge") {
        const reg = sWanted.kind === "series" ? state.seasons.find(x => x.kind === "regular" && x.yearNo === sWanted.yearNo && norm(sWanted.name).replace(/^SERIES /, "") === norm(x.name)) : sWanted;
        state.seasonNo = reg?.no || pickDefaultSeason();
        state.playoffs = sWanted.kind === "series";
    } else state.seasonNo = pickDefaultSeason();
    state.teamNo = wantTeam || LS.get("default_team") || DRAGONS_NO;
    await loadSeason();
})();
