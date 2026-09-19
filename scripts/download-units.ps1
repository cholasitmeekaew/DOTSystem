$urls = @(
  'https://robloxbot-team.sirv.com/privately/ER%3ALC/DOT/fixunit.png',
  'https://robloxbot-team.sirv.com/privately/ER%3ALC/DOT/emergencytowunit.png',
  'https://robloxbot-team.sirv.com/privately/ER%3ALC/DOT/powerunit.png',
  'https://robloxbot-team.sirv.com/privately/ER%3ALC/DOT/trafficunit.png',
  'https://robloxbot-team.sirv.com/privately/ER%3ALC/DOT/emergencyunit.png'
)
$names = @('unit-civil', 'unit-tow', 'unit-power', 'unit-traffic', 'unit-emergency')
for ($i = 0; $i -lt $urls.Count; $i++) {
  Write-Host "Downloading: $($names[$i]).png"
  try {
    Invoke-WebRequest -Uri $urls[$i] -OutFile "C:\Users\Administrator\Documents\DOT\public\$($names[$i]).png" -UseBasicParsing -TimeoutSec 60
    $size = (Get-Item "C:\Users\Administrator\Documents\DOT\public\$($names[$i]).png").Length
    Write-Host "  Size: $size bytes"
  } catch {
    Write-Host "  ERROR: $_"
  }
}
