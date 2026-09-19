$vehicles = @(
  @{ name = 'veh-213-vinnimade';      url = 'https://robloxbot-team.sirv.com/privately/ER%3ALC/DOT/213_Vinnimade.png' },
  @{ name = 'veh-vellfire';          url = 'https://robloxbot-team.sirv.com/privately/ER%3ALC/DOT/1995_Vellfire_Evertt_Crew_Cab.png' },
  @{ name = 'veh-explorer-transport';url = 'https://robloxbot-team.sirv.com/privately/ER%3ALC/DOT/2015_Explorer_Transport.png' },
  @{ name = 'veh-falcon-global';     url = 'https://robloxbot-team.sirv.com/privately/ER%3ALC/DOT/2018_Falcon_Global.png' },
  @{ name = 'veh-falcon-tow';        url = 'https://robloxbot-team.sirv.com/privately/ER%3ALC/DOT/2020_Falcon_Advance_450.png' },
  @{ name = 'veh-falcon-bucket';     url = 'https://robloxbot-team.sirv.com/privately/ER%3ALC/DOT/2020_Falcon_Advance_450_Bucket.png' },
  @{ name = 'veh-falcon-roadside';   url = 'https://robloxbot-team.sirv.com/privately/ER%3ALC/DOT/2020_Falcon_Advance_450_Roadside.png' },
  @{ name = 'veh-falcon-2920';       url = 'https://robloxbot-team.sirv.com/privately/ER%3ALC/DOT/2920_Falcon_Advace.png' }
)
foreach ($v in $vehicles) {
  Write-Host "Downloading: $($v.name).png"
  try {
    Invoke-WebRequest -Uri $v.url -OutFile "C:\Users\Administrator\Documents\DOT\public\$($v.name).png" -UseBasicParsing -TimeoutSec 60
    $size = (Get-Item "C:\Users\Administrator\Documents\DOT\public\$($v.name).png").Length
    Write-Host "  Size: $size bytes"
  } catch {
    Write-Host "  ERROR: $_"
  }
}
