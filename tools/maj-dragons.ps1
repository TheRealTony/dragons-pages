# Refreshes the saved copy of the league data inside the Dragons page (dragons/index.html).
# The page shows this copy whenever it cannot read the league site directly.
# Run it from the tools folder of a copy of this repo: right-click > "Run with PowerShell".

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Site   = "https://hockeylhai-stconstant.com"
$TeamNo = 615
$YearNo = 58      # 2026 - 2027
$Html   = Join-Path $PSScriptRoot "..\dragons\index.html"
$Router = "$Site/shark_modules/modules/Router.php?type=data&lang=fr&lang_link_prefix="

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

# Same queries as the page (see Q in dragons/index.html)
$seasonsRaw = Get-Raw "&path=Team/&module=TeamSeasons&params[year]=$YearNo&params[teamNo]=$TeamNo"
$seasons = @($seasonsRaw | ConvertFrom-Json)
$season = $seasons | Where-Object { $_.default } | Select-Object -First 1
if (-not $season) { $season = $seasons[0] }
$s = $season.sais_no
Write-Host "Saison: $($season.sais_name) ($s)"

$teamRaw = Get-Raw "&path=&module=Team&params[seasonNo]=$s&params[teamNo]=$TeamNo"
$classNo = ($teamRaw | ConvertFrom-Json).st_sc_no

$calendarRaw = Get-Raw ("&path=&module=TeamCalendar" + (Cols "GameNo:GameNoText,GameDate:DatedddDMMMYYYY,TeamLogoCityNameAwayCalendar:TeamImageNameCity,CalendarResult:CalendarResult,TeamLogoCityNameLocalCalendar:TeamImageNameCity,TimeStatus:TimeStatus,PlaceLink:Link") + "&params[teamNo]=$TeamNo&params[seasonNo]=$s")
$playersRaw  = Get-Raw ("&path=&module=TeamPlayerStats" + (Cols "Rank:Text,TeamRosterPlayerNumber:Text,PlayerLogoNameWithPosition:ImageNameCityRookie,TeamPlayerPJ:Text,TeamB:Text,TeamA:Text,TeamPlayerPTS:Text,PUN:Text") + "&params[teamNo]=$TeamNo&params[seasonNo]=$s")
$standingRaw = Get-Raw "&module=Standing&configSection=StandingConfig&params[seasonNo]=$s&params[classNo]=$classNo"
$suspRaw     = Get-Raw ("&path=&module=Suspension" + (Cols "SuspensionDate:DateYYYYMMDD,SuspensionPlayerImageName:ImageNameLink,SuspensionTeam:Text,SuspensionMotif:Text,SuspensionPartsNb:SuspensionNbParties,SuspensionEndDate:DateAndTime") + "&params[seasonNo]=$s&params[classNo]=")

# The answers are already JSON: they are stored as received
$json = '{"fetchedAt":"' + (Get-Date).ToString("o") + '","seasonNo":"' + $s + '","data":{' +
    '"seasons":' + $seasonsRaw + ',"team":' + $teamRaw + ',"calendar":' + $calendarRaw +
    ',"standing":' + $standingRaw + ',"players":' + $playersRaw + ',"susp":' + $suspRaw + '}}'
$json = $json.Replace("<", "<")     # keeps the data from closing its <script> block

$block = "<!--SNAPSHOT-START-->`n<script id=`"snapshot`" type=`"application/json`">" + $json + "</script>`n<!--SNAPSHOT-END-->"
$utf8 = New-Object System.Text.UTF8Encoding($false)
$page = [IO.File]::ReadAllText($Html, $utf8)
$pattern = [regex]'(?s)<!--SNAPSHOT-START-->.*?<!--SNAPSHOT-END-->'
if (-not $pattern.IsMatch($page)) { throw "Snapshot markers not found in $Html" }
$page = $pattern.Replace($page, [System.Text.RegularExpressions.MatchEvaluator] { param($m) $block }, 1)
[IO.File]::WriteAllText($Html, $page, $utf8)

Write-Host "Mise a jour terminee: $Html"
