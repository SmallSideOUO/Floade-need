param([ValidateSet('listen', 'speak', 'probe')][string]$Mode)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Send-VoiceEvent($Value) {
  [Console]::WriteLine(($Value | ConvertTo-Json -Compress -Depth 4))
}

$speechEngine = $null
try {
  Add-Type -AssemblyName System.Speech
  $request = [Console]::ReadLine() | ConvertFrom-Json
  $language = [string]$request.language
  $baseLanguage = $language.Split('-')[0]
  if ($Mode -eq 'listen' -or $Mode -eq 'probe') {
    $recognizers = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers())
    $matching = @($recognizers | Where-Object { $_.Culture.Name -eq $language })
    if (!$matching.Count) { $matching = @($recognizers | Where-Object { $_.Culture.TwoLetterISOLanguageName -eq $baseLanguage }) }
    if (!$matching.Count) {
      Send-VoiceEvent @{ type = 'error'; code = 'recognizerMissing'; language = $language }
      exit 1
    }
    $speechEngine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($matching[0])
    $speechEngine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
    if ($Mode -eq 'probe') {
      Send-VoiceEvent @{ type = 'ready'; language = $speechEngine.RecognizerInfo.Culture.Name }
    } else {
      $speechEngine.SetInputToDefaultAudioDevice()
      Send-VoiceEvent @{ type = 'ready'; language = $speechEngine.RecognizerInfo.Culture.Name }
      while ($true) {
        $result = $speechEngine.Recognize([TimeSpan]::FromSeconds(10))
        if ($null -ne $result -and $result.Text) {
          Send-VoiceEvent @{ type = 'text'; text = $result.Text; language = $speechEngine.RecognizerInfo.Culture.Name }
        }
      }
    }
  } else {
    $speechEngine = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $voices = @($speechEngine.GetInstalledVoices() | Where-Object Enabled | ForEach-Object { $_.VoiceInfo })
    $matching = @($voices | Where-Object { $_.Culture.Name -eq $language })
    if (!$matching.Count) { $matching = @($voices | Where-Object { $_.Culture.TwoLetterISOLanguageName -eq $baseLanguage }) }
    if (!$matching.Count) {
      Send-VoiceEvent @{ type = 'error'; code = 'voiceMissing'; language = $language }
      exit 1
    }
    $speechEngine.SelectVoice($matching[0].Name)
    Send-VoiceEvent @{ type = 'ready'; language = $matching[0].Culture.Name }
    $speechEngine.Speak([string]$request.text)
  }
} catch {
  Send-VoiceEvent @{ type = 'error'; code = 'failed'; message = $_.Exception.Message }
  exit 1
} finally {
  if ($null -ne $speechEngine) { $speechEngine.Dispose() }
}
