# Kendo Filler - regenerate the extension icons from the real logo artwork.
#
# Usage (PowerShell, from the kendo-filler folder):
#   .\assets\make-icons.ps1 -Source .\assets\logo-source.png
#
# Produces assets\logo.png (256px, used in the popup header) and
# assets\icon16|32|48|128.png (used for the toolbar action and the extensions page).
# The source is centre-cropped to a square first, so a square logo is passed through
# unchanged. Transparency is preserved.

param(
  [Parameter(Mandatory = $true)]
  [string]$Source
)

Add-Type -AssemblyName System.Drawing

$src = Resolve-Path $Source
$outDir = Split-Path -Parent $PSCommandPath
$original = [System.Drawing.Image]::FromFile($src)

# Centre-crop to a square.
$side = [Math]::Min($original.Width, $original.Height)
$cropX = [int](($original.Width - $side) / 2)
$cropY = [int](($original.Height - $side) / 2)
$square = New-Object System.Drawing.Bitmap($side, $side, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($square)
$g.DrawImage($original, (New-Object System.Drawing.Rectangle(0, 0, $side, $side)),
             (New-Object System.Drawing.Rectangle($cropX, $cropY, $side, $side)),
             [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$original.Dispose()

function Save-Resized([int]$size, [string]$name) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $gr = [System.Drawing.Graphics]::FromImage($bmp)
  $gr.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $gr.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $gr.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $gr.Clear([System.Drawing.Color]::Transparent)
  $gr.DrawImage($square, 0, 0, $size, $size)
  $gr.Dispose()
  $path = Join-Path $outDir $name
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host ("  {0,-14} {1}x{1}" -f $name, $size)
}

Write-Host "Generating icons from $src"
Save-Resized 256 'logo.png'
foreach ($s in 16, 32, 48, 128) { Save-Resized $s ("icon{0}.png" -f $s) }
$square.Dispose()
Write-Host "Done - reload the extension in chrome://extensions to see the new icon."
