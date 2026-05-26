$src = "C:\Users\qk\detction-sigma-elk-splunk\detction-sigma-elk-splunk\app.js"
$text = Get-Content $src -Raw -Encoding UTF8

$startFn = $text.IndexOf('function mappingProfile(key) {')
if ($startFn -lt 0) { throw 'mappingProfile not found' }
$startObj = $text.IndexOf('const profiles = {', $startFn)
$endObj = $text.IndexOf('};', $startObj)
$profilesJs = $text.Substring($startObj + 'const profiles = '.Length, $endObj - ($startObj + 'const profiles = '.Length) + 1)

$groups = @()
$idx = 0
while ($true) {
  $m = [regex]::Match($text.Substring($idx), 'buildMappings\(\{')
  if (-not $m.Success) { break }
  $open = $idx + $m.Index + 'buildMappings('.Length
  $brace = 0
  $i = $open
  for (; $i -lt $text.Length; $i++) {
    $ch = $text[$i]
    if ($ch -eq '{') { $brace++ }
    elseif ($ch -eq '}') { $brace--; if ($brace -eq 0) { break } }
  }
  $objText = $text.Substring($open, $i - $open + 1)
  $groups += $objText
  $idx = $i + 1
}

$js = @"
const profiles = $profilesJs;
const allGroups = [
$($groups -join ",`n")
];

function mappingProfile(key) {
  const p = profiles[key] || ["Other", key, "generic", key];
  return { category: p[0], data_source: p[1], event_category: p[2], mapping_profile: p[3] };
}

const out = [];
for (const group of allGroups) {
  for (const [legacyKey, fields] of Object.entries(group)) {
    const prof = mappingProfile(legacyKey);
    for (const [sigma, pair] of Object.entries(fields)) {
      out.push({
        category: prof.category,
        data_source: prof.data_source,
        event_category: prof.event_category,
        mapping_profile: prof.mapping_profile,
        sigma: sigma,
        splunk: Array.isArray(pair) ? (pair[0] || "") : "",
        elastic: Array.isArray(pair) ? (pair[1] || "") : ""
      });
    }
  }
}

const unique = [];
const seen = new Set();
for (const row of out) {
  const k = `${row.mapping_profile}::${row.sigma}`;
  if (seen.has(k)) continue;
  seen.add(k);
  unique.push(row);
}

unique.sort((a,b)=>`${a.category}:${a.data_source}:${a.event_category}:${a.mapping_profile}:${a.sigma}`.localeCompare(`${b.category}:${b.data_source}:${b.event_category}:${b.mapping_profile}:${b.sigma}`));
console.log(JSON.stringify(unique, null, 2));
"@

$tmpJs = Join-Path $env:TEMP 'extract_mappings.js'
Set-Content -Path $tmpJs -Value $js -Encoding UTF8
node $tmpJs
