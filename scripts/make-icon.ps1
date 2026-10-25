# Draws the app icon's PNG sizes from the commissioned art: crops her head, makes
# the white background around the figure and its oval frame transparent, scales
# to 1024 px, cuts the rounded-square outline, and writes icon-<size>.png into
# -OutDir for every size in -Sizes, a comma-separated list.
# `scripts/make-icon.mts` runs it and packs the results; run that rather than
# this.
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [Parameter(Mandatory = $true)][string]$Sizes
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# The head with the ears and bow, in source pixels.
$CropX = 250
$CropY = 0
$CropSide = 1000
$IconSide = 1024
# The macOS icon shape's corner radius, as a share of the side.
$CornerRadiusShare = 0.225

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class IconPixels
{
    // The art's background is pure white; its outlines are dark.
    const int NearWhiteMin = 245;
    const int NearWhiteSpread = 10;
    const int FringeDepth = 2;
    const double OutlineDarkness = 200.0;

    // Clears every near-white pixel reachable from the bitmap's border without
    // crossing a darker one, then turns the anti-aliased ring next to the cleared
    // area from a white blend into partial alpha. Writes premultiplied pixels.
    public static void ClearBackground(Bitmap bitmap)
    {
        int width = bitmap.Width;
        int height = bitmap.Height;
        byte[] bgra = ReadPixels(bitmap);
        int[] depth = new int[width * height];
        for (int i = 0; i < depth.Length; i++) depth[i] = -1;

        var pending = new Queue<int>();
        for (int x = 0; x < width; x++)
        {
            SeedIfNearWhite(bgra, depth, pending, x);
            SeedIfNearWhite(bgra, depth, pending, (height - 1) * width + x);
        }
        for (int y = 0; y < height; y++)
        {
            SeedIfNearWhite(bgra, depth, pending, y * width);
            SeedIfNearWhite(bgra, depth, pending, y * width + width - 1);
        }

        var fringe = new Queue<int>();
        while (pending.Count > 0)
        {
            int index = pending.Dequeue();
            foreach (int next in Neighbours(index, width, height))
            {
                if (depth[next] != -1) continue;
                if (IsNearWhite(bgra, next))
                {
                    depth[next] = 0;
                    pending.Enqueue(next);
                }
                else
                {
                    depth[next] = 1;
                    fringe.Enqueue(next);
                }
            }
        }

        while (fringe.Count > 0)
        {
            int index = fringe.Dequeue();
            if (depth[index] >= FringeDepth) continue;
            foreach (int next in Neighbours(index, width, height))
            {
                if (depth[next] != -1) continue;
                depth[next] = depth[index] + 1;
                fringe.Enqueue(next);
            }
        }

        for (int index = 0; index < depth.Length; index++)
        {
            if (depth[index] == 0) SetPremultiplied(bgra, index, 0, 0, 0, 0);
            else if (depth[index] > 0) UnmixWhite(bgra, index);
        }
        WritePixels(bitmap, bgra);
    }

    // Multiplies the premultiplied bitmap by an anti-aliased rounded square
    // covering the whole bitmap.
    public static void MaskRoundedSquare(Bitmap bitmap, double radius)
    {
        int side = bitmap.Width;
        byte[] bgra = ReadPixels(bitmap);
        double half = side / 2.0;
        double inner = half - radius;
        for (int y = 0; y < side; y++)
        {
            for (int x = 0; x < side; x++)
            {
                double dx = Math.Max(Math.Abs(x + 0.5 - half) - inner, 0);
                double dy = Math.Max(Math.Abs(y + 0.5 - half) - inner, 0);
                double outside = Math.Sqrt(dx * dx + dy * dy) - radius;
                double coverage = Math.Min(Math.Max(0.5 - outside, 0), 1);
                int offset = (y * side + x) * 4;
                for (int channel = 0; channel < 4; channel++)
                {
                    bgra[offset + channel] = (byte)Math.Round(bgra[offset + channel] * coverage);
                }
            }
        }
        WritePixels(bitmap, bgra);
    }

    static void SeedIfNearWhite(byte[] bgra, int[] depth, Queue<int> pending, int index)
    {
        if (depth[index] != -1 || !IsNearWhite(bgra, index)) return;
        depth[index] = 0;
        pending.Enqueue(index);
    }

    static bool IsNearWhite(byte[] bgra, int index)
    {
        int offset = index * 4;
        int b = bgra[offset], g = bgra[offset + 1], r = bgra[offset + 2];
        int min = Math.Min(r, Math.Min(g, b));
        int max = Math.Max(r, Math.Max(g, b));
        return min >= NearWhiteMin && max - min <= NearWhiteSpread;
    }

    static IEnumerable<int> Neighbours(int index, int width, int height)
    {
        int x = index % width;
        int y = index / width;
        if (x > 0) yield return index - 1;
        if (x < width - 1) yield return index + 1;
        if (y > 0) yield return index - width;
        if (y < height - 1) yield return index + width;
    }

    // Reads the pixel as a blend of its own colour over white and keeps only
    // its own colour, with the blend's share as alpha.
    static void UnmixWhite(byte[] bgra, int index)
    {
        int offset = index * 4;
        int b = bgra[offset], g = bgra[offset + 1], r = bgra[offset + 2];
        int min = Math.Min(r, Math.Min(g, b));
        double alpha = Math.Min(Math.Max((255 - min) / OutlineDarkness, 0), 1);
        if (alpha <= 0)
        {
            SetPremultiplied(bgra, index, 0, 0, 0, 0);
            return;
        }
        SetPremultiplied(bgra, index, alpha, Unmix(b, alpha), Unmix(g, alpha), Unmix(r, alpha));
    }

    static double Unmix(int value, double alpha)
    {
        return Math.Min(Math.Max((value - (1 - alpha) * 255) / alpha, 0), 255);
    }

    static void SetPremultiplied(byte[] bgra, int index, double alpha, double b, double g, double r)
    {
        int offset = index * 4;
        bgra[offset] = (byte)Math.Round(b * alpha);
        bgra[offset + 1] = (byte)Math.Round(g * alpha);
        bgra[offset + 2] = (byte)Math.Round(r * alpha);
        bgra[offset + 3] = (byte)Math.Round(alpha * 255);
    }

    static byte[] ReadPixels(Bitmap bitmap)
    {
        var area = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
        BitmapData data = bitmap.LockBits(area, ImageLockMode.ReadOnly, PixelFormat.Format32bppPArgb);
        try
        {
            byte[] bgra = new byte[bitmap.Width * bitmap.Height * 4];
            for (int y = 0; y < bitmap.Height; y++)
            {
                Marshal.Copy(data.Scan0 + y * data.Stride, bgra, y * bitmap.Width * 4, bitmap.Width * 4);
            }
            return bgra;
        }
        finally
        {
            bitmap.UnlockBits(data);
        }
    }

    static void WritePixels(Bitmap bitmap, byte[] bgra)
    {
        var area = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
        BitmapData data = bitmap.LockBits(area, ImageLockMode.WriteOnly, PixelFormat.Format32bppPArgb);
        try
        {
            for (int y = 0; y < bitmap.Height; y++)
            {
                Marshal.Copy(bgra, y * bitmap.Width * 4, data.Scan0 + y * data.Stride, bitmap.Width * 4);
            }
        }
        finally
        {
            bitmap.UnlockBits(data);
        }
    }
}
'@

# Draws $Image scaled to $Side x $Side into a new premultiplied bitmap.
function Resize-Square([System.Drawing.Image]$Image, [System.Drawing.Rectangle]$From, [int]$Side) {
  $bitmap = [System.Drawing.Bitmap]::new($Side, $Side, [System.Drawing.Imaging.PixelFormat]::Format32bppPArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $attributes = [System.Drawing.Imaging.ImageAttributes]::new()
  try {
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    # Without it the resampler blends the image's edge pixels with transparent black.
    $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
    $to = [System.Drawing.Rectangle]::new(0, 0, $Side, $Side)
    $graphics.DrawImage($Image, $to, $From.X, $From.Y, $From.Width, $From.Height, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
  }
  finally {
    $attributes.Dispose()
    $graphics.Dispose()
  }
  return $bitmap
}

# Halves the image until one more halving would pass $Side, then scales to
# $Side: one bicubic step from 1024 px to 16 px drops most of the detail.
function Resize-Stepped([System.Drawing.Bitmap]$Image, [int]$Side) {
  $current = $Image
  while ($current.Width / 2 -ge $Side) {
    $whole = [System.Drawing.Rectangle]::new(0, 0, $current.Width, $current.Height)
    $half = Resize-Square $current $whole ([int]($current.Width / 2))
    if ($current -ne $Image) { $current.Dispose() }
    $current = $half
  }
  if ($current.Width -eq $Side) { return $current }
  $whole = [System.Drawing.Rectangle]::new(0, 0, $current.Width, $current.Height)
  $sized = Resize-Square $current $whole $Side
  if ($current -ne $Image) { $current.Dispose() }
  return $sized
}

$sourceImage = [System.Drawing.Bitmap]::new($Source)
try {
  $crop = [System.Drawing.Rectangle]::new($CropX, $CropY, $CropSide, $CropSide)
  $head = Resize-Square $sourceImage $crop $CropSide
}
finally {
  $sourceImage.Dispose()
}

[IconPixels]::ClearBackground($head)
$whole = [System.Drawing.Rectangle]::new(0, 0, $CropSide, $CropSide)
$icon = Resize-Square $head $whole $IconSide
$head.Dispose()
[IconPixels]::MaskRoundedSquare($icon, $IconSide * $CornerRadiusShare)

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
foreach ($size in $Sizes.Split(',') | ForEach-Object { [int]$_ }) {
  $sized = Resize-Stepped $icon $size
  $sized.Save((Join-Path $OutDir "icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  if ($sized -ne $icon) { $sized.Dispose() }
}
$icon.Dispose()
