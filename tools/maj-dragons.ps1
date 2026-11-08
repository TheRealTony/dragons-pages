# Refreshes the saved copy of the league data inside the Dragons page (dragons/index.html).
# The page shows this copy whenever it cannot read the league site (relay down, league site down).
# Run it from the tools folder of a copy of this repo: right-click > "Run with PowerShell".
# Then commit and push dragons/index.html so Netlify publishes the new copy.

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Site   = "https://hockeylhai-stconstant.com"
$TeamNo = "615"
$Html   = Join-Path $PSScriptRoot "..\dragons\index.html"
$Router = "$Site/shark_modules/modules/Router.php?type=data&lang=fr&lang_link_prefix="

# Same columns as dragons/dragons.js
$CalCols    = "GameNo:GameNoText,GameDate:DatedddDMMMYYYY,TeamLogoCityNameAwayCalendar:TeamImageNameCity,CalendarResult:CalendarResult,TeamLogoCityNameLocalCalendar:TeamImageNameCity,TimeStatus:TimeStatus,PlaceLink:Link"
$PlayerCols = "Rank:Text,TeamRosterPlayerNumber:Text,PlayerLogoNameWithPosition:ImageNameCityRookie,TeamPlayerPJ:Text,TeamB:Text,TeamA:Text,TeamPlayerPTS:Text,PUN:Text,BAN:Text,BDN:Text,BG:Text"
$GoalieCols = "Rank:Text,PlayerLogoNameWithPosition:ImageNameCityRookie,TeamGoalerPJ:Text,TeamGoalerV:Text,TeamGoalerDR:Text,TeamGoalerDP:Text,TeamGoalerDF:Text,TeamGoalerN:Text,TeamGoalerBL:Text,TeamGoalerTR:Text,TeamGoalerBC:Text,TeamEFF:Text,TeamMOY:Number_Two_Precision"
$RosterCols = "TeamRosterPlayerNumber:Text,TeamRosterPlayer:ImageNameLink,TeamRosterPosition:Text"
$SuspCols   = "SuspensionDate:DateYYYYMMDD,SuspensionPlayerImageName:ImageNameLink,SuspensionTeam:Text,SuspensionMotif:Text,SuspensionPartsNb:SuspensionNbParties,SuspensionEndDate:DateAndTime"
$RC = "&params[resizer_cache][0][width]=96&params[resizer_cache][0][height]=96"

function Cols($spec) {
    $i = 0
    ($spec -split "," | ForEach-Object {
        $name, $type = $_ -split ":"
        "&params[columns][$i][columnData][0][name]=$name&params[columns][$i][columnData][0][type]=$type"
        $i++
    }) -join ""
}

function Get-Raw($query) {
    $resp = Invoke-WebRequest -Uri ($Router + $query) -UseBasicParsing
    $text = [Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray()).Trim()
    if (-not $text) { throw "Empty answer for $query" }
    $text
}

# Answers are stored under "module|year|seasonNo|classNo|teamNo|minGoalie", the key the page looks up
$answers = [ordered]@{}
function Save($module, $query, $year = "", $season = "", $cls = "", $team = "", $min = "") {
    $raw = Get-Raw ("&module=$module" + $query)
    $script:answers["$module|$year|$season|$cls|$team|$min"] = $raw
    $raw
}

$years = @(Save "AvailableYears" "&path=Utilities/" | ConvertFrom-Json)
$year = $years | Where-Object { $_.default } | Select-Object -First 1
if (-not $year) { $year = $years[0] }
$y = [string]$year.sy_no

$seasons = @(Save "AvailableSeason" "&path=Utilities/&params[year]=$y" -year $y | ConvertFrom-Json)
$season = $seasons | Where-Object { $_.default } | Select-Object -First 1
if (-not $season) { $season = $seasons[0] }
$s = [string]$season.sais_no
Write-Host "Saison: $($season.sais_name) ($s)"

[void](Save "AvailableSeasonClasses" "&path=Utilities/&params[seasonNo]=$s" -season $s)
$team = Save "Team" "&path=&params[seasonNo]=$s&params[teamNo]=$TeamNo$RC" -season $s -team $TeamNo | ConvertFrom-Json
$sc = [string]$team.st_sc_no

[void](Save "AvailableSeasonClassTeams" "&path=Utilities/&params[seasonNo]=$s&params[classNo]=$sc" -season $s -cls $sc)
[void](Save "TeamCalendar" ("&path=" + (Cols $CalCols) + "&params[teamNo]=$TeamNo&params[seasonNo]=$s$RC") -season $s -team $TeamNo)
[void](Save "TeamPlayerStats" ("&path=" + (Cols $PlayerCols) + "&params[teamNo]=$TeamNo&params[seasonNo]=$s$RC") -season $s -team $TeamNo)
foreach ($min in "1", "0") {
    [void](Save "TeamGoalieStats" ("&path=" + (Cols $GoalieCols) + "&params[teamNo]=$TeamNo&params[seasonNo]=$s&params[minTeamGoalerGamesPercentage]=$min$RC") -season $s -team $TeamNo -min $min)
}
[void](Save "TeamRoster" ("&path=" + (Cols $RosterCols) + "&params[teamNo]=$TeamNo&params[seasonNo]=$s$RC") -season $s -team $TeamNo)
[void](Save "Standing" "&path=&configSection=StandingConfig&params[seasonNo]=$s&params[classNo]=$sc$RC" -season $s -cls $sc)
[void](Save "Suspension" ("&path=" + (Cols $SuspCols) + "&params[seasonNo]=$s&params[classNo]=$RC") -season $s)

# The answers are already JSON: they are stored as received
$parts = foreach ($k in $answers.Keys) { '"' + $k + '":' + $answers[$k] }
$json = '{"fetchedAt":"' + (Get-Date).ToString("o") + '","seasonNo":"' + $s + '","answers":{' + ($parts -join ",") + '}}'
$json = $json.Replace('<', '\u003c')     # keeps the data from closing its <script> block (JSON.parse turns \u003c back into <)

$block = "<!--SNAPSHOT-START-->`n<script id=`"snapshot`" type=`"application/json`">" + $json + "</script>`n<!--SNAPSHOT-END-->"
$utf8 = New-Object System.Text.UTF8Encoding($false)
$page = [IO.File]::ReadAllText($Html, $utf8)
$pattern = [regex]'(?s)<!--SNAPSHOT-START-->.*?<!--SNAPSHOT-END-->'
if (-not $pattern.IsMatch($page)) { throw "Snapshot markers not found in $Html" }
$page = $pattern.Replace($page, [System.Text.RegularExpressions.MatchEvaluator] { param($m) $block }, 1)
[IO.File]::WriteAllText($Html, $page, $utf8)

Write-Host "Mise a jour terminee: $Html"
