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
const dec = (n, d = 2) => n == null ? "–" : n.toFixed(d).replace(".", ",");

const fmtDayShort = new Intl.DateTimeFormat("fr-CA", { weekday: "short", day: "numeric", month: "short" });
const fmtTime = new Intl.DateTimeFormat("fr-CA", { hour: "2-digit", minute: "2-digit" });
const fmtDayLong = new Intl.DateTimeFormat("fr-CA", { weekday: "long", day: "numeric", month: "long" });
const fmtDate = new Intl.DateTimeFormat("fr-CA", { day: "numeric", month: "short", year: "numeric" });
const fmtDeadline = new Intl.DateTimeFormat("fr-CA", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const ordinal = (n) => n === 1 ? "1ᵉʳ" : `${n}ᵉ`;
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
// "SERIES ETE 2026" -> "Séries été 2026"; names typed in mixed case by the league are kept as typed
function seasonLabel(name, dropSeries = false) {
    let s = String(name || "").trim();
    if (s === s.toUpperCase()) s = s.toLowerCase();
    s = s.replace(/\b(e|é)t(e|é)\b/gi, "été").replace(/\bs(e|é)ries\b/gi, "séries");
    if (dropSeries) s = s.replace(/^séries\s+/i, "");
    return cap(s);
}

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
const RESULT_LABEL = { win: "Victoire", loss: "Défaite", tie: "Nulle" };

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
const myTeamName = () => state.team?.st_equip_name || state.teams.find(t => t.no === state.teamNo)?.name || "Équipe";

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
        Object.assign(state, { loading: false, error: "Impossible de lire les données de la ligue." });
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
        Object.assign(state, { loading: false, error: "Impossible de lire l'horaire de l'équipe." });
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
const ext = (href, label) => `<a class="ext" target="_blank" rel="noopener" href="${esc(href)}">${label} ↗</a>`;
const skeletons = (n, slim = false) => `<div class="cards">${`<div class="skeleton${slim ? " slim" : ""}"></div>`.repeat(n)}</div>`;
// All games are played at the same complex: only the rink name is shown
const surfaceLabel = (s) => String(s || "").trim() || "Glace à déterminer";
const ICON_PIN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>`;
const teamLink = (t, label = t.name) => t.no ? `<button type="button" class="link-btn" data-opp="${esc(t.no)}">${esc(label || "À déterminer")}</button>` : esc(label || "À déterminer");
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
        ${rec ? `<span class="rec" title="Fiche V-D-N et rang">${esc(rec)}</span>` : ""}
        <span class="side">${side === "home" ? "Local" : "Visiteur"}</span>
        ${rec ? "" : `<span class="pts">${pts ?? ""}</span>`}
    </div>`;
}

function gameCard(g, myNo = state.teamNo, withLineup = true) {
    const sc = g.score, live = isLive(g), result = resultOf(g, myNo);
    const lead = sc ? (sc.h > sc.a ? "home" : sc.a > sc.h ? "away" : "tie") : null;
    const when = `${fmtDayShort.format(g.start)}${g.hasTime ? ` · ${fmtTime.format(g.start)}` : ""}`;
    const badges = [];
    if (live) badges.push(`<span class="badge live">En direct${g.period ? ` · ${esc(g.period)}` : ""}</span>`);
    if (result) badges.push(`<span class="badge ${result}">${RESULT_LABEL[result]}</span>`);
    if (g.status === "FORFAIT") badges.push(`<span class="badge">Forfait</span>`);
    if (g.shootout && isFinal(g)) badges.push(`<span class="badge">Fusillade</span>`);
    if (g.no) badges.push(`<span class="badge">#${esc(g.no)}</span>`);

    const upcoming = !sc && !isPlayed(g);
    const awayRec = upcoming && g.away.no !== myNo ? recordText(g.away.no) : "";
    const homeRec = upcoming && g.home.no !== myNo ? recordText(g.home.no) : "";
    const hasLineup = withLineup && !!readLineup(g.no, myNo);
    const lineupBtn = withLineup && myNo === state.teamNo
        ? `<button type="button" class="lu-btn${hasLineup ? " has" : ""}" data-lineup="${esc(g.no)}">${isPlayed(g) ? (hasLineup ? "Alignement utilisé" : "+ Alignement") : "Alignement"}</button>` : "";
    // Everything stays on this page: the summary opens in the side sheet, like the Roussillon and Chambly pages
    const opp = oppOf(g, myNo);
    const links = g.no ? `<div class="links">
        ${lineupBtn}
        ${opp.no ? `<button type="button" class="lu-btn" data-opp="${esc(opp.no)}">Adversaire</button>` : ""}
        ${isFinal(g) ? `<button type="button" class="lu-btn sum" data-summary="${esc(g.no)}">Sommaire</button>` : ""}
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
    const classOpts = state.classes.map(c => `<option value="${esc(c.classNo)}"${c.classNo === state.classNo ? " selected" : ""}>${esc(c.name)}</option>`).join("");
    const teamOpts = (state.missing && state.teamNo ? `<option value="" selected>Choisir une équipe…</option>` : "")
        + state.teams.map(t => `<option value="${esc(t.no)}"${t.no === state.teamNo && !state.missing ? " selected" : ""}>${esc(t.name)}</option>`).join("");
    const isDefault = state.teamNo && LS.get("default_team") === state.teamNo;

    el.innerHTML = `<div class="picker">
        <div>
            <span class="field-label">Saison</span>
            <div class="field-row">
                ${select("seasonSelect", "Saison", groups, state.seasonNo)}
                <div class="seg" role="tablist" aria-label="Saison ou séries">
                    <button type="button" data-playoffs="0" aria-selected="${!state.playoffs || !series}">Saison</button>
                    <button type="button" data-playoffs="1" aria-selected="${state.playoffs && !!series}"${series ? "" : " disabled title=\"Pas de séries pour cette saison\""}>Séries</button>
                </div>
            </div>
        </div>
        <div>
            <span class="field-label">Division et équipe</span>
            <div class="field-row two">
                ${select("classSelect", "Division", classOpts, state.classNo, !state.classes.length)}
                ${select("teamSelect", "Équipe", teamOpts, state.teamNo, !state.teams.length)}
                <button type="button" class="star-btn" id="starBtn" aria-pressed="${!!isDefault}" title="Ouvrir cette équipe par défaut"${state.teamNo && !state.missing ? "" : " disabled"}>${ICON_STAR}<span>Par défaut</span></button>
            </div>
        </div>
    </div>`;
}

// ---------- Next game (hero) ----------
function countdown(g) {
    if (isLive(g)) return "En direct";
    const now = new Date();
    const mins = Math.round((g.start - now) / 60000);
    const days = Math.round((startOfDay(g.start) - startOfDay(now)) / 86400000);
    if (mins <= 0) return "Début imminent";
    if (mins < 60) return `Dans ${mins} min`;
    if (days === 0) return `Aujourd'hui · dans ${Math.round(mins / 60)} h`;
    if (days === 1) return "Demain";
    return `Dans ${days} jours`;
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
            <span class="next-label">${firstGame ? "La saison commence" : "Prochain match"}</span>
            <span class="badge ${isLive(g) ? "live" : "duel"}" data-countdown>${esc(countdown(g))}</span>
        </div>
        <div class="next-when">${esc(cap(day))}${g.hasTime ? ` · ${esc(fmtTime.format(g.start))}` : ""}</div>
        <div class="next-match">
            <strong>${esc(me.name || myTeamName())}</strong>
            <span class="vs">${isHome ? "reçoit" : "visite"}</span>
            <strong>${teamLink(opp)}</strong>
            ${oppRec ? `<span class="rec">(${esc(oppRec)})</span>` : ""}
        </div>
        <div class="next-foot">
            <div class="next-venue"><div><b>${esc(surfaceLabel(g.surface))}</b>${isHome ? "Local" : "Visiteur"} · partie #${esc(g.no)}</div></div>
            <div class="next-btns">
                ${opp.no ? `<button type="button" class="btn ghost" data-opp="${esc(opp.no)}">Adversaire</button>` : ""}
                <button type="button" class="btn" data-lineup="${esc(g.no)}">Alignement</button>
            </div>
        </div>
    </article>`;
}

// ---------- Horaire ----------
function formStrip(games, teamNo) {
    const last = games.filter(g => isPlayed(g) && resultOf(g, teamNo)).sort((a, b) => b.start - a.start).slice(0, 5).reverse();
    if (!last.length) return "";
    return `<span class="form" aria-label="Cinq dernières parties">${last.map(g => {
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
        ? `<span class="rank-badge" title="Rang dans la division">${ordinal(row.rank)} sur ${state.standing.length} · ${row.pts} pts</span>` : "";
    const nSusp = (mySusp()?.mine || []).filter(isActiveSusp).length;
    const susp = nSusp ? `<button type="button" class="badge loss" data-view="susp">🚫 ${nSusp} suspension${nSusp > 1 ? "s" : ""}</button>` : "";
    const img = state.team?.st_equip_img ? sized(state.team.st_equip_img, 160) : state.teamNo === DRAGONS_NO ? DRAGONS_LOGO : "";
    const logo = img ? `<img class="team-logo" src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()">` : "";
    return `<div class="team-head">
        <div class="team-id">
            <span class="team-bar"></span>${logo}
            <div>
                <h3>${esc(myTeamName())}</h3>
                <div class="team-meta">
                    <span class="record" aria-label="Fiche"><span class="w">${rec.win} V</span><span class="l">${rec.loss} D</span><span class="t">${rec.tie} N</span></span>
                    ${rank}${formStrip(state.games, state.teamNo)}${susp}
                </div>
            </div>
        </div>
        <div class="ics-wrap">
            <button type="button" class="ics-btn" id="icsBtn" title="Télécharger l'horaire dans mon calendrier">${ICON_CAL}<span>.ics</span></button>
            <span class="ics-hint" id="icsHint">⬅ Ajouter à mon calendrier</span>
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
    const filter = tab === "results" && opps.size > 1 ? `<div class="opp-pick">${select("oppSelect", "Filtrer par adversaire",
        `<option value="">Tous les adversaires (${played.length})</option>` + [...opps].sort((a, b) => a[1].name.localeCompare(b[1].name, "fr"))
            .map(([no, o]) => `<option value="${esc(no)}"${no === state.opp ? " selected" : ""}>${esc(o.name)} (${o.n})</option>`).join(""))}</div>` : "";
    const list = tab === "upcoming" ? upcoming : played.filter(g => !state.opp || oppOf(g, state.teamNo).no === state.opp);
    const emptyMsg = tab === "upcoming" ? "Aucune partie à venir." : "Aucun résultat pour l'instant.";

    return `<div class="team">
        <div class="seg sub-tabs" role="tablist">
            <button type="button" role="tab" data-tab="upcoming" aria-selected="${tab === "upcoming"}">À venir <span class="count">${upcoming.length}</span></button>
            <button type="button" role="tab" data-tab="results" aria-selected="${tab === "results"}">Résultats <span class="count">${played.length}</span></button>
        </div>
        ${filter}
        ${list.some(g => g.home.no === state.teamNo) ? `<div class="legend"><i></i>Parties comme équipe locale</div>` : ""}
        <div class="cards">${list.length ? list.map(g => gameCard(g)).join("") : `<div class="empty">${emptyMsg}</div>`}</div>
    </div>`;
}

// ---------- Classement ----------
function standingsView() {
    const link = ext(`${SITE}/classement/`, "Site de la ligue");
    if (!state.standing) return `<div class="notice error" style="margin-top:14px">Classement indisponible pour le moment.<br>${link}</div>`;
    if (!state.standing.length) return `<div class="empty" style="margin-top:14px">Aucun classement pour cette saison.</div>`;
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
        <div class="panel-title">${esc(currentClass()?.name || "")} · ${esc(shownSeason()?.name || "")}</div>
        <div class="table-scroll"><table class="standings">
            <thead><tr>
                <th class="c-rank">#</th><th class="c-team">Équipe</th>
                <th title="Parties jouées">PJ</th><th title="Victoires">V</th><th title="Défaites (incluant forfaits)">D</th><th title="Défaites en prolongation ou en fusillade">DP</th><th title="Nulles">N</th>
                <th class="wide" title="Buts pour">BP</th><th class="wide" title="Buts contre">BC</th><th class="wide" title="Différentiel">+/-</th>
                <th class="c-pts" title="Points">Pts</th>
            </tr></thead>
            <tbody>${body}</tbody>
        </table></div>
        <div class="panel-foot"><span>${started ? "Classement officiel · touchez une équipe pour sa fiche" : "La saison n'a pas encore commencé."}</span>${link}</div>
    </div>`;
}

// ---------- Statistiques ----------
function statsView() {
    const link = ext(`${SITE}/equipes/?seasonNo=${encodeURIComponent(shownSeasonNo())}&teamNo=${encodeURIComponent(state.teamNo)}`, "Site de la ligue");
    const excel = `<div class="stats-actions"><button type="button" class="btn" id="xlsxBtn">⬇ Fichier Excel</button><span class="hint">Équipe, matchs, joueurs et gardiens de la saison affichée</span></div>`;
    let players;
    if (!state.players) players = `<div class="notice error">Statistiques des joueurs indisponibles.<br>${link}</div>`;
    else if (!state.players.length) players = `<div class="empty">Aucune statistique de joueur pour l'instant.</div>`;
    else {
        const top = Math.max(...state.players.map(p => p.pts));
        players = `<div class="panel"><div class="panel-title">Joueurs</div><div class="table-scroll"><table class="standings stats">
            <thead><tr><th class="c-num">#</th><th class="c-team">Joueur</th><th title="Parties jouées">PJ</th><th title="Buts">B</th><th title="Passes">A</th><th class="c-pts" title="Points">Pts</th>
                <th title="Minutes de punition">Pun</th><th title="Buts en avantage numérique">BAN</th><th title="Buts en désavantage numérique">BDN</th><th title="Buts gagnants">BG</th></tr></thead>
            <tbody>${state.players.map(p => `<tr class="${top > 0 && p.pts === top ? "top" : ""}">
                <td class="c-num">${p.num && p.num !== "0" ? `#${esc(p.num)}` : ""}</td>
                <td class="c-team" title="${esc(p.name)}"><span class="cell-id">${avatar(p.img, p.name)}${playerLink(p)}</span></td>
                <td>${p.pj}</td><td>${p.b}</td><td>${p.a}</td><td class="c-pts">${p.pts}</td><td>${p.pun}</td><td>${p.ban}</td><td>${p.bdn}</td><td>${p.bg}</td>
            </tr>`).join("")}</tbody>
        </table></div></div>`;
    }
    let goalies = "";
    if (state.goalies?.length) {
        goalies = `<div class="panel"><div class="panel-title">Gardiens</div><div class="table-scroll"><table class="standings stats">
            <thead><tr><th class="c-team">Gardien</th><th title="Parties jouées">PJ</th><th title="Victoires">V</th><th title="Défaites">D</th><th title="Nulles">N</th>
                <th title="Tirs reçus">TR</th><th title="Buts contre">BC</th><th title="Efficacité">Eff</th><th title="Moyenne de buts alloués par partie">Moy</th><th title="Blanchissages">BL</th></tr></thead>
            <tbody>${state.goalies.map(g => `<tr>
                <td class="c-team" title="${esc(g.name)}"><span class="cell-id">${avatar(g.img, g.name)}${playerLink(g)}</span></td>
                <td>${g.pj}</td><td>${g.v}</td><td>${g.d}</td><td>${g.n}</td><td>${g.tr}</td><td>${g.bc}</td>
                <td>${g.eff == null ? "–" : dec(g.eff, 3).replace(/^0/, "")}</td><td>${dec(g.moy)}</td><td>${g.bl}</td>
            </tr>`).join("")}</tbody>
        </table></div></div>`;
    }
    return `<div class="stats-view">${excel}${players}${goalies}
        <div class="view-foot"><span>Statistiques officielles · touchez un joueur pour son historique</span>${link}</div></div>`;
}

// ---------- Suspensions ----------
function suspItem(x, mine) {
    const active = isActiveSusp(x);
    const badge = active
        ? `<span class="badge loss">${x.end ? `Jusqu'au ${esc(fmtDate.format(x.end))}` : x.games ? `${x.served}/${x.games} purgée${x.served > 1 ? "s" : ""}` : "En cours"}</span>`
        : `<span class="badge win">Terminée</span>`;
    const meta = [x.abbr, x.date ? fmtDate.format(x.date) : "", x.games ? `${x.games} partie${x.games > 1 ? "s" : ""}` : "", x.carried ? "Saison régulière" : ""].filter(Boolean).join(" · ");
    return `<div class="susp${mine ? " is-r" : ""}${active ? "" : " done"}">
        ${avatar(x.img, x.name, "lg")}
        <div class="susp-main">
            <div class="susp-name">${x.id ? playerLink(x) : esc(x.name || "—")}</div>
            <div class="susp-meta">${esc(meta)}</div>
            ${x.reason ? `<div class="susp-reason">${esc(x.reason)}</div>` : ""}
        </div>
        ${badge}
    </div>`;
}

function suspensionsView() {
    const link = ext(`${SITE}/suspensions/`, "Site de la ligue");
    const lists = mySusp();
    const body = !lists ? `<div class="notice error">Suspensions indisponibles pour le moment.</div>`
        : (lists.mine.length ? lists.mine.map(x => suspItem(x, true)).join("") : `<div class="empty">Aucune suspension pour ${esc(myTeamName())}.</div>`)
          + (lists.others.length ? `<details class="others"><summary>Autres équipes de la division (${lists.others.length})</summary>${lists.others.map(x => suspItem(x, false)).join("")}</details>` : "");
    return `<div class="susp-group">${body}<div class="view-foot"><span>Suspensions officielles</span>${link}</div></div>`;
}

// ---------- Team view ----------
function missingView() {
    const reg = regularSeason();
    const prev = state.seasons.filter(s => s.kind === "regular");
    const i = prev.findIndex(s => s.no === state.seasonNo);
    const before = i >= 0 ? prev[i + 1] : null;
    return `<div class="notice" style="margin-top:16px">
        Cette équipe n'a pas joué en ${esc(seasonLabel(shownSeason()?.name || reg?.name || "cette saison"))}.<br>Choisissez une équipe ci-dessus${before ? ` ou revenez à la saison précédente.<br><button type="button" data-season="${esc(before.no)}">${esc(seasonLabel(before.name))}</button>` : "."}
    </div>`;
}

function emptySeasonView() {
    const regs = state.seasons.filter(s => s.kind === "regular");
    const i = regs.findIndex(s => s.no === state.seasonNo);
    const before = i >= 0 ? regs[i + 1] : null;
    return `<div class="notice" style="margin-top:16px">
        La saison commence bientôt : l'horaire n'est pas encore publié.
        ${before ? `<br><button type="button" data-season="${esc(before.no)}">Voir ${esc(seasonLabel(before.name))}</button>` : ""}
    </div>`;
}

function renderTeam() {
    const view = $("#teamView");
    if (state.loading && !state.games.length) {
        view.innerHTML = `<div style="margin-top:16px">${skeletons(1)}</div><div style="margin-top:14px">${skeletons(4)}</div>`;
        return;
    }
    if (state.error) {
        view.innerHTML = `<div class="notice error" style="margin-top:16px">${esc(state.error)}<br><button type="button" data-action="retry">Réessayer</button></div>`;
        return;
    }
    if (state.missing) { view.innerHTML = missingView(); return; }
    if (!state.teamNo) { view.innerHTML = `<div class="empty" style="margin-top:16px">Aucune équipe dans cette division.</div>`; return; }
    if (!state.games.length) { view.innerHTML = teamHead() + emptySeasonView(); return; }

    const nSusp = (mySusp()?.mine || []).filter(isActiveSusp).length;
    const tab = (id, label) => `<button type="button" role="tab" data-view="${id}" aria-selected="${state.view === id}">${label}</button>`;
    const tabs = `<div class="seg view-tabs" role="tablist">
        ${tab("games", "Horaire")}${tab("standings", "Classement")}${tab("stats", "Stats")}
        ${tab("susp", `Susp.${nSusp ? ` <span class="count alert">${nSusp}</span>` : ""}`)}
    </div>`;
    const body = state.view === "standings" ? standingsView()
        : state.view === "stats" ? statsView()
        : state.view === "susp" ? suspensionsView()
        : scheduleView();
    view.innerHTML = nextGameCard() + teamHead() + tabs + body;
}

const fmtStamp = new Intl.DateTimeFormat("fr-CA", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
function renderControls() {
    const saved = SNAP?.fetchedAt ? new Date(SNAP.fetchedAt) : null;
    $("#notice").innerHTML = offline.used && !state.loading ? `<div class="stale">
        <span>Site de la ligue injoignable : données enregistrées${saved && !isNaN(saved) ? ` le <b>${esc(fmtStamp.format(saved))}</b>` : ""}.</span>
        <button type="button" class="btn ghost" data-action="retry">Réessayer</button>
    </div>` : "";
    const s = shownSeason();
    $("#subtitle").textContent = [state.teamNo && !state.missing ? myTeamName() : "", s ? seasonLabel(s.name) : ""].filter(Boolean).join(" · ") || "Horaire et statistiques";
    document.title = `${state.teamNo && !state.missing ? myTeamName() + " – " : ""}Dragons`;
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
        || state.games.map(g => [g.home, g.away]).flat().find(t => t.no === no)?.name || "Adversaire";
    openSheet(esc(name), skeletons(3, true));
    const [team, cal, pl] = await Promise.all([soft(Q.team(s, no)), soft(Q.calendar(s, no)), soft(Q.players(s, no))]);
    if (token !== sheetToken) return;
    const games = parseGames(cal);
    const players = parsePlayers(pl) || [];
    const played = games.filter(isPlayed).sort((a, b) => b.start - a.start);
    const div = state.classes.find(c => c.scNo === String(team?.st_sc_no || ""))?.name || "";
    const row = standRow(no);
    const colour = no === DRAGONS_NO ? DRAGONS_COLOUR : team ? teamColour(team.st_equip_color_1, team.st_equip_color_2) : "var(--border)";

    const rec = { win: 0, loss: 0, tie: 0, bp: 0, bc: 0 };
    played.forEach(g => {
        const r = resultOf(g, no); if (r) rec[r]++;
        if (g.score && isFinal(g)) { const home = g.home.no === no; rec.bp += home ? g.score.h : g.score.a; rec.bc += home ? g.score.a : g.score.h; }
    });
    const h2h = state.games.filter(g => isPlayed(g) && (g.home.no === no || g.away.no === no) && g.score).sort((a, b) => b.start - a.start);
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
                <div class="record big"><span class="w">${row && seasonStarted() ? row.v : rec.win} V</span><span class="l">${row && seasonStarted() ? row.losses : rec.loss} D</span><span class="t">${row && seasonStarted() ? row.n : rec.tie} N</span></div>
                <div class="opp-sub">${row?.rank && seasonStarted() ? `${ordinal(row.rank)} de la division · ${row.pts} pts · ` : ""}${rec.bp} BP · ${rec.bc} BC${row && seasonStarted() ? "" : " · compté à partir de leurs matchs"}</div>
            </div>
        </div>
        ${formStrip(games, no) ? `<h4>5 derniers matchs</h4><div class="form big">${formStrip(games, no).replace(/^<span[^>]*>|<\/span>$/g, "")}</div>` : ""}
        <h4>Face à face${h2h.length ? ` · ${esc(myTeamName())} ${h2hRec.win}-${h2hRec.loss}-${h2hRec.tie}` : ""}</h4>
        ${h2h.length ? `<div class="mini-list">${h2h.map(g => miniGame(g, state.teamNo)).join("")}</div>` : `<div class="hint">Aucun match joué entre les deux équipes cette saison.</div>`}
        ${common.length ? `<h4>Adversaires communs</h4><table class="standings mini"><thead><tr><th class="c-team">Adversaire</th><th>${esc(myTeamName())}</th><th>${esc(name)}</th></tr></thead><tbody>
            ${common.map(k => `<tr><td class="c-team">${esc(oppOf(mine.get(k)[0], state.teamNo).name)}</td><td><span class="form">${resText(mine.get(k), state.teamNo)}</span></td><td><span class="form">${resText(theirs.get(k), no)}</span></td></tr>`).join("")}
        </tbody></table>` : ""}
        <h4>Meilleurs pointeurs</h4>
        ${top.length ? `<table class="standings mini"><thead><tr><th class="c-num">#</th><th class="c-team">Joueur</th><th>PJ</th><th>B</th><th>A</th><th class="c-pts">Pts</th></tr></thead><tbody>
            ${top.map(p => `<tr><td class="c-num">${p.num && p.num !== "0" ? `#${esc(p.num)}` : ""}</td><td class="c-team"><span class="cell-id">${avatar(p.img, p.name)}${playerLink(p)}</span></td><td>${p.pj}</td><td>${p.b}</td><td>${p.a}</td><td class="c-pts">${p.pts}</td></tr>`).join("")}
        </tbody></table>` : `<div class="hint">Aucune statistique pour l'instant.</div>`}
        <h4>Tous leurs résultats (${played.length})</h4>
        ${played.length ? `<div class="mini-list">${played.map(g => miniGame(g, no)).join("")}</div>` : `<div class="hint">Aucun match joué.</div>`}
        <div class="view-foot">${ext(`${SITE}/equipes/?seasonNo=${encodeURIComponent(s)}&teamNo=${encodeURIComponent(no)}`, "Fiche sur le site de la ligue")}</div>`;
    openSheet(esc(team?.st_equip_name || name), html);
}

function miniGame(g, teamNo) {
    const r = resultOf(g, teamNo), opp = oppOf(g, teamNo), home = g.home.no === teamNo;
    return `<div class="mini-game">
        <span class="mini-date">${esc(fmtDayShort.format(g.start))}</span>
        ${teamMark(opp, "sm")}<span class="mini-opp">${home ? "vs" : "@"} ${esc(opp.name)}</span>
        ${r ? `<span class="badge ${r}">${RESULT_LABEL[r][0]} ${esc(scoreFor(g, teamNo))}${g.shootout ? " FU" : ""}</span>` : `<span class="badge">${g.score && isFinal(g) ? esc(scoreFor(g, teamNo)) : "—"}</span>`}
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
    if (/PROL/.test(n)) return { short: "Prol.", long: "Prolongation" };
    const d = n.match(/^(\d+)/)?.[1] || String(i + 1);
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
    return s;
}

async function openSummary(gameNo) {
    const token = ++sheetToken;
    openSheet("Sommaire du match", skeletons(3, true));
    const g = state.games.find(x => x.no === gameNo);
    const fresh = g ? isLive(g) : false;
    const [board, stats, goals, pens] = await Promise.all([soft(Q.board(gameNo, fresh)), soft(Q.gameStats(gameNo, fresh)), soft(Q.goals(gameNo, fresh)), soft(Q.penalties(gameNo, fresh))]);
    if (token !== sheetToken) return;
    if (!board || !board.gameNo) { openSheet("Sommaire du match", `<div class="notice error" style="margin-top:16px">Sommaire indisponible pour le moment.</div>`); return; }
    const s = parseSummary(board, stats, goals, pens);
    const A = s.away, H = s.home;
    const sideOf = (home) => home ? H : A;
    const persp = [A.no, H.no].includes(state.teamNo) ? state.teamNo : "";
    const res = g && persp ? resultOf(g, persp) : null;

    // Head: both teams, logos and final score
    const head = `<div class="sum-head">
        <div class="sum-team">${teamMark(A, "xl")}<b>${A.no && A.no !== state.teamNo ? teamLink(A) : esc(A.name)}</b><small>Visiteur${A.fiche ? ` · ${esc(A.fiche)}` : ""}</small></div>
        <div class="sum-score"><span>${A.score}</span><i>–</i><span>${H.score}</span>
            <small>${s.status === "FORFAIT" ? "Forfait" : s.shootout ? "Fusillade" : s.status === "END" ? "Final" : s.status ? "En cours" : ""}</small>
            ${res ? `<span class="badge ${res}">${RESULT_LABEL[res]}</span>` : ""}</div>
        <div class="sum-team">${teamMark(H, "xl")}<b>${H.no && H.no !== state.teamNo ? teamLink(H) : esc(H.name)}</b><small>Local${H.fiche ? ` · ${esc(H.fiche)}` : ""}</small></div>
    </div>
    <div class="sum-meta">${esc([s.start ? cap(fmtDayLong.format(s.start)) : "", s.start ? fmtTime.format(s.start) : "", s.className, `#${gameNo}`].filter(Boolean).join(" · "))}</div>`;

    // Score by period (+ shootout), with shots
    const pcols = s.periods.map(p => p.short);
    const soWin = s.shootout ? (H.score > A.score ? "home" : "away") : "";
    const line = (t, home) => `<tr${t.no === state.teamNo ? ` class="me"` : ""}><td class="c-team"><span class="cell-id">${teamMark(t, "sm")}<span class="nm">${esc(t.name)}</span></span></td>
        ${pcols.map(p => `<td>${s.goals.filter(x => x.p === p && x.home === home).length}</td>`).join("")}
        ${s.shootout ? `<td>${soWin === (home ? "home" : "away") ? 1 : 0}</td>` : ""}
        <td class="c-pts">${t.score}</td><td class="muted">${t.stats?.shots ?? "–"}</td></tr>`;
    const board_ = `<div class="panel tight"><div class="table-scroll"><table class="standings scoreboard">
        <thead><tr><th class="c-team">Équipe</th>${pcols.map(p => `<th>${esc(p)}</th>`).join("")}${s.shootout ? `<th title="Fusillade">TB</th>` : ""}<th class="c-pts">T</th><th title="Tirs au but">Tirs</th></tr></thead>
        <tbody>${line(A, false)}${line(H, true)}</tbody></table></div></div>`;

    // Official statistics, visitor on the left and home team on the right (same four boxes as the Spordle pages)
    const pct = (a, b) => b ? `${(100 * a / b).toFixed(1).replace(".", ",").replace(/,0$/, "")} %` : "–";
    const val = (v) => v ?? "–";
    const pk = (t, o) => o.stats?.ppo != null && o.stats?.ppg != null ? { k: o.stats.ppo - o.stats.ppg, n: o.stats.ppo } : null;
    const pkA = pk(A, H), pkH = pk(H, A);
    const nPen = (home) => s.pens.filter(x => x.home === home).length;
    const box = (label, a, h, aSub = "", hSub = "") => `<div class="gs-box">
        <div class="gs-label">${label}</div>
        <div class="gs-vals">
            <div class="gs-side">${teamMark(A, "sm")}<span><b>${a}</b>${aSub ? `<small>${aSub}</small>` : ""}</span></div>
            <div class="gs-side home"><span><b>${h}</b>${hSub ? `<small>${hSub}</small>` : ""}</span>${teamMark(H, "sm")}</div>
        </div>
    </div>`;
    const boxes = A.stats && H.stats ? `<h4>Statistiques du match</h4><div class="gs-grid">
        ${box("Avantage num.", `${val(A.stats.ppg)}/${val(A.stats.ppo)}`, `${val(H.stats.ppg)}/${val(H.stats.ppo)}`, pct(A.stats.ppg, A.stats.ppo), pct(H.stats.ppg, H.stats.ppo))}
        ${box("Désavantage num.", pkA ? `${pkA.k}/${pkA.n}` : "–", pkH ? `${pkH.k}/${pkH.n}` : "–", pkA ? pct(pkA.k, pkA.n) : "", pkH ? pct(pkH.k, pkH.n) : "")}
        ${box("Minutes de punition", A.stats.pim, H.stats.pim, `${nPen(false)} pun.`, `${nPen(true)} pun.`)}
        ${s.fj.away != null || s.fj.home != null ? box("Points Franc Jeu", val(s.fj.away), val(s.fj.home)) : ""}
    </div>` : "";

    // Goals and penalties by period, in game-clock order, with the player's photo
    const pname = (p) => p ? `${p.num && p.num !== "0" ? `#${esc(p.num)} ` : ""}${p.id ? `<button type="button" class="link-btn" data-player="${esc(p.id)}">${esc(p.name)}</button>` : esc(p.name)}` : "";
    const byPeriod = (list, render) => {
        if (!list.length) return `<div class="empty">Aucun.</div>`;
        return s.periods.filter(p => list.some(x => x.p === p.short)).map(p =>
            `<p class="sum-period">${esc(p.long)}</p><div class="sum-list">${list.filter(x => x.p === p.short).sort((a, b) => secs(a.t) - secs(b.t)).map(render).join("")}</div>`).join("");
    };
    const goalItem = (x) => {
        const t = sideOf(x.home);
        return `<div class="sum-item${t.no === state.teamNo ? " mine" : ""}">
            <span class="d">${esc(x.t)}</span>${teamMark(t, "sm")}${avatar(x.img, x.scorer?.name)}
            <span class="o"><span class="who">${x.scorer ? pname(x.scorer) : `But — ${esc(t.name)}`}${x.scorer?.n ? ` <span class="sum-as">(${esc(x.scorer.n)})</span>` : ""}${x.sit ? ` <span class="flag">${esc(x.sit)}</span>` : ""}</span>
                <span class="sum-as">${x.assists.length ? `Passes : ${x.assists.map(pname).join(", ")}` : "Sans passe"}</span></span>
            <span class="sum-run">${x.score.a}-${x.score.h}</span>
        </div>`;
    };
    const penItem = (x) => {
        const t = sideOf(x.home);
        return `<div class="sum-item${t.no === state.teamNo ? " mine" : ""}">
            <span class="d">${esc(x.t)}</span>${teamMark(t, "sm")}${avatar(x.img, x.name || t.name)}
            <span class="o"><span class="who">${x.name ? pname(x) : "Punition de banc"}</span><span class="sum-as">${esc(x.what || "Punition")}</span></span>
            <span class="sum-run">${x.min != null ? `${String(x.min).replace(".", ",")} min` : ""}</span>
        </div>`;
    };
    const so = s.so.length ? `<h4>Fusillade</h4><div class="sum-list">${s.so.sort((a, b) => a.n - b.n).map(x => {
        const t = norm(x.abbr) === norm(H.abbr) ? H : A;
        return `<div class="sum-item${t.no === state.teamNo ? " mine" : ""}"><span class="d">${x.n}</span>${teamMark(t, "sm")}<span class="o"><span class="who">${pname(x)}</span></span>
            <span class="sum-run ${x.scored ? "yes" : "no"}">${x.scored ? "✓ But" : "✗ Raté"}</span></div>`;
    }).join("")}</div>` : "";

    const html = head
        + (s.status === "FORFAIT" ? `<div class="notice" style="margin-top:12px">Match gagné par forfait.</div>` : "")
        + `<h4>Pointage</h4>${board_}${boxes}
        <h4><span>Buts</span> <span class="count-tag">${s.goals.length}</span></h4>${byPeriod(s.goals, goalItem)}
        ${so}
        <h4><span>Punitions</span> <span class="count-tag">${s.pens.length}</span></h4>${byPeriod(s.pens, penItem)}
        <div class="view-foot"><span>Pointage courant à droite (visiteur-local) · (n) = buts de la saison · AN = avantage numérique</span></div>`;
    openSheet("Sommaire du match", html);
}

// Player history: stats season by season, across every team the player has played for
async function openPlayer(id) {
    const token = ++sheetToken;
    openSheet("Joueur", skeletons(3, true));
    const info = await soft(Q.playerInfo(id));
    if (token !== sheetToken) return;
    if (!info || info.error) { openSheet("Joueur", `<div class="notice error">Fiche du joueur indisponible.</div>`); return; }
    const goalie = !!info.isGoalie || !!info.isGoalieAndForward, skater = !!info.isForward || !!info.isGoalieAndForward || !goalie;
    const [cs, cg] = await Promise.all([skater ? soft(Q.career(id, false)) : null, goalie ? soft(Q.career(id, true)) : null]);
    if (token !== sheetToken) return;
    const sk = parseCareer(cs, false), gk = parseCareer(cg, true);

    const seasonCell = (r) => `<td class="c-team"><div class="cs-season">${esc(seasonLabel(r.season, true))}${r.series ? ` <span class="tag">Séries</span>` : ""}</div>
        <div class="cs-team">${r.teamNo ? `<button type="button" class="link-btn" data-goto-team="${esc(r.teamNo)}" data-goto-season="${esc(r.seasonNo)}">${esc(r.team)}</button>` : esc(r.team)}${r.div ? ` · ${esc(r.div)}` : ""}</div></td>`;
    const sum = (list, k) => list.reduce((t, r) => t + (r[k] || 0), 0);

    let html = `<div class="opp-head">
        ${avatar(info.sp_play_img, info.sp_player_name, "xl")}
        <div>
            <div class="opp-sub">${esc(info.pos_abbr === "ATT" ? "Attaquant" : info.pos_abbr === "DEF" ? "Défenseur" : goalie && !skater ? "Gardien" : "")}</div>
            <div class="opp-sub">Équipe actuelle : <b>${esc(info.st_equip_name || "—")}</b></div>
        </div>
    </div>`;
    if (sk.length) {
        const reg = sk.filter(r => !r.series), ser = sk.filter(r => r.series);
        const nSeasons = new Set(reg.map(r => r.seasonNo)).size, nTeams = new Set(sk.map(r => norm(r.team))).size;
        html += `<h4>Joueur · ${nSeasons} saison${nSeasons > 1 ? "s" : ""} · ${nTeams} équipe${nTeams > 1 ? "s" : ""}</h4>
        <div class="table-scroll"><table class="standings mini career"><thead><tr><th class="c-team">Saison · équipe</th><th>PJ</th><th>B</th><th>A</th><th class="c-pts">Pts</th><th>Pun</th></tr></thead><tbody>
            ${sk.map(r => `<tr class="${r.teamNo === state.teamNo ? "me" : ""}">${seasonCell(r)}<td>${r.pj}</td><td>${r.b}</td><td>${r.a}</td><td class="c-pts">${r.pts}</td><td>${r.pun}</td></tr>`).join("")}
        </tbody><tfoot>
            <tr><td class="c-team">Total saisons</td><td>${sum(reg, "pj")}</td><td>${sum(reg, "b")}</td><td>${sum(reg, "a")}</td><td class="c-pts">${sum(reg, "pts")}</td><td>${sum(reg, "pun")}</td></tr>
            ${ser.length ? `<tr><td class="c-team">Total séries</td><td>${sum(ser, "pj")}</td><td>${sum(ser, "b")}</td><td>${sum(ser, "a")}</td><td class="c-pts">${sum(ser, "pts")}</td><td>${sum(ser, "pun")}</td></tr>` : ""}
        </tfoot></table></div>`;
    }
    if (gk.length) {
        html += `<h4>Gardien</h4>
        <div class="table-scroll"><table class="standings mini career"><thead><tr><th class="c-team">Saison · équipe</th><th>PJ</th><th>V</th><th>D</th><th>N</th><th>BC</th><th>Eff</th><th>Moy</th></tr></thead><tbody>
            ${gk.map(r => `<tr class="${r.teamNo === state.teamNo ? "me" : ""}">${seasonCell(r)}<td>${r.pj}</td><td>${r.v}</td><td>${r.d}</td><td>${r.n}</td><td>${r.bc}</td><td>${r.eff == null ? "–" : dec(r.eff, 3).replace(/^0/, "")}</td><td>${dec(r.moy)}</td></tr>`).join("")}
        </tbody></table></div>`;
    }
    if (!sk.length && !gk.length) html += `<div class="hint">Aucune statistique enregistrée.</div>`;
    html += `<div class="view-foot"><span>Pun = minutes de punition</span>${ext(`${SITE}/liste-des-joueurs/`, "Site de la ligue")}</div>`;
    openSheet(esc(info.sp_player_name || "Joueur"), html);
}

// ---------- Calendar export (.ics) ----------
function icsDate(d) { return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
function icsText(s) { return String(s).replace(/[\\;,]/g, m => "\\" + m).replace(/\n/g, "\\n"); }
function downloadICS() {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Dragons//Horaire//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
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
            `DESCRIPTION:${icsText(`Partie #${g.no} · ${home ? "Local" : "Visiteur"}`)}`,
            "END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    saveFile(new Blob([lines.join("\r\n")], { type: "text/calendar" }), `horaire-${slug(myTeamName())}-${slug(shownSeason()?.name || "")}.ics`);
    const hint = $("#icsHint");
    if (hint) { hint.textContent = "⬅ Téléchargé!"; hint.classList.add("done"); setTimeout(() => { if (hint.isConnected) { hint.textContent = "⬅ Ajouter à mon calendrier"; hint.classList.remove("done"); } }, 5000); }
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
        const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
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
function sheetXML(rows) {
    const colName = (i) => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
    const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
        const ref = `${colName(ci)}${ri + 1}`, style = ri === 0 ? ` s="1"` : "";
        return typeof v === "number" && Number.isFinite(v) ? `<c r="${ref}"${style}><v>${v}</v></c>`
            : `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    }).join("")}</row>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${body}</sheetData></worksheet>`;
}
function buildXLSX(sheets) {         // sheets: [{ name, rows }]
    const files = [
        { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
        { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
        { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
        { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
        { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>` },
        ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXML(s.rows) })),
    ];
    return zipStore(files);
}
// Local calendar date (toISOString gives the UTC date, a day late for evening games)
const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function downloadXLSX() {
    const row = standRow(state.teamNo), me = state.teamNo;
    const equipe = [["Équipe", "Division", "Saison", "Rang", "PJ", "V", "D", "DP", "N", "Pts", "BP", "BC", "Diff"],
        [myTeamName(), currentClass()?.name || "", shownSeason()?.name || "", row?.rank || "", row?.pj ?? "", row?.v ?? "", row ? row.dr + row.df : "", row?.dp ?? "", row?.n ?? "", row?.pts ?? "", row?.bp ?? "", row?.bc ?? "", row?.diff ?? ""]];
    const matchs = [["Date", "Heure", "Partie", "Dom./Vis.", "Adversaire", "Pour", "Contre", "Résultat", "Note", "Surface"],
        ...state.games.slice().sort((a, b) => a.start - b.start).map(g => {
            const home = g.home.no === me, r = resultOf(g, me), fin = g.score && isFinal(g);
            return [localDate(g.start), g.hasTime ? fmtTime.format(g.start) : "", g.no, home ? "Dom." : "Vis.", oppOf(g, me).name,
                fin ? (home ? g.score.h : g.score.a) : "", fin ? (home ? g.score.a : g.score.h) : "", r ? RESULT_LABEL[r] : "",
                [g.status === "FORFAIT" ? "Forfait" : "", g.shootout && fin ? "Fusillade" : ""].filter(Boolean).join(", "), surfaceLabel(g.surface)];
        })];
    const joueurs = [["#", "Joueur", "PJ", "B", "A", "Pts", "Pun", "BAN", "BDN", "BG"],
        ...(state.players || []).map(p => [p.num && p.num !== "0" ? int(p.num) : "", p.name, p.pj, p.b, p.a, p.pts, p.pun, p.ban, p.bdn, p.bg])];
    const gardiens = [["Gardien", "PJ", "V", "D", "N", "TR", "BC", "Eff", "Moy", "BL"],
        ...(state.goalies || []).map(g => [g.name, g.pj, g.v, g.d, g.n, g.tr, g.bc, g.eff ?? "", g.moy ?? "", g.bl])];
    saveFile(buildXLSX([{ name: "Équipe", rows: equipe }, { name: "Matchs", rows: matchs }, { name: "Joueurs", rows: joueurs }, { name: "Gardiens", rows: gardiens }]),
        `saison-${slug(myTeamName())}-${slug(shownSeason()?.name || "")}.xlsx`);
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

const playerById = (id) => lu.roster.find(p => p.id === id) || { id, num: "", name: "Hors liste", pos: "" };
const placedIds = () => new Set([...Object.values(lu.data.slots).filter(Boolean), ...lu.data.res]);
const tagFor = (p) => p.pos ? `<span class="lu-tag lu-tag-${p.pos.toLowerCase()}">${p.pos}</span>` : "";
const pLabel = (p) => `${p.num && p.num !== "0" ? `<b>#${esc(p.num)}</b> ` : ""}${esc(p.name)}`;

function renderLineup(loading = false) {
    const el = $("#lineup"), g = lu.game;
    if (!lu.open) return;
    if (lu.bench) { el.innerHTML = benchHTML(); return; }
    const opp = oppOf(g, state.teamNo);
    const head = `<div class="lu-head">
        <button type="button" class="icon-btn" data-lu="close" aria-label="Fermer">✕</button>
        <div><div class="lu-title">${isPlayed(g) && !lu.editing ? "Alignement utilisé" : "Alignement"}</div>
        <div class="lu-sub">${esc(fmtDayShort.format(g.start))}${g.hasTime ? ` · ${esc(fmtTime.format(g.start))}` : ""} · ${g.home.no === state.teamNo ? "vs" : "@"} ${esc(opp.name)}</div></div>
        <button type="button" class="btn" data-lu="bench">Vue banc</button>
    </div>`;
    if (loading) { el.innerHTML = head + `<div class="lu-body">${skeletons(3, true)}</div>`; return; }

    const ro = !lu.editing;
    const box = (key, label) => {
        const id = lu.data.slots[key], p = id ? playerById(id) : null;
        return `<button type="button" class="lu-box${p ? " full" : ""}${lu.pick === key ? " picking" : ""}" data-slot="${key}"${ro ? " disabled" : ""}>
            <span class="lu-pos">${label}</span><span class="lu-name">${p ? pLabel(p) : "—"}</span></button>`;
    };
    const lines = (prefix, n, pos, cls) => Array.from({ length: n }, (_, i) => `<div class="lu-line ${cls} c${pos.length}"><span class="lu-lab">${prefix}${i + 1}</span>
        ${pos.map(p => box(`${prefix}${i + 1}-${p}`, p)).join("")}</div>`).join("");
    const chips = (list, kind) => list.length ? list.map(id => `<span class="lu-chip">${pLabel(playerById(id))}</span>`).join("") : `<span class="hint">Personne</span>`;
    const prev = LS.get(`lineups_${state.teamNo}`, []).filter(x => x.g !== lu.gameNo).sort((a, b) => b.ts - a.ts)[0];

    el.innerHTML = head + `<div class="lu-body">
        ${!lu.roster.length ? `<div class="notice">L'alignement de l'équipe n'est pas disponible sur le site de la ligue.</div>` : ""}
        <h4>Lignes d'attaque</h4>${lines("L", FWD_LINES, FWD_POS, "fwd")}
        <h4>Paires défensives</h4>${lines("D", DEF_PAIRS, DEF_POS, "def")}
        <h4>Gardiens</h4><div class="lu-line gk">${box("G-Partant", "Partant")}${box("G-Auxiliaire", "Auxiliaire")}</div>
        <h4>Réserves</h4><button type="button" class="lu-group" data-slot="res"${ro ? " disabled" : ""}>${chips(lu.data.res)}</button>
        <h4>Absents</h4><button type="button" class="lu-group abs" data-slot="abs"${ro ? " disabled" : ""}>${chips(lu.data.abs)}</button>
        <div class="lu-actions">
            ${ro ? `<button type="button" class="btn" data-lu="edit">Modifier</button>`
                : `${prev ? `<button type="button" class="btn ghost" data-lu="copy">Copier le dernier match</button>` : ""}
                   <button type="button" class="btn ghost" data-lu="clear">Tout effacer</button>`}
        </div>
        <p class="hint">Enregistré sur ce téléphone seulement. Une ligne ou une paire vide n'apparaît pas dans la vue banc.</p>
    </div>${lu.pick ? pickerHTML() : ""}`;
}

// Picker: the player already in the box first, then players still to place (by number), then placed ones, absents last
function pickerHTML() {
    const key = lu.pick, multi = key === "res" || key === "abs";
    const current = multi ? lu.data[key] : [lu.data.slots[key]].filter(Boolean);
    const placed = placedIds(), abs = new Set(lu.data.abs);
    const rank = (p) => current.includes(p.id) ? 0 : abs.has(p.id) ? 3 : placed.has(p.id) ? 2 : 1;
    const list = lu.roster.slice().sort((a, b) => rank(a) - rank(b) || int(a.num) - int(b.num));
    const title = multi ? (key === "res" ? "Réserves" : "Absents") : key.replace("-", " · ");
    return `<div class="lu-pick-back" data-lu="pick-close"></div>
    <div class="lu-pick" role="dialog" aria-label="Choisir un joueur">
        <div class="lu-pick-head"><b>${esc(title)}</b><button type="button" class="btn" data-lu="pick-close">${multi ? "OK" : "Fermer"}</button></div>
        ${!multi && current.length ? `<button type="button" class="lu-opt remove" data-pid="">Vider la case</button>` : ""}
        ${list.map(p => {
            const r = rank(p);
            return `<button type="button" class="lu-opt${r === 0 ? " current" : r >= 2 ? " placed" : ""}" data-pid="${esc(p.id)}">
                <span>${pLabel(p)}</span>${tagFor(p)}${r === 0 ? `<span class="lu-mark">✓</span>` : r === 3 ? `<span class="lu-mark">absent</span>` : r === 2 ? `<span class="lu-mark">placé</span>` : ""}</button>`;
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
            ${used.map(r => `<div class="bv-row c${cols.length}${lined ? "" : " solo"}">${lined ? `<span class="bv-line">${r.label}</span>` : ""}${r.keys.map(k => cell(d.slots[k])).join("")}</div>`).join("")}
        </section>`;
    };
    const rowsOf = (prefix, n, pos) => Array.from({ length: n }, (_, i) => ({ label: `${prefix}${i + 1}`, keys: pos.map(p => `${prefix}${i + 1}-${p}`) }));
    const fwd = group("Attaque", "a", rowsOf("L", FWD_LINES, FWD_POS), ["Ailier gauche", "Centre", "Ailier droit"]);
    const def = group("Défense", "d", rowsOf("D", DEF_PAIRS, DEF_POS), ["Défenseur gauche", "Défenseur droit"]);
    const gk = group("Gardiens", "g", [{ label: "G", keys: ["G-Partant", "G-Auxiliaire"] }], ["Partant", "Auxiliaire"]);
    const res = d.res.length ? `<section class="bv-group"><h3>Réserves</h3><div class="bv-row extras">${d.res.map(cell).join("")}</div></section>` : "";
    const when = `${cap(fmtDayLong.format(g.start))}${g.hasTime ? ` · ${fmtTime.format(g.start)}` : ""}`;
    return `<div class="bench-view">
        <header class="bv-head">
            <div><strong>${esc(myTeamName())}</strong><span>${home ? "vs" : "@"} ${esc(opp.name)} · ${esc(when)}</span></div>
            <button type="button" class="bv-close" data-lu="bench-off" aria-label="Fermer la vue banc">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </button>
        </header>
        <div class="bv-body">
            <div class="bv-groups">${fwd + def + gk + res || `<div class="bv-empty">Aucun joueur placé.</div>`}</div>
            <aside class="bv-info" aria-hidden="true">
                <div class="bv-info-team">${esc(myTeamName())}</div>
                <div class="bv-info-vs">${home ? "reçoit" : "visite"}</div>
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
        state.error = "Impossible de lire les données de la ligue.";
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
